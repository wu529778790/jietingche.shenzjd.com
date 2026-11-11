import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_COOKIE, isValidAdminToken } from "@/lib/adminAuth";

/** 访客只需要这几个：搜索、筛选分面、定位反查城市、读兜底推广码 */
const PUBLIC_API = new Set([
  "/api/search",
  "/api/facets",
  "/api/locate",
  "/api/admin/login",
  "/api/admin/logout",
]);

function isPublic(pathname: string, method: string): boolean {
  if (pathname === "/admin/login") return true;
  if (!pathname.startsWith("/api/")) return false;
  // /api/v1/* 是给外部端（小工具、B 站 Toy）的稳定别名，等价于 /api/*（见 next.config rewrites）
  const path = pathname.replace(/^\/api\/v1(?=\/|$)/, "/api");
  if (PUBLIC_API.has(path)) return true;
  if (path === "/api/config") return method === "GET" || method === "OPTIONS";
  return false;
}

/**
 * 反采集：只拦「明确是采集器 / 裸脚本库」的 UA，不做行为推测。
 *
 * 边界很清楚——搜索引擎、社交预览、浏览器永远放行；被拦的是 ahrefs/semrush 这类
 * SEO 工具和 python-requests/scrapy/puppeteer 这类零成本脚本。
 * 刻意不拦 curl/wget：发版流程的健康检查就是从宿主机 curl 127.0.0.1 打进来的
 * （deploy.yml 里的 health / CITY_ASSERT），拦了发版会直接失败；这类请求的量级
 * 交给 /api/* 已有的 IP 频控（api.ts）。
 *
 * 开关：BOT_BLOCK=off 一键关掉；BLOCK_UA_EXTRA 追加自定义规则（正则片段，逗号分隔）。
 */
const ALLOW_UA =
  /googlebot|bingbot|baiduspider|sogou|360spider|yisouspider|bytespider|petalbot|applebot|duckduckbot|yandex|facebookexternalhit|twitterbot|telegrambot|slackbot|discordbot/i;

const DEFAULT_BLOCK_UA =
  /ahrefsbot|semrushbot|mj12bot|dotbot|blexbot|dataforseo|serpstatbot|zoominfobot|screaming ?frog|sitebulb|netpeak|megaindex|rogerbot|exabot|python-requests|python-urllib|scrapy|aiohttp|httpx|okhttp|go-http-client|libwww-perl|apache-httpclient|node-fetch|undici|phantomjs|headlesschrome|puppeteer|playwright|selenium|postmanruntime|insomnia/i;

let blockUa: RegExp | null = null;

function blockMatcher(): RegExp {
  if (blockUa) return blockUa;
  const extra = (process.env.BLOCK_UA_EXTRA ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  blockUa = extra.length
    ? new RegExp(`${DEFAULT_BLOCK_UA.source}|${extra.join("|")}`, "i")
    : DEFAULT_BLOCK_UA;
  return blockUa;
}

function isBotBlocked(ua: string): boolean {
  if (process.env.BOT_BLOCK === "off") return false;
  if (ALLOW_UA.test(ua)) return false;
  // 空 UA 不拦：CDN 的回源/预热探测可能不带 UA，拦错了会被判成源站不可用。
  // 反正脚本随便填个浏览器 UA 就绕过了，这一条挡不住有意义的量。
  if (!ua.trim()) return false;
  return blockMatcher().test(ua);
}

/**
 * 落地页（首页/city/district/park）的 CDN 缓存头。
 * 这些路由是阻塞式渲染（instant=false），Next 恒发 no-store，中间件在这里覆盖成
 * 可被 EdgeOne 缓存的头；数据新鲜度由页面内 use cache 保证（seo.ts LANDING_CACHE_LIFE），
 * s-maxage 与其 revalidate 保持一致，别让 CDN 窗口超过数据缓存窗口。
 *
 * 首页也走这套：不带缓存头时 Next 会给静态路由下发 s-maxage=31536000，
 * 一旦首页被静态预渲染，空壳就会在 CDN 上待一整年。
 */
const LANDING_CACHE_CONTROL =
  "public, max-age=60, s-maxage=300, stale-while-revalidate=86400";

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (isBotBlocked(req.headers.get("user-agent") ?? "")) {
    return new NextResponse("本站内容不提供给采集工具", {
      status: 403,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }

  if (pathname === "/" || pathname.startsWith("/city/") || pathname.startsWith("/park/")) {
    const res = NextResponse.next();
    res.headers.set("Cache-Control", LANDING_CACHE_CONTROL);
    return res;
  }

  if (isPublic(pathname, req.method)) return NextResponse.next();

  const isApi = pathname.startsWith("/api/");
  // 口令只挡后台：sitemap.xml / robots.txt 这类对外路由也被 matcher 收进来了，
  // 不能顺手落进鉴权分支（否则线上会回 503 而不是 sitemap）
  if (!isApi && !pathname.startsWith("/admin/")) return NextResponse.next();

  const password = process.env.ADMIN_PASSWORD ?? "";

  if (!password) {
    // 本地开发免密；生产环境强制要求配置，避免默认口令上线
    if (process.env.NODE_ENV !== "production") return NextResponse.next();
    return isApi
      ? NextResponse.json({ ok: false, error: "服务端未配置 ADMIN_PASSWORD" }, { status: 503 })
      : new NextResponse("服务端未配置 ADMIN_PASSWORD", { status: 503 });
  }

  const token = req.cookies.get(ADMIN_COOKIE)?.value;
  if (await isValidAdminToken(token, password)) return NextResponse.next();

  if (isApi) {
    return NextResponse.json({ ok: false, error: "请先登录管理后台" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/admin/login";
  url.search = "";
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    "/",
    "/admin/:path*",
    "/api/:path*",
    "/city/:path*",
    "/park/:path*",
    "/sitemap.xml",
    "/robots.txt",
  ],
};

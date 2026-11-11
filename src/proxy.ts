import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_COOKIE, isValidAdminToken } from "@/lib/adminAuth";
import { clientIp } from "@/lib/api";
import { isBotBlocked } from "@/lib/ua";
import { recordVisit } from "@/lib/visitLog";

/** 访客只需要这几个：搜索、筛选分面、定位反查城市、读兜底推广码、埋点 */
const PUBLIC_API = new Set([
  "/api/search",
  "/api/facets",
  "/api/locate",
  "/api/log",
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

/**
 * 访问日志：proxy 是唯一「所有页面 + 接口都过一遍」的地方，埋在这里才不漏。
 * 一律 `void`（不 await）——日志不能拖慢响应，写失败由 recordVisit 自己吞掉。
 *
 * status 传 0 表示「放行，最终状态由后面的路由决定」；被这里拦下的（403/401/503）
 * 才记真实状态码，这样报表里能直接看出「拦了多少爬虫」。
 */
function logVisit(req: NextRequest, pathname: string, status: number) {
  const headers = req.headers;
  const isApi = pathname.startsWith("/api/");
  // 车场页把 park_code 抽出来，报表才能回答「哪个车场被看/被出码了多少次」
  let parkCode = "";
  if (pathname.startsWith("/park/")) {
    try {
      parkCode = decodeURIComponent(pathname.slice("/park/".length)).split("/")[0];
    } catch {
      parkCode = "";
    }
  }
  void recordVisit({
    kind: isApi ? "api" : "page",
    name: isApi ? pathname.replace(/^\/api\//, "").split("/")[0] : "",
    path: pathname,
    referer: headers.get("referer") ?? "",
    ua: headers.get("user-agent") ?? "",
    ip: clientIp(req),
    country: headers.get("eo-country-name") ?? headers.get("eo-country") ?? "",
    region: headers.get("eo-client-region") ?? headers.get("eo-region") ?? "",
    status,
    // EdgeOne 回源一定会带 EO-Connecting-IP；没有这个头就是没经过 CDN（直连源站）
    viaCdn: headers.has("eo-connecting-ip") || headers.has("cf-connecting-ip"),
    parkCode,
    // 搜索词记在访问日志里，爬虫刷的搜索词也能一并看到（前端埋点只能收真人的）
    q: isApi && pathname.endsWith("/search") ? (req.nextUrl.searchParams.get("q") ?? "") : "",
  });
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // 后台是自己的地盘，不进日志（否则运维操作会污染 UV 和爬虫榜）
  const trackable = !pathname.startsWith("/admin/") && pathname !== "/api/log";

  if (isBotBlocked(req.headers.get("user-agent") ?? "")) {
    if (trackable) logVisit(req, pathname, 403);
    return new NextResponse("本站内容不提供给采集工具", {
      status: 403,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }

  if (pathname === "/" || pathname.startsWith("/city/") || pathname.startsWith("/park/")) {
    if (trackable) logVisit(req, pathname, 0);
    const res = NextResponse.next();
    res.headers.set("Cache-Control", LANDING_CACHE_CONTROL);
    return res;
  }

  if (isPublic(pathname, req.method)) {
    if (trackable) logVisit(req, pathname, 0);
    return NextResponse.next();
  }

  const isApi = pathname.startsWith("/api/");
  // 口令只挡后台：sitemap.xml / robots.txt 这类对外路由也被 matcher 收进来了，
  // 不能顺手落进鉴权分支（否则线上会回 503 而不是 sitemap）
  if (!isApi && !pathname.startsWith("/admin/")) {
    if (trackable) logVisit(req, pathname, 0);
    return NextResponse.next();
  }

  // 后台接口的未授权访问也要留痕：有人扫后台是明确信号
  const password = process.env.ADMIN_PASSWORD ?? "";

  if (!password) {
    if (trackable) logVisit(req, pathname, 503);
    // 本地开发免密；生产环境强制要求配置，避免默认口令上线
    if (process.env.NODE_ENV !== "production") return NextResponse.next();
    return isApi
      ? NextResponse.json({ ok: false, error: "服务端未配置 ADMIN_PASSWORD" }, { status: 503 })
      : new NextResponse("服务端未配置 ADMIN_PASSWORD", { status: 503 });
  }

  const token = req.cookies.get(ADMIN_COOKIE)?.value;
  if (await isValidAdminToken(token, password)) return NextResponse.next();

  if (trackable) logVisit(req, pathname, 401);
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

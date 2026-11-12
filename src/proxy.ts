import { NextResponse, type NextRequest } from "next/server";
import { isAdminDevBypass, verifyAdminRequest } from "@/lib/adminAuth";
import { clientIp } from "@/lib/api";
import { routeExists } from "@/lib/routeGuard";
import { isBotBlocked } from "@/lib/ua";
import { recordVisit } from "@/lib/visitLog";

/** 访客只需要这几个：搜索、筛选分面、定位反查城市、读兜底推广码、埋点 */
const PUBLIC_API = new Set([
  "/api/search",
  "/api/nearby",
  "/api/facets",
  "/api/locate",
  "/api/log",
  // 登录页要靠它判断「没登录 / 已登录但不是管理员 / 可以进」，必须免鉴权；
  // 它只回身份概要（昵称头像 + 是否管理员），不含任何业务数据
  "/api/admin/session",
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
 * 落地页 404 页。刻意内联一份而不是走 app/not-found.tsx：
 * 这个响应是 proxy 直接吐的，要的是「真 404 状态码」，而 PPR 下页面里
 * notFound() 只能得到 200（见 routeGuard 注释）。
 * 样式全内联，不依赖 CSS chunk，保证这一页永远能正常显示。
 */
const NOT_FOUND_HTML = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>页面不存在｜泊月</title><meta name="robots" content="noindex,follow">
</head><body style="margin:0;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#f5f6f8;font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif;color:#10141c;padding:40px 24px;text-align:center">
<svg viewBox="0 0 128 128" style="width:44px;height:44px;margin-bottom:18px"><path fill="#1b6bff" d="M64 14 c-19 0 -34 15 -34 33 c0 24 34 61 34 61 s34 -37 34 -61 c0 -18 -15 -33 -34 -33 Z"/><path d="M54 82 V42 H66 a13 13 0 0 1 0 26 H54" fill="none" stroke="#ffffff" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/></svg>
<div style="font-size:19px;font-weight:600">这个页面不存在</div>
<div style="margin-top:10px;font-size:13px;line-height:1.7;color:#6b7280;max-width:320px">可能是车场或城市已经下架，也可能是链接输错了。</div>
<a href="/" style="margin-top:22px;display:inline-block;padding:9px 18px;border-radius:10px;background:#1b6bff;color:#fff;font-size:13px;font-weight:600;text-decoration:none">回首页搜附近车场</a>
</body></html>`;

function notFoundPage(): NextResponse {
  return new NextResponse(NOT_FOUND_HTML, {
    status: 404,
    headers: {
      "content-type": "text/html; charset=utf-8",
      // 也让它被 CDN 缓存一会儿，免得爬虫拿错链反复打源站
      "cache-control": "public, max-age=300",
    },
  });
}

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
    // 落地页先过一次存在性白名单：不存在的当场 404，别让页面渲染完再 notFound()
    // ——PPR 下那只能得到一个「200 的 404 页」（见 routeGuard 注释）
    if (pathname !== "/" && !(await routeExists(pathname))) {
      if (trackable) logVisit(req, pathname, 404);
      return notFoundPage();
    }
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

  // 后台不再有口令：身份来自 wx-auth 扫码登录写下的根域 Cookie（wxauth-token），
  // 管理员判定看 wx-auth 返回的 user.isAdmin。未授权访问也要留痕——有人扫后台是明确信号。
  if (isAdminDevBypass()) {
    if (trackable) logVisit(req, pathname, 0);
    return NextResponse.next();
  }

  const verdict = await verifyAdminRequest(req);

  if (verdict.status === "ok") {
    if (trackable) logVisit(req, pathname, 0);
    return NextResponse.next();
  }

  // wx-auth 自己抖了（超时/5xx/限流）：既不是登录失效也不是越权，
  // 单独一档，别让管理员以为账号被踢了
  if (verdict.status === "transient") {
    if (trackable) logVisit(req, pathname, 503);
    return isApi
      ? NextResponse.json({ ok: false, error: "登录服务暂时不可用，请稍后重试" }, { status: 503 })
      : new NextResponse("登录服务暂时不可用，请稍后重试", {
          status: 503,
          headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
        });
  }

  // 登录了但不是管理员：明确告诉他换账号，别再反复弹扫码
  if (verdict.status === "denied") {
    if (trackable) logVisit(req, pathname, 403);
    if (isApi) {
      return NextResponse.json({ ok: false, error: "当前微信不是管理员" }, { status: 403 });
    }
    const url = req.nextUrl.clone();
    url.pathname = "/admin/login";
    url.search = "";
    url.searchParams.set("denied", "1");
    return NextResponse.redirect(url);
  }

  if (trackable) logVisit(req, pathname, 401);
  if (isApi) {
    return NextResponse.json({ ok: false, error: "请先用微信扫码登录管理后台" }, { status: 401 });
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

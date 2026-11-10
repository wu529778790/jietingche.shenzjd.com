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
 * 落地页（city/district/park）的 CDN 缓存头。
 * 这些路由是阻塞式渲染（instant=false），Next 恒发 no-store，中间件在这里覆盖成
 * 可被 EdgeOne 缓存的头；数据新鲜度由页面内 use cache 保证（seo.ts LANDING_CACHE_LIFE），
 * s-maxage 与其 revalidate 保持一致，别让 CDN 窗口超过数据缓存窗口。
 */
const LANDING_CACHE_CONTROL =
  "public, max-age=60, s-maxage=300, stale-while-revalidate=86400";

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname.startsWith("/city/") || pathname.startsWith("/park/")) {
    const res = NextResponse.next();
    res.headers.set("Cache-Control", LANDING_CACHE_CONTROL);
    return res;
  }

  if (isPublic(pathname, req.method)) return NextResponse.next();

  const isApi = pathname.startsWith("/api/");
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
  matcher: ["/admin/:path*", "/api/:path*", "/city/:path*", "/park/:path*"],
};

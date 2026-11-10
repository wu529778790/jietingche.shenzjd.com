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
  if (PUBLIC_API.has(pathname)) return true;
  return pathname === "/api/config" && method === "GET";
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
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
  matcher: ["/admin/:path*", "/api/:path*"],
};

import { NextResponse } from "next/server";
import { WX_AUTH_COOKIE } from "@/lib/adminAuth";

/** 老口令时代的 Cookie，退出时顺手清掉，免得浏览器里留一堆垃圾 */
const LEGACY_COOKIE = "jtc_admin";

/**
 * 退出登录。
 *
 * 真正的登录态是 wx-auth SDK 写在**根域**的 `wxauth-token`（domain=.shenzjd.com），
 * 所以清它必须带同一个 domain，否则浏览器只把 host-only 的那份清掉。
 */
function rootDomain(hostname: string): string | undefined {
  // 站点固定在 shenzjd.com 下；IP / localhost 不设 domain（本来就写不进去）
  if (hostname === "shenzjd.com" || hostname.endsWith(".shenzjd.com")) return ".shenzjd.com";
  return undefined;
}

export async function POST(req: Request) {
  let hostname = "";
  try {
    hostname = new URL(req.url).hostname;
  } catch {
    hostname = "";
  }
  const domain = rootDomain(hostname);

  const res = NextResponse.json({ ok: true });
  // 域名版和 host-only 版各清一次：SDK 写入失败时会退化成 host-only
  res.cookies.set(WX_AUTH_COOKIE, "", { path: "/", maxAge: 0, ...(domain ? { domain } : {}) });
  res.cookies.set(WX_AUTH_COOKIE, "", { path: "/", maxAge: 0 });
  res.cookies.set(LEGACY_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}

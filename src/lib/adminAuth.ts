/**
 * 管理后台鉴权：接 wx-auth 统一账号体系，不再用口令。
 *
 * 登录怎么发生：后台登录页加载 wx-auth SDK 出小程序码，扫码后 SDK 把 wx-auth 签发的
 * token 写进**根域 Cookie `wxauth-token`**（domain=.shenzjd.com）。本站与
 * wx-auth.shenzjd.com 同根域，所以浏览器访问 jietingche.shenzjd.com 时会自动带上它，
 * 后端不需要额外的换票接口。
 *
 * 怎么判管理员：拿这个 token 问 wx-auth 要身份，
 *   GET {WX_AUTH_API_BASE}/api/auth/userinfo?token=...
 *   → { authenticated: true, user: { openid, nickname, avatarUrl, isAdmin, ... } }
 * 只有 `user.isAdmin === true` 放行（fail-closed）。
 *
 * 缓存：同一 token 10 分钟内不重复问远程（管理员标记几乎不变，而后台一屏会并发多个接口，
 * 每次请求都打一遍远程序会把后台拖慢一个量级）。只有拿到明确结论才写缓存；
 * 网络失败/5xx 归为 transient，不写缓存、也不清登录态——恢复后下一次请求立即生效。
 */
export const WX_AUTH_COOKIE = "wxauth-token";

/** wx-auth 服务地址：线上同根域，默认值即可；本地可用 WX_AUTH_API_BASE 指到线上 */
export function wxAuthBase(): string {
  return (process.env.WX_AUTH_API_BASE ?? "https://wx-auth.shenzjd.com").replace(/\/+$/, "");
}

/** 单次远程校验上限。后台是低频操作，宁可等一下也不要误判成未登录 */
const VERIFY_TIMEOUT_MS = 8000;
/** 明确结论的缓存时长（与 wx-auth README 建议的 5~10 分钟一致） */
const VERDICT_TTL_MS = 10 * 60 * 1000;

export type AdminStatus = "ok" | "anon" | "denied" | "transient";

export interface AdminIdentity {
  openid: string;
  nickname: string;
  avatarUrl: string;
  isAdmin: boolean;
}

export interface AdminVerdict {
  status: AdminStatus;
  identity?: AdminIdentity;
  /** 命中本地缓存（日志/排查用） */
  cached?: boolean;
}

const verdictCache = new Map<string, { verdict: AdminVerdict; expiresAt: number }>();

/** 测试用：清空缓存 */
export function resetAdminCache(): void {
  verdictCache.clear();
}

function remember(token: string, verdict: AdminVerdict, now: number): void {
  verdictCache.set(token, { verdict, expiresAt: now + VERDICT_TTL_MS });
  // 防无限膨胀：超过 5000 条时清掉过期项
  if (verdictCache.size > 5000) {
    for (const [key, entry] of verdictCache) {
      if (entry.expiresAt <= now) verdictCache.delete(key);
    }
  }
}

/** 从 Authorization: Bearer 或 wxauth-token Cookie 里取凭证（Bearer 优先，方便脚本/接口调用） */
export function readWxAuthToken(headers: Headers): string {
  const auth = headers.get("authorization") ?? "";
  if (auth.startsWith("Bearer ")) {
    const token = auth.slice("Bearer ".length).trim();
    if (token) return token;
  }
  const raw = headers.get("cookie") ?? "";
  for (const part of raw.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== WX_AUTH_COOKIE) continue;
    const value = part.slice(eq + 1).trim();
    if (!value) continue;
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return "";
}

/** 校验一个 token：问 wx-auth 要身份并判定管理员 */
export async function verifyAdminToken(token: string): Promise<AdminVerdict> {
  if (!token) return { status: "anon" };

  const now = Date.now();
  const hit = verdictCache.get(token);
  if (hit && hit.expiresAt > now) return { ...hit.verdict, cached: true };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${wxAuthBase()}/api/auth/userinfo?token=${encodeURIComponent(token)}`, {
      signal: controller.signal,
      headers: { accept: "application/json" },
      cache: "no-store",
    });
  } catch {
    // 超时/网络不通：不能当成"登录失效"，否则 wx-auth 抖一下管理员就进不去后台
    return { status: "transient" };
  } finally {
    clearTimeout(timer);
  }

  const data = (await res.json().catch(() => null)) as {
    authenticated?: boolean;
    error?: string;
    user?: {
      openid?: string;
      nickname?: string;
      avatarUrl?: string;
      headimgurl?: string;
      isAdmin?: boolean;
    };
  } | null;

  if (data?.authenticated === true && data.user) {
    const identity: AdminIdentity = {
      openid: data.user.openid ?? "",
      nickname: data.user.nickname ?? "",
      avatarUrl: data.user.avatarUrl ?? data.user.headimgurl ?? "",
      isAdmin: data.user.isAdmin === true,
    };
    const verdict: AdminVerdict = identity.isAdmin
      ? { status: "ok", identity }
      : { status: "denied", identity };
    remember(token, verdict, now);
    return verdict;
  }

  if (data && data.authenticated === false) {
    // server_error / rate_limited 是服务侧抖动；其余（invalid_token / revoked / not_found）是明确失效
    if (data.error === "server_error" || data.error === "rate_limited") {
      return { status: "transient" };
    }
    const verdict: AdminVerdict = { status: "anon" };
    remember(token, verdict, now);
    return verdict;
  }

  // 非 2xx 且没有结构化响应（520/502/HTML 错误页等）：按瞬时故障处理，不清登录态
  return { status: "transient" };
}

/** 从一个请求判定后台身份（proxy 与路由都能用） */
export async function verifyAdminRequest(req: Request): Promise<AdminVerdict> {
  return verifyAdminToken(readWxAuthToken(req.headers));
}

/**
 * 本地开发放行：`next dev` 下没有 wx-auth Cookie，不登录也能调后台接口。
 * 生产环境恒为 false——线上只认 wx-auth 的 isAdmin。
 */
export function isAdminDevBypass(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.ADMIN_DEV_REQUIRE_WX_AUTH !== "1";
}

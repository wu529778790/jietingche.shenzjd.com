/**
 * 管理端口令鉴权（Edge middleware 与 Node 路由都能用，只依赖 Web Crypto）
 * 口令来自环境变量 ADMIN_PASSWORD；生产环境未配置时后台一律不可用。
 */
export const ADMIN_COOKIE = "jtc_admin";
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function adminPassword(): string {
  return process.env.ADMIN_PASSWORD ?? "";
}

async function hmacHex(password: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function createAdminToken(password: string): Promise<string> {
  const ts = String(Date.now());
  return `${ts}.${await hmacHex(password, ts)}`;
}

export async function isValidAdminToken(
  token: string | undefined,
  password: string,
): Promise<boolean> {
  if (!token || !password) return false;
  const [ts, sig] = token.split(".");
  if (!ts || !sig) return false;
  const age = Date.now() - Number(ts);
  if (!Number.isFinite(age) || age < 0 || age > TOKEN_TTL_MS) return false;
  const expected = await hmacHex(password, ts);
  if (expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) {
    diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  }
  return diff === 0;
}

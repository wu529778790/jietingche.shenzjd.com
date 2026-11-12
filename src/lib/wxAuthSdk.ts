/**
 * wx-auth SDK 的浏览器端加载（只有后台登录页用，所以不做全局布局注入）。
 *
 * 为什么走 CDN 而不是装 npm 包：SDK 是用户在多个站点共用的一份 UMD，
 * 版本与 wx-auth 服务端一起演进，CDN 上 `@^1.2.44` 自然跟随 1.x。
 * 两个候选（unpkg 主、jsdelivr 备）逐个尝试并各带超时——黑洞连接时
 * onerror 不会触发，只有定时器能兜住。
 *
 * 扫码成功后 SDK 会自己把 token 写进**根域** Cookie `wxauth-token`，
 * 我们不需要接收 token，只要知道"登录态可能变了"就够了。
 */
const SDK_JS_URLS = [
  "https://unpkg.com/wx-auth-sdk@^1.2.44/dist/wx-auth.umd.js",
  "https://cdn.jsdelivr.net/npm/wx-auth-sdk@1/dist/wx-auth.umd.js",
];
const SDK_CSS_URLS = [
  "https://unpkg.com/wx-auth-sdk@^1.2.44/dist/wx-auth.css",
  "https://cdn.jsdelivr.net/npm/wx-auth-sdk@1/dist/wx-auth.css",
];
const ATTEMPT_TIMEOUT_MS = 6000;

export interface WxAuthSdk {
  init(options: {
    apiBase?: string;
    silent?: boolean;
    required?: boolean;
    onVerified?: (user: { nickname?: string } | null) => void;
  }): void;
  requireAuth(options?: { required?: boolean }): Promise<unknown>;
  close(): void;
  clearToken?(): void;
}

declare global {
  interface Window {
    WxAuth?: WxAuthSdk;
  }
}

function injectCss(): void {
  if (document.querySelector("link[data-wx-auth-css]")) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = SDK_CSS_URLS[0];
  link.dataset.wxAuthCss = "1";
  link.onerror = () => {
    if (link.href !== SDK_CSS_URLS[1]) link.href = SDK_CSS_URLS[1];
  };
  document.head.appendChild(link);
}

function loadScript(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const el = document.createElement("script");
    let settled = false;
    const timer = setTimeout(() => settle(new Error(`加载超时：${url}`)), ATTEMPT_TIMEOUT_MS);
    function settle(err?: Error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err || !window.WxAuth) {
        el.remove();
        reject(err ?? new Error(`未挂载 WxAuth：${url}`));
        return;
      }
      resolve();
    }
    el.src = url;
    el.onload = () => settle();
    el.onerror = () => settle(new Error(`加载失败：${url}`));
    document.head.appendChild(el);
  });
}

/** 依次试 CDN，直到 window.WxAuth 就绪 */
export async function loadWxAuthSdk(): Promise<void> {
  if (typeof window === "undefined") throw new Error("仅浏览器可用");
  if (window.WxAuth) return;
  injectCss();
  let lastError: Error | null = null;
  for (const url of SDK_JS_URLS) {
    try {
      await loadScript(url);
      return;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }
  throw lastError ?? new Error("wx-auth SDK 加载失败");
}

/**
 * 清掉当前 wx-auth 登录态（换账号用）。
 *
 * SDK 内部会缓存 token，光删 Cookie 不够——requireAuth 可能直接拿旧 token 返回，
 * 于是在弹窗里换不了人。cookie 要按根域和 host-only 各删一次（SDK 写根域，
 * 写入失败时会退化成 host-only）。
 */
export function clearWxAuthSession(): void {
  if (typeof window === "undefined") return;
  try {
    window.WxAuth?.clearToken?.();
  } catch {
    // SDK 没加载或版本不支持都无所谓，下面直接删 Cookie
  }
  const host = window.location.hostname;
  const domain = host === "shenzjd.com" || host.endsWith(".shenzjd.com") ? "; domain=.shenzjd.com" : "";
  document.cookie = `wxauth-token=; path=/; max-age=0${domain}`;
  document.cookie = "wxauth-token=; path=/; max-age=0";
}

/**
 * 打开扫码登录，登录成功后回调。
 * `onVerified` 可能在 requireAuth resolve 之前/之后触发，调用方自己去重。
 */
export async function openWxAuthLogin(onVerified: () => void): Promise<void> {
  await loadWxAuthSdk();
  const sdk = window.WxAuth;
  if (!sdk) throw new Error("wx-auth SDK 未就绪");
  sdk.init({ silent: true, required: false, onVerified: () => onVerified() });
  await sdk.requireAuth({ required: true });
}

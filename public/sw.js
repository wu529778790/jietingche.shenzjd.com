/* 泊月 · Service Worker
 *
 * 目的只有三个：能装到桌面（安卓/Chrome 要求有 SW）、弱网秒开、断网不白屏。
 * 不追求离线可用——这个站的搜索结果是实时的，真离线只能给个提示页。
 *
 * 策略：
 *  1. 页面导航（navigate）：网络优先，3.5 秒没回来就吃缓存，再没有就吐 /offline；
 *  2. /_next/static、图片、字体、图标：缓存优先（这些 URL 带 hash，变了就是新 URL）；
 *  3. /api/*：完全不拦。价格和库存都是实时的，缓存等于给用户看错价；
 *  4. 其他同源 GET：网络优先，失败回缓存。
 *
 * 改了预缓存列表或策略，把 VERSION 加一，activate 里会把上一版本的 cache 全清掉。
 * 部署侧注意：CDN / 反向代理不要给 /sw.js 配长缓存，否则新版本要等缓存过期才生效。
 */
const VERSION = "1";
const PAGES = `boyue-pages-v${VERSION}`;
const ASSETS = `boyue-assets-v${VERSION}`;
const OFFLINE_URL = "/offline";
const TIMEOUT = 3500;

/** 安装时就抓下来的东西：离线页 + 图标 + 清单，都很小 */
const PRECACHE = [
  OFFLINE_URL,
  "/icon.svg",
  "/apple-icon.png",
  "/icons/icon-192.png",
  "/manifest.webmanifest",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(ASSETS);
      // 逐个装：任何一个 404/超时都不能让整个 install 失败，否则永远装不上
      await Promise.all(PRECACHE.map((url) => cache.add(url).catch(() => {})));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((key) => key !== PAGES && key !== ASSETS).map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

function isStaticAsset(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/_next/image") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/icon.svg" ||
    url.pathname === "/apple-icon.png" ||
    url.pathname === "/og.png" ||
    url.pathname === "/manifest.webmanifest" ||
    /\.(?:css|js|mjs|woff2?|ttf|png|jpe?g|webp|avif|svg|ico)$/i.test(url.pathname)
  );
}

function cacheable(res) {
  return res && res.ok && res.type === "basic" && !res.redirected;
}

async function putIn(cacheName, request, response) {
  try {
    const cache = await caches.open(cacheName);
    await cache.put(request, response);
  } catch {
    // 配额满了或者响应体已被消费，缓存失败不应该影响这次请求
  }
}

async function networkFirst(request, cacheName) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const res = await fetch(request, { signal: controller.signal });
    if (cacheable(res)) void putIn(cacheName, request, res.clone());
    return res;
  } catch (err) {
    const cache = await caches.open(cacheName);
    // ignoreSearch：首页带 ?utm_xxx 进来也能命中缓存那份
    const hit = await cache.match(request, { ignoreSearch: true });
    if (hit) return hit;
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(ASSETS);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (cacheable(res)) void putIn(ASSETS, request, res.clone());
  return res;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // 接口一律走网络：实时价格 + 转存/出码都是写操作，缓存没有意义还危险
  if (url.pathname.startsWith("/api/")) return;
  // SW 自己不能被缓存住，否则永远升不上去
  if (url.pathname === "/sw.js") return;

  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          return await networkFirst(request, PAGES);
        } catch {
          const offline = await caches.match(OFFLINE_URL);
          if (offline) return offline;
          return new Response("当前网络不可用，请连上网络后重试。", {
            status: 503,
            headers: { "content-type": "text/plain; charset=utf-8" },
          });
        }
      })(),
    );
    return;
  }

  if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  event.respondWith(
    (async () => {
      try {
        return await networkFirst(request, ASSETS);
      } catch {
        return new Response("", { status: 504 });
      }
    })(),
  );
});

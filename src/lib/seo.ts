/**
 * SEO 落地页共用的站点常量与路径规则。
 *
 * 车场页用官方 park_code（p240570581），不用内部 id（jtc_p240570581），
 * 短、稳定、可读；城市/区域直接用中文段，百度/Google 都认，且和用户搜索词一致。
 */

export const SITE_NAME = "泊月";

/**
 * 站点一句话定位，标题栏、OG 图、页头副标题共用。
 *
 * 三层结构：品类词「停车月卡」（用户真会搜的词）+ 位置「附近」+ 利益「谁家最省」。
 * 不用「便宜 / 优惠」当主词：搜「便宜的停车场」的人多是找临停和免费位，我们接不住；
 * 「优惠」在停车行业还专指临停折扣券，容易误解。也不叫「比价」——比价是工具，
 * 用户要的是「我车停哪儿」，价格只是筛选维度之一。
 */
export const SITE_TAGLINE = "停车月卡，附近谁家最省";

/** 1200×630 分享图，源文件见 scripts/brand/og-card.html */
export const OG_IMAGE = "/og.png";

/** 线上域名。构建期没有环境变量时兜底到生产域名，避免 canonical 指向 localhost */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL || "https://jietingche.shenzjd.com"
).replace(/\/+$/, "");

export function absoluteUrl(path: string): string {
  if (!path) return SITE_URL;
  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * 落地页（city/district/park）缓存策略，三个页面统一引用：
 * 浏览器 max-age 60s，CDN s-maxage 300s（每 5 分钟回源刷一次），过期后还有 SWR 余量。
 * 改这里即可同步调整三页。
 */
export const LANDING_CACHE_LIFE = { stale: 60, revalidate: 300, expire: 86400 } as const;

/** 落地页车场列表条数：100+ 条把 HTML 撑到 326KB，40 条足够覆盖「最划算」的长尾 */
export const LANDING_PAGE_SIZE = 40;

export function parkPath(code: string): string {
  return `/park/${encodeURIComponent(code)}`;
}

export function cityPath(city: string): string {
  return `/city/${encodeURIComponent(city)}`;
}

export function districtPath(city: string, district: string): string {
  return `/city/${encodeURIComponent(city)}/${encodeURIComponent(district)}`;
}

/**
 * 城市页分页。第 1 页就是城市页本身，别产生 /page/1 的重复 URL。
 * 分页页只作为「爬虫走到全部车场」的通道，第 2 页起 noindex、follow。
 */
export function cityPagePath(city: string, page: number): string {
  return page <= 1 ? cityPath(city) : `${cityPath(city)}/page/${page}`;
}

/** 「深圳市」→「深圳」，用于标题里更自然的写法 */
export function cityShort(city: string): string {
  return city.replace(/市$/, "");
}

/** 月均价格按整元展示，SEO 描述里出现小数反而奇怪 */
export function monthlyText(cent: number): string {
  if (!cent || cent <= 0) return "";
  return `¥${Math.round(cent / 100)}`;
}

/** 面包屑结构化数据；最后一级（当前页）可以没有 path */
export function breadcrumbJsonLd(items: { name: string; path?: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      ...(item.path ? { item: absoluteUrl(item.path) } : {}),
    })),
  };
}

/**
 * 常见问题结构化数据。
 *
 * 页面上的 FAQ 和这里必须是同一批问答——渲染用的数据数组直接喂进来，
 * 别另写一份，否则文案改了结构化数据还是旧的，Google 会判不一致。
 */
export function faqJsonLd(items: { q: string; a: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a },
    })),
  };
}

/** 城市/区域页的车场列表结构化数据；分页时用 startAt 让 position 接上前一页 */
export function parksJsonLd(
  parks: { name: string; parkCode: string; minMonthly: number }[],
  city: string,
  startAt = 1,
) {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: `${cityShort(city)}停车月卡车场`,
    numberOfItems: parks.length,
    itemListElement: parks.map((park, index) => ({
      "@type": "ListItem",
      position: startAt + index,
      url: absoluteUrl(parkPath(park.parkCode)),
      name: park.name,
    })),
  };
}

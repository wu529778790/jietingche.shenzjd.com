/**
 * SEO 落地页共用的站点常量与路径规则。
 *
 * 车场页用官方 park_code（p240570581），不用内部 id（jtc_p240570581），
 * 短、稳定、可读；城市/区域直接用中文段，百度/Google 都认，且和用户搜索词一致。
 */

export const SITE_NAME = "找停车";

/** 线上域名。构建期没有环境变量时兜底到生产域名，避免 canonical 指向 localhost */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL || "https://jietingche.shenzjd.com"
).replace(/\/+$/, "");

export function absoluteUrl(path: string): string {
  if (!path) return SITE_URL;
  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

export function parkPath(code: string): string {
  return `/park/${encodeURIComponent(code)}`;
}

export function cityPath(city: string): string {
  return `/city/${encodeURIComponent(city)}`;
}

export function districtPath(city: string, district: string): string {
  return `/city/${encodeURIComponent(city)}/${encodeURIComponent(district)}`;
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

/** 城市/区域页的车场列表结构化数据 */
export function parksJsonLd(
  parks: { name: string; parkCode: string; minMonthly: number }[],
  city: string,
) {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: `${cityShort(city)}停车月卡车场`,
    numberOfItems: parks.length,
    itemListElement: parks.map((park, index) => ({
      "@type": "ListItem",
      position: index + 1,
      url: absoluteUrl(parkPath(park.parkCode)),
      name: park.name,
    })),
  };
}

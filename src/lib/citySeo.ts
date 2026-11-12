import { cache } from "react";
import { getCitySeo, type CitySeo } from "./seoRepo";

/**
 * 城市落地页的数据源，城市页与它的分页路由共用。
 *
 * 用 React 的 cache() 包一层：同一次请求里 generateMetadata 和页面各要一次城市聚合，
 * 不包的话每个请求要查两遍库。
 * 兼容「/city/深圳」这种不带「市」的写法——库里存的是「深圳市」，
 * 直接拿「深圳」查会得到 0 个车场，页面就被当成空城市 404 了。
 */
export const loadCity = cache(async (raw: string): Promise<CitySeo | null> => {
  const name = decodeURIComponent(raw);
  const direct = await getCitySeo(name);
  if (direct.parkCount > 0) return direct;
  if (!name.endsWith("市")) {
    const withSuffix = await getCitySeo(`${name}市`);
    if (withSuffix.parkCount > 0) return withSuffix;
  }
  return null;
});

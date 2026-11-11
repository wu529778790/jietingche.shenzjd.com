import { apiJson, preflight } from "@/lib/api";
import { searchPublic } from "@/lib/repo";

/** 单个筛选项最长长度：超长串既没有匹配意义，还会让 LIKE 白扫一遍全表 */
const MAX_PARAM_LEN = 40;
/** 页码上限：总数才 8.4k，200 页 × 50 条已经覆盖到底，挡住 page=999999 的深翻页扫描 */
const MAX_PAGE = 200;
const SORTS = new Set(["recommend", "distance", "price"]);

function strParam(url: URL, key: string): string {
  return (url.searchParams.get(key) ?? "").trim().slice(0, MAX_PARAM_LEN);
}

function numParam(url: URL, key: string): number | undefined {
  const raw = url.searchParams.get(key);
  if (raw === null || raw.trim() === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

function pageParam(url: URL): number {
  const n = numParam(url, "page");
  return Math.min(MAX_PAGE, Math.max(1, Math.floor(n ?? 1)));
}

/**
 * 访客搜索
 * q / city / district / industry / type / slot / maxPrice（分）/
 * sort=recommend|distance|price / lat / lng / page / pageSize
 *
 * 这是个纯读、结果不带身份的接口，所以尽量让 CDN 命中：坐标由前端取到 3 位小数
 * （≈110m 网格），同一片区访客拼出来的 URL 完全一致，EdgeOne 才有机会命中，
 * 爬虫再来刷也只是吃边缘缓存，不打到源站。
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const sort = strParam(url, "sort");
  const result = await searchPublic({
    q: strParam(url, "q"),
    city: strParam(url, "city"),
    district: strParam(url, "district"),
    industry: strParam(url, "industry"),
    type: strParam(url, "type"),
    slot: strParam(url, "slot"),
    maxPrice: numParam(url, "maxPrice"),
    sort: SORTS.has(sort) ? sort : "recommend",
    lat: numParam(url, "lat"),
    lng: numParam(url, "lng"),
    page: pageParam(url),
    pageSize: numParam(url, "pageSize"),
  });
  return apiJson("search", req, result.parks, {
    limit: 240,
    meta: { total: result.total, page: result.page, pageSize: result.pageSize },
    headers: {
      "Cache-Control": "public, max-age=30, s-maxage=60, stale-while-revalidate=300",
    },
  });
}

export function OPTIONS(req: Request) {
  return preflight(req);
}

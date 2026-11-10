import { apiJson, preflight } from "@/lib/api";
import { searchPublic } from "@/lib/repo";

function strParam(url: URL, key: string): string {
  return (url.searchParams.get(key) ?? "").trim();
}

function numParam(url: URL, key: string): number | undefined {
  const raw = url.searchParams.get(key);
  if (raw === null || raw.trim() === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * 访客搜索
 * q / city / district / industry / type / slot / maxPrice（分）/
 * sort=recommend|distance|price / lat / lng / page / pageSize
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const result = await searchPublic({
    q: strParam(url, "q"),
    city: strParam(url, "city"),
    district: strParam(url, "district"),
    industry: strParam(url, "industry"),
    type: strParam(url, "type"),
    slot: strParam(url, "slot"),
    maxPrice: numParam(url, "maxPrice"),
    sort: strParam(url, "sort") || "recommend",
    lat: numParam(url, "lat"),
    lng: numParam(url, "lng"),
    page: numParam(url, "page"),
    pageSize: numParam(url, "pageSize"),
  });
  return apiJson("search", req, result.parks, {
    limit: 240,
    meta: { total: result.total, page: result.page, pageSize: result.pageSize },
    headers: { "Cache-Control": "public, max-age=30, stale-while-revalidate=60" },
  });
}

export function OPTIONS(req: Request) {
  return preflight(req);
}

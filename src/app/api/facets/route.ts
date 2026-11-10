import { apiJson, preflight } from "@/lib/api";
import { facets } from "@/lib/repo";

/** 筛选栏分面：热门城市 / 区域 / 业态 / 套餐类型 / 时段 */
export async function GET(req: Request) {
  const city = (new URL(req.url).searchParams.get("city") ?? "").trim();
  const data = await facets(city);
  return apiJson("facets", req, data, {
    limit: 120,
    headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=600" },
  });
}

export function OPTIONS(req: Request) {
  return preflight(req);
}

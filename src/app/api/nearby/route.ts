import { apiError, apiJson, preflight } from "@/lib/api";
import { listNearbyByPoint } from "@/lib/repo";

/** 排除列表最多认 40 个 id：再多 URL 就长得没法被 CDN 复用，收益也接近 0 */
const MAX_EXCLUDE = 40;
/** 默认半径档位（km）：3km 是「走路/骑车能到」，10km 是「愿意开车过去」的上限 */
const DEFAULT_RADII = [3, 10];

function numParam(url: URL, key: string): number | undefined {
  const raw = url.searchParams.get(key);
  if (raw === null || raw.trim() === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * 以任意坐标为中心找附近能办月卡的车场。
 *
 * 和 /api/search 分开是因为它有两个消费场景：
 *   1. 首页搜到的结果太少时，拿第一个车场的坐标补一段「附近还有这些」；
 *   2. 以后车场页/地图选点也是同一套逻辑，参数只差一个坐标。
 *
 * 半径走「档位」而不是固定值：3km 内没货自动放到 10km，只回一次，
 * 免得前端先发一趟 3km 再发一趟 10km。实际用的是哪一档在 meta.radiusKm 里回传。
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const lat = numParam(url, "lat");
  const lng = numParam(url, "lng");
  if (
    lat === undefined ||
    lng === undefined ||
    Math.abs(lat) > 90 ||
    Math.abs(lng) > 180
  ) {
    return apiError("nearby", req, "坐标不合法");
  }

  const excludeIds = (url.searchParams.get("exclude") ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
    .slice(0, MAX_EXCLUDE);

  const radius = numParam(url, "radius");
  const limit = numParam(url, "limit");

  const result = await listNearbyByPoint({
    lat,
    lng,
    excludeIds,
    limit,
    radii: radius && radius > 0 ? [Math.min(30, radius)] : DEFAULT_RADII,
  });

  return apiJson("nearby", req, result.parks, {
    limit: 240,
    meta: { radiusKm: result.radiusKm, total: result.parks.length },
    headers: {
      "Cache-Control": "public, max-age=30, s-maxage=60, stale-while-revalidate=300",
    },
  });
}

export function OPTIONS(req: Request) {
  return preflight(req);
}

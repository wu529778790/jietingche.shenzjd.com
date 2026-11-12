import { apiJson, preflight } from "@/lib/api";
import { suggestSearchTerms } from "@/lib/repo";
import { canSuggest } from "@/lib/searchTerms";

/** 输入框只塞得下几个候选，6 条足够；多点一条也点不动 */
const DEFAULT_LIMIT = 6;
const MAX_LIMIT = 12;
/** 一个词最多 16 字，超了就是粘了一整句地址进来，没必要扫全表 */
const MAX_Q_LEN = 16;

function intParam(url: URL, key: string, fallback: number, max: number): number {
  const raw = url.searchParams.get(key);
  if (raw === null || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(1, Math.floor(n)));
}

/**
 * 输入联想：返回库里真实存在的地名写法（楼宇 / 小区 / 路名 / 区名 / 车场名）。
 *
 * 存在的意义是「别让用户搜一个库里没有的词」——
 * 商圈名（海岸城、壹方城）在源数据里根本不存在，联想能在他敲字时就暴露这件事。
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, MAX_Q_LEN);
  const limit = intParam(url, "limit", DEFAULT_LIMIT, MAX_LIMIT);

  // 单个汉字是有效输入；单个拉丁字母是拼音中间态（见 HomeSearch 的 imeOpen）
  const data = canSuggest(q) ? await suggestSearchTerms(q, limit) : [];

  return apiJson("suggest", req, data, {
    limit: 240,
    meta: { total: data.length },
    headers: {
      "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=600",
    },
  });
}

export function OPTIONS(req: Request) {
  return preflight(req);
}

import { apiError, apiJson, preflight } from "@/lib/api";
import { clientIp } from "@/lib/api";
import { recordVisit } from "@/lib/visitLog";

/**
 * 前端埋点接收口（公开）。
 *
 * 只认白名单事件名，字段一律截断——它是公开接口，必须假设有人在往里灌垃圾。
 * 业务侧真正需要的是「有多少人点开了二维码弹层 / 保存了二维码图片」这两步：
 * 之后的扫码发生在捷停车官方小程序里，本站拿不到，这条链路到此为止。
 */
const ALLOWED_EVENTS = new Set(["sheet_open", "qr_save", "search"]);

function cut(value: unknown, max = 60): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const name = cut(body?.e, 20);
  if (!name || !ALLOWED_EVENTS.has(name)) {
    return apiError("log", req, "未知事件", 400);
  }

  const hits = Number(body?.n);
  await recordVisit({
    kind: "event",
    name,
    path: cut(body?.path, 120),
    ua: req.headers.get("user-agent") ?? "",
    ip: clientIp(req),
    referer: req.headers.get("referer") ?? "",
    country: req.headers.get("eo-country-name") ?? "",
    region: req.headers.get("eo-client-region") ?? "",
    viaCdn: req.headers.has("eo-connecting-ip") || req.headers.has("cf-connecting-ip"),
    parkCode: cut(body?.park, 40),
    packageId: cut(body?.pkg, 60),
    q: cut(body?.q, 60),
    extra: Number.isFinite(hits) ? { n: hits } : undefined,
  });

  return apiJson("log", req, { ok: true }, { limit: 120 });
}

export function OPTIONS(req: Request) {
  return preflight(req);
}

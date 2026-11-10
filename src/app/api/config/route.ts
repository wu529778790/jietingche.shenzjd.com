import { NextResponse } from "next/server";
import { apiJson, preflight } from "@/lib/api";
import { getPublicConfig, setConfig } from "@/lib/repo";
import { CONFIG_KEYS } from "@/lib/schema";

/** 站点配置：目前只有兜底推广码 */
export async function GET(req: Request) {
  const data = await getPublicConfig();
  return apiJson("config", req, data, {
    limit: 240,
    headers: { "Cache-Control": "public, max-age=60" },
  });
}

/** 写配置需要后台鉴权（proxy 会拦），这里不加 CORS/限流 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const promoQrPath = typeof body?.promoQrPath === "string" ? body.promoQrPath.trim() : "";
  await setConfig(CONFIG_KEYS.promoQrPath, promoQrPath);
  return NextResponse.json({ ok: true, data: { promoQrPath } });
}

export function OPTIONS(req: Request) {
  return preflight(req);
}

import { NextResponse } from "next/server";
import { getPublicConfig, setConfig } from "@/lib/repo";
import { CONFIG_KEYS } from "@/lib/schema";

/** 站点配置：目前只有兜底推广码 */
export async function GET() {
  const data = await getPublicConfig();
  return NextResponse.json({ ok: true, data });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const promoQrPath = typeof body?.promoQrPath === "string" ? body.promoQrPath.trim() : "";
  await setConfig(CONFIG_KEYS.promoQrPath, promoQrPath);
  return NextResponse.json({ ok: true, data: { promoQrPath } });
}

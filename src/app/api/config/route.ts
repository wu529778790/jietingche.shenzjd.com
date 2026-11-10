import { NextResponse } from "next/server";
import { apiJson, preflight } from "@/lib/api";
import { getPublicConfig } from "@/lib/repo";

/** 站点配置：只下发前端出码用的分佣码，码图本身不落库 */
export async function GET(req: Request) {
  const data = await getPublicConfig();
  return apiJson("config", req, data, {
    limit: 240,
    headers: { "Cache-Control": "public, max-age=60" },
  });
}

export function OPTIONS(req: Request) {
  return preflight(req);
}

/** 保留 POST 语义：码图不再落库，暂无可写配置，直接回当前值避免前端 404 */
export async function POST() {
  const data = await getPublicConfig();
  return NextResponse.json({ ok: true, data });
}

import { NextResponse } from "next/server";
import { facets } from "@/lib/repo";

/** 筛选栏分面：热门城市 / 区域 / 业态 / 套餐类型 / 时段 */
export async function GET(req: Request) {
  const city = (new URL(req.url).searchParams.get("city") ?? "").trim();
  const data = await facets(city);
  return NextResponse.json({ ok: true, data });
}

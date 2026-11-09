import { NextResponse } from "next/server";
import { createPackage, searchPackages } from "@/lib/repo";

/** 对账页选套餐用：按关键词找，避免把几千个车场全塞进下拉框 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const limit = Number(url.searchParams.get("limit") ?? 40) || 40;
  const data = await searchPackages(q, limit);
  return NextResponse.json({ ok: true, data });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parkId = typeof body?.parkId === "string" ? body.parkId : "";
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!parkId || !name) {
    return NextResponse.json({ ok: false, error: "车场和套餐名称必填" }, { status: 400 });
  }
  const id = await createPackage({ ...body, parkId, name });
  return NextResponse.json({ ok: true, data: { id } });
}

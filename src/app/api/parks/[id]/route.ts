import { NextResponse } from "next/server";
import { deletePark, getPark, updatePark } from "@/lib/repo";


type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const data = await getPark(id);
  if (!data) return NextResponse.json({ ok: false, error: "车场不存在" }, { status: 404 });
  return NextResponse.json({ ok: true, data });
}

export async function PATCH(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ ok: false, error: "车场名称必填" }, { status: 400 });
  await updatePark(id, { ...body, name });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  await deletePark(id);
  return NextResponse.json({ ok: true });
}

import { NextResponse } from "next/server";
import { deletePackage, updatePackage } from "@/lib/repo";


type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ ok: false, error: "参数错误" }, { status: 400 });
  await updatePackage(id, body);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  await deletePackage(id);
  return NextResponse.json({ ok: true });
}

import { NextResponse } from "next/server";
import { deleteLog } from "@/lib/repo";


type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  await deleteLog(id);
  return NextResponse.json({ ok: true });
}

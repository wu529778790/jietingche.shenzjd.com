import { NextResponse } from "next/server";
import { listSnapshots, parkStats, upsertSnapshot } from "@/lib/repo";


export async function GET() {
  const [parks, snapshots] = await Promise.all([parkStats(), listSnapshots()]);
  return NextResponse.json({ ok: true, data: { parks, snapshots } });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const statDate = typeof body?.statDate === "string" ? body.statDate : "";
  if (!statDate) {
    return NextResponse.json({ ok: false, error: "日期必填" }, { status: 400 });
  }
  await upsertSnapshot({ ...body, statDate });
  return NextResponse.json({ ok: true });
}

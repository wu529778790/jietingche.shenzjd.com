import { NextResponse } from "next/server";
import { createLog, listLogs } from "@/lib/repo";


export async function GET() {
  const data = await listLogs();
  return NextResponse.json({ ok: true, data });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ ok: false, error: "参数错误" }, { status: 400 });
  const id = await createLog(body);
  return NextResponse.json({ ok: true, data: { id } });
}

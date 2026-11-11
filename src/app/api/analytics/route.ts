import { NextResponse } from "next/server";
import { trafficReport } from "@/lib/analytics";

/** 后台流量报表（proxy 已挡在登录后，这里不再单独鉴权） */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const raw = Number(url.searchParams.get("days") ?? 7);
  const days = Number.isFinite(raw) ? Math.min(90, Math.max(1, Math.floor(raw))) : 7;
  return NextResponse.json({ ok: true, data: await trafficReport(days) });
}

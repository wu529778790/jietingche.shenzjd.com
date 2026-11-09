import { NextResponse } from "next/server";
import { createPark, listParks } from "@/lib/repo";

/** 车场库列表：支持关键词与分页（导入后车场量很大，不能一次全给） */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const page = Number(url.searchParams.get("page") ?? 1) || 1;
  const pageSize = Number(url.searchParams.get("pageSize") ?? 20) || 20;
  const q = (url.searchParams.get("q") ?? "").trim();
  const withQr = url.searchParams.get("withQr") === "1";
  const result = await listParks({ q, page, pageSize, withQr });
  return NextResponse.json({
    ok: true,
    data: result.parks,
    total: result.total,
    page: result.page,
    pageSize: result.pageSize,
  });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ ok: false, error: "车场名称必填" }, { status: 400 });
  }
  const id = await createPark({ ...body, name });
  return NextResponse.json({ ok: true, data: { id } });
}

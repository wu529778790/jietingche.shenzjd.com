import { NextResponse } from "next/server";
import { nearestCity } from "@/lib/repo";

/**
 * 定位反查城市：前端拿到经纬度后问一句「我在哪个城市」，
 * 好把结果默认锁在城市里，不然按价格排会冒出全国的车场。
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const lat = Number(url.searchParams.get("lat"));
  const lng = Number(url.searchParams.get("lng"));
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) {
    return NextResponse.json({ ok: false, error: "缺少有效的经纬度" }, { status: 400 });
  }
  const city = await nearestCity(lat, lng);
  return NextResponse.json({ ok: true, data: { city } });
}

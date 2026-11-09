import { NextResponse } from "next/server";
import { ADMIN_COOKIE, adminPassword, createAdminToken } from "@/lib/adminAuth";

export async function POST(req: Request) {
  const configured = adminPassword();
  if (!configured) {
    return NextResponse.json({ ok: false, error: "服务端未配置 ADMIN_PASSWORD" }, { status: 503 });
  }
  const body = await req.json().catch(() => null);
  const password = typeof body?.password === "string" ? body.password : "";
  if (password !== configured) {
    return NextResponse.json({ ok: false, error: "口令不对" }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, await createAdminToken(configured), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 7 * 24 * 60 * 60,
  });
  return res;
}

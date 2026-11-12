import { NextResponse } from "next/server";
import { isAdminDevBypass, verifyAdminRequest } from "@/lib/adminAuth";

/**
 * 登录页与后台头部用来问「我现在是谁」。
 *
 * 免鉴权（proxy 的 PUBLIC_API 里放行）：它只回身份概要，不含任何业务数据；
 * 未登录、非管理员都要能拿到明确答案，登录页才好分别提示。
 */
export async function GET(req: Request) {
  if (isAdminDevBypass()) {
    return NextResponse.json({
      ok: true,
      data: {
        authenticated: true,
        isAdmin: true,
        nickname: "本地开发",
        avatarUrl: "",
        dev: true,
      },
    });
  }

  const verdict = await verifyAdminRequest(req);
  return NextResponse.json({
    ok: true,
    data: {
      // denied 也算「登录了」，只是身份不够——登录页要提示换账号而不是再扫码
      authenticated: verdict.status === "ok" || verdict.status === "denied",
      isAdmin: verdict.status === "ok",
      nickname: verdict.identity?.nickname ?? "",
      avatarUrl: verdict.identity?.avatarUrl ?? "",
      // wx-auth 抖了：提示稍后重试，别说成未登录
      transient: verdict.status === "transient",
    },
  });
}

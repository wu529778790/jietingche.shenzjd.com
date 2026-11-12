"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { clearWxAuthSession, openWxAuthLogin } from "@/lib/wxAuthSdk";

type Phase = "checking" | "anon" | "denied" | "transient";

interface SessionData {
  authenticated?: boolean;
  isAdmin?: boolean;
  nickname?: string;
  avatarUrl?: string;
  transient?: boolean;
  dev?: boolean;
}

function targetPath(): string {
  const next = new URLSearchParams(window.location.search).get("next") ?? "";
  return next.startsWith("/admin") ? next : "/admin/parks";
}

/**
 * 后台登录页：微信扫码（走 wx-auth 统一账号）。
 *
 * 三种落点：能进就直接跳；登录了但不是管理员要明确告诉他（别再扫码了）；
 * wx-auth 抖动只说"稍后重试"，别让管理员以为账号被踢。
 */
export default function AdminLoginPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("checking");
  const [nickname, setNickname] = useState("");
  const [message, setMessage] = useState("");
  const finished = useRef(false);
  const started = useRef(false);

  const readSession = useCallback(async (): Promise<SessionData | null> => {
    try {
      const res = await fetch("/api/admin/session", { cache: "no-store" });
      const json = (await res.json()) as { data?: SessionData };
      return json?.data ?? null;
    } catch {
      return null;
    }
  }, []);

  /** 登录态可能刚变：确认是管理员才跳，否则给出对应提示 */
  const settle = useCallback(async () => {
    if (finished.current) return;
    finished.current = true;
    const data = await readSession();
    if (!data) {
      finished.current = false;
      setPhase("transient");
      setMessage("读取登录状态失败，稍后重试");
      return;
    }
    if (data.isAdmin) {
      router.replace(targetPath());
      router.refresh();
      return;
    }
    setNickname(data.nickname ?? "");
    if (data.authenticated) {
      setPhase("denied");
    } else {
      finished.current = false;
      setPhase("anon");
      setMessage("没拿到登录态，再扫一次试试");
    }
  }, [readSession, router]);

  useEffect(() => {
    let alive = true;
    const denied = new URLSearchParams(window.location.search).get("denied") === "1";
    void (async () => {
      const data = await readSession();
      if (!alive) return;
      if (!data) {
        setPhase("transient");
        setMessage("读取登录状态失败，稍后重试");
        return;
      }
      if (data.isAdmin) {
        router.replace(targetPath());
        router.refresh();
        return;
      }
      setNickname(data.nickname ?? "");
      if (data.transient && !denied) {
        setPhase("transient");
        setMessage("登录服务暂时不可用，稍后重试");
        return;
      }
      setPhase(denied || data.authenticated ? "denied" : "anon");
    })();
    return () => {
      alive = false;
    };
  }, [readSession, router]);

  async function login() {
    if (started.current) return;
    started.current = true;
    finished.current = false;
    setMessage("");
    setPhase("checking");
    try {
      await openWxAuthLogin(() => {
        void settle();
      });
      // requireAuth 正常 resolve 时 onVerified 可能已经跑过，这里再兜一次（settle 内部去重）
      await settle();
    } catch {
      setPhase("anon");
      setMessage("扫码登录未完成，请重试");
    } finally {
      started.current = false;
    }
  }

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-sm flex-col justify-center">
      <div className="card p-5">
        <div className="text-base font-semibold">管理后台</div>
        <div className="mt-1 text-xs text-muted">车场库、专属码、台账与对账，仅管理员可进</div>

        {phase === "checking" ? (
          <div className="mt-5 space-y-2" aria-hidden="true">
            <div className="h-9 w-full animate-pulse rounded-lg bg-black/[0.06]" />
            <div className="h-3 w-2/3 animate-pulse rounded bg-black/[0.04]" />
          </div>
        ) : null}

        {phase === "anon" ? (
          <div className="mt-4">
            <button className="btn-primary w-full" type="button" onClick={login}>
              微信扫码登录
            </button>
            <div className="mt-2 text-[11px] leading-relaxed text-muted">
              用微信扫小程序码，登录后自动回到后台。没有管理员权限的微信进不来。
            </div>
          </div>
        ) : null}

        {phase === "denied" ? (
          <div className="mt-4">
            <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-700">
              当前微信{nickname ? `（${nickname}）` : ""}不是管理员，换个账号再扫码。
            </div>
            <button
              className="btn-primary mt-3 w-full"
              type="button"
              onClick={() => {
                // 换账号必须先把本地登录态清掉，否则 SDK 会直接拿旧 token 返回
                clearWxAuthSession();
                void login();
              }}
            >
              换个微信扫码
            </button>
          </div>
        ) : null}

        {phase === "transient" ? (
          <div className="mt-4">
            <div className="rounded-lg bg-black/[0.04] px-3 py-2 text-xs leading-relaxed text-muted">
              {message || "登录服务暂时不可用，稍后重试"}
            </div>
            <button
              className="btn-primary mt-3 w-full"
              type="button"
              onClick={() => {
                setPhase("checking");
                void settle();
              }}
            >
              重试
            </button>
          </div>
        ) : null}

        {message && phase === "anon" ? (
          <div className="mt-2 text-xs text-red-500">{message}</div>
        ) : null}
      </div>
      <Link href="/" className="mt-3 text-center text-xs text-muted">
        返回泊月首页
      </Link>
    </div>
  );
}

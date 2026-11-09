"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

export default function AdminLoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.error ?? "登录失败");
        return;
      }
      const next = new URLSearchParams(window.location.search).get("next") ?? "/admin/parks";
      router.replace(next.startsWith("/admin") ? next : "/admin/parks");
      router.refresh();
    } catch {
      setError("网络异常，稍后再试");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-sm flex-col justify-center">
      <div className="card p-5">
        <div className="text-base font-semibold">管理后台</div>
        <div className="mt-1 text-xs text-muted">车场库、专属码、台账与对账，仅管理员可进</div>
        <form className="mt-4 space-y-3" onSubmit={submit}>
          <div>
            <label className="label" htmlFor="admin-password">
              管理口令
            </label>
            <input
              id="admin-password"
              type="password"
              className="field"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="ADMIN_PASSWORD"
              autoComplete="current-password"
              autoFocus
            />
          </div>
          {error ? <div className="text-xs text-red-500">{error}</div> : null}
          <button className="btn-primary w-full" type="submit" disabled={loading || !password}>
            {loading ? "进入中…" : "进入后台"}
          </button>
        </form>
      </div>
      <Link href="/" className="mt-3 text-center text-xs text-muted">
        返回前台找停车
      </Link>
    </div>
  );
}

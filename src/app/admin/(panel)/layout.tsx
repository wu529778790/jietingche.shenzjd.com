"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import BrandMark from "@/components/BrandMark";
import { ADMIN_UNAUTHORIZED_EVENT } from "@/lib/adminClient";

const TABS = [
  { href: "/admin/parks", label: "车场库" },
  { href: "/admin/logs", label: "台账" },
  { href: "/admin/stats", label: "对账" },
  { href: "/admin/traffic", label: "流量" },
];

export default function AdminPanelLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    const onUnauthorized = () => router.push("/admin/login");
    window.addEventListener(ADMIN_UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(ADMIN_UNAUTHORIZED_EVENT, onUnauthorized);
  }, [router]);

  async function logout() {
    await fetch("/api/admin/logout", { method: "POST" });
    router.push("/admin/login");
    router.refresh();
  }

  return (
    <>
      <header className="sticky top-0 z-30 -mx-3 mb-3 border-b border-border bg-card/90 px-3 backdrop-blur">
        <div className="flex w-full items-center gap-1 py-2">
          <div className="mr-2 flex items-center gap-1.5">
            <BrandMark className="h-6 w-6 shrink-0" />
            <span className="hidden text-sm font-semibold sm:block">泊月 · 管理后台</span>
          </div>
          {TABS.map((tab) => (
            <Link
              key={tab.href}
              href={tab.href}
              className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
                pathname.startsWith(tab.href)
                  ? "bg-brand/10 font-medium text-brand"
                  : "text-muted hover:bg-black/5"
              }`}
            >
              {tab.label}
            </Link>
          ))}
          <div className="ml-auto flex items-center gap-1">
            <Link href="/" className="rounded-lg px-2 py-1.5 text-xs text-muted hover:bg-black/5">
              看前台
            </Link>
            <button
              onClick={logout}
              className="rounded-lg px-2 py-1.5 text-xs text-muted hover:bg-black/5"
            >
              退出
            </button>
          </div>
        </div>
      </header>
      {children}
    </>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "找停车" },
  { href: "/parks", label: "车场库" },
  { href: "/logs", label: "台账" },
  { href: "/stats", label: "对账" },
];

export default function Nav() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-card/90 backdrop-blur">
      <div className="mx-auto flex w-full max-w-3xl items-center gap-1 px-3 py-2">
        <div className="mr-2 hidden text-sm font-semibold sm:block">找停车</div>
        {TABS.map((tab) => {
          const active =
            tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
                active
                  ? "bg-brand/10 font-medium text-brand"
                  : "text-muted hover:bg-black/5"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
    </header>
  );
}

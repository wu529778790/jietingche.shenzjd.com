"use client";

import type { ReactNode } from "react";

/** 筛选类弹层共用的小块：分组标题 + 一行可换行的选项 */
export function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="mt-4 first:mt-0">
      <h3 className="mb-2 text-xs font-medium text-foreground/70">{label}</h3>
      <div className="flex flex-wrap gap-2">{children}</div>
    </section>
  );
}

export function Option({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-w-[64px] rounded-lg px-3 py-2 text-xs transition-colors ${
        active
          ? "bg-brand/10 font-medium text-brand ring-1 ring-inset ring-brand"
          : "bg-black/[0.04] text-foreground/80 hover:bg-black/[0.07]"
      }`}
    >
      {children}
    </button>
  );
}

"use client";

import { useState, type ReactNode } from "react";
import { INDUSTRIES, PACKAGE_TYPES, PRICE_STEPS, TIME_SLOTS } from "@/lib/types";

export interface FilterValues {
  district: string;
  industry: string;
  type: string;
  slot: string;
  maxPrice: number;
}

export const EMPTY_FILTERS: FilterValues = {
  district: "",
  industry: "",
  type: "",
  slot: "",
  maxPrice: 0,
};

interface Props {
  value: FilterValues;
  /** 选了城市才展示「区域」，城市由外面那条下拉控制 */
  city: string;
  districts: string[];
  onClose: () => void;
  onApply: (next: FilterValues) => void;
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="mt-4 first:mt-0">
      <h3 className="mb-2 text-xs font-medium text-foreground/70">{label}</h3>
      <div className="flex flex-wrap gap-2">{children}</div>
    </section>
  );
}

function Option({
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

/**
 * 筛选面板：和官方分享中心一致，顶部筛选条只放一个入口，业态/套餐/时段/价格/区域都在面板里选，
 * 点「确定」才生效，「重置」只清空面板里的草稿。
 */
export default function FilterSheet({ value, city, districts, onClose, onApply }: Props) {
  const [draft, setDraft] = useState<FilterValues>(value);
  const patch = (next: Partial<FilterValues>) => setDraft((prev) => ({ ...prev, ...next }));

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
      onClick={onClose}
    >
      <div
        className="flex max-h-[86vh] w-full max-w-lg flex-col rounded-t-2xl bg-card sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 pt-4">
          <h2 className="text-sm font-semibold">筛选</h2>
          <button className="text-xs text-muted" onClick={onClose}>
            关闭
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-3 pt-3">
          <Section label="业态">
            <Option active={draft.industry === ""} onClick={() => patch({ industry: "" })}>
              全部
            </Option>
            {INDUSTRIES.map((item) => (
              <Option
                key={item}
                active={draft.industry === item}
                onClick={() => patch({ industry: draft.industry === item ? "" : item })}
              >
                {item}
              </Option>
            ))}
          </Section>

          <Section label="套餐类型">
            <Option active={draft.type === ""} onClick={() => patch({ type: "" })}>
              全部
            </Option>
            {PACKAGE_TYPES.map((item) => (
              <Option
                key={item}
                active={draft.type === item}
                onClick={() => patch({ type: draft.type === item ? "" : item })}
              >
                {item}
              </Option>
            ))}
          </Section>

          <Section label="停放时间">
            <Option active={draft.slot === ""} onClick={() => patch({ slot: "" })}>
              全部
            </Option>
            {TIME_SLOTS.map((item) => (
              <Option
                key={item}
                active={draft.slot === item}
                onClick={() => patch({ slot: draft.slot === item ? "" : item })}
              >
                {item}
              </Option>
            ))}
          </Section>

          <Section label="价格上限">
            {PRICE_STEPS.map((step) => (
              <Option
                key={step.value}
                active={draft.maxPrice === step.value}
                onClick={() => patch({ maxPrice: step.value })}
              >
                {step.value === 0 ? "不限" : step.label}
              </Option>
            ))}
          </Section>

          {city && districts.length ? (
            <Section label={`区域 · ${city.replace(/市$/, "")}`}>
              <Option active={draft.district === ""} onClick={() => patch({ district: "" })}>
                全部
              </Option>
              {districts.map((item) => (
                <Option
                  key={item}
                  active={draft.district === item}
                  onClick={() => patch({ district: draft.district === item ? "" : item })}
                >
                  {item}
                </Option>
              ))}
            </Section>
          ) : null}
        </div>

        <div className="flex gap-2 border-t border-border px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <button className="btn-ghost flex-1" onClick={() => setDraft(EMPTY_FILTERS)}>
            重置
          </button>
          <button
            className="btn-primary flex-1"
            onClick={() => {
              onApply(draft);
              onClose();
            }}
          >
            确定
          </button>
        </div>
      </div>
    </div>
  );
}

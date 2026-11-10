"use client";

import { useState } from "react";
import { Option, Section } from "@/components/FilterBits";
import { INDUSTRIES, PACKAGE_TYPES, PRICE_STEPS, TIME_SLOTS } from "@/lib/types";

/** 面板只管「车场属性」，地理位置在独立的「位置」弹层里 */
export interface FilterValues {
  industry: string;
  type: string;
  slot: string;
  maxPrice: number;
}

export const EMPTY_FILTERS: FilterValues = {
  industry: "",
  type: "",
  slot: "",
  maxPrice: 0,
};

interface Props {
  value: FilterValues;
  onClose: () => void;
  onApply: (next: FilterValues) => void;
}

/**
 * 筛选面板：业态 / 套餐类型 / 停放时间 / 价格上限，
 * 点「确定」才生效，「重置」只清空面板里的草稿。
 */
export default function FilterSheet({ value, onClose, onApply }: Props) {
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

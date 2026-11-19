/**
 * 领域常量与口径函数的**唯一来源**（站点 + 小工具共用）。
 *
 * 站点：src/lib/types.ts / packageText.ts 从这里 re-export，调用方不用改。
 * 小工具：scripts/build-h5.mjs 用 TypeScript 转译本文件 → 产物根目录 shared.js
 *        （包成 window.__JTC_SHARED__），app.js 从那里取。
 *
 * 硬约束（改之前先看）：
 *   - 本文件必须零 import、零 DOM、零 Node API —— 它要被转译进只跑 Chrome 61 的静态包。
 *   - 只用 ES2015 语法（const/箭头函数/模板串可以，可选链、?? 不行）。
 *   - 不要在 app.js / types.ts 里再抄一份实现：口径一漂移，两边就会给同一个套餐报两个价。
 */

/* ------------------------------ 枚举 ------------------------------ */

export const INDUSTRIES = [
  "商场",
  "写字楼",
  "医院",
  "景区",
  "社区",
  "交通枢纽",
  "其他",
] as const;

/** 停车时段（官方 packageInterval：全天 / 白天 / 夜间） */
export const TIME_SLOTS = ["全天", "白天", "夜间"] as const;
/** 兼容旧名 */
export const PERIODS = TIME_SLOTS;

/** 套餐类型（官方 packageType：月/季/半年/年/日/次，顺序即展示顺序） */
export const PACKAGE_TYPES = ["月卡", "季卡", "半年卡", "年卡", "日卡", "次卡"] as const;

export const SORT_OPTIONS = [
  { value: "recommend", label: "推荐" },
  { value: "distance", label: "离我最近" },
  { value: "price", label: "每月最省" },
] as const;

export type SortValue = (typeof SORT_OPTIONS)[number]["value"];

/** 月均价格档位（分）：卡种混在一起时，按月均预算筛才可比 */
export const PRICE_STEPS = [
  { value: 0, label: "不限" },
  { value: 10000, label: "月均 ¥100 内" },
  { value: 20000, label: "月均 ¥200 内" },
  { value: 30000, label: "月均 ¥300 内" },
  { value: 50000, label: "月均 ¥500 内" },
] as const;

/* ------------------------------ 官方 code → 展示文案 ------------------------------
 * 官方接口给的是数字码（packageType / packageInterval），站点用服务端算好的
 * typeLabel 字段，小工具的静态快照里只有码，所以映射表放在这里两边共用。 */

export const TYPE_LABEL: Record<string, string> = {
  "1": "月卡",
  "2": "日卡",
  "3": "次卡",
  "4": "年卡",
  "5": "半年卡",
  "6": "季卡",
};

/** 与 PACKAGE_TYPES 同序：月/季/半年/年/日/次 */
export const TYPE_ORDER = ["1", "6", "5", "4", "2", "3"];

export const SLOT_LABEL: Record<string, string> = {
  "0": "全天",
  "1": "白天",
  "2": "夜间",
};

/** 与 TIME_SLOTS 同序 */
export const SLOT_ORDER = ["0", "1", "2"];

/**
 * 官方数据不带精确时长，按类型码推算标准天数。
 * 站点侧有真实 durationDays，用不到这张表；小工具的静态快照只有类型码。
 */
export const TYPE_DAYS: Record<string, number> = {
  "1": 30,
  "2": 1,
  "3": 1,
  "4": 365,
  "5": 180,
  "6": 90,
};

export function daysOfType(typeCode: string): number {
  return TYPE_DAYS[typeCode] || 30;
}

/* ------------------------------ 价格与文案口径 ------------------------------ */

/** 折合每月价格（分）。日卡/次卡按各自有效天数折算，用于跨卡种比价。 */
export function monthlyPrice(price: number, durationDays: number): number {
  const days = durationDays > 0 ? durationDays : 30;
  return Math.round((price * 30) / days);
}

/**
 * 规则摘要清洗。
 * 官方原始串会叠出「工作日 工作日 18:30-08:30 / 周末 周末 00:00-23:59」，
 * 把每段开头重复的词压成一个；再把「X 00:00-23:59」写成「X全天」。
 */
export function cleanRuleSummary(summary: string): string {
  return String(summary == null ? "" : summary)
    .split("/")
    .map(function (part: string) {
      const words = part.trim().split(/\s+/).filter(Boolean);
      if (words.length < 3) return words.join(" ");
      let i = 1;
      while (i < words.length && words[i] === words[0]) i += 1;
      return [words[0]].concat(words.slice(i)).join(" ");
    })
    .filter(Boolean)
    .map(function (part: string) {
      return part
        .replace(/^每天 00:00-23:59$/, "全天可停")
        .replace(/^(工作日|周末|节假日) 00:00-23:59$/, "$1全天");
    })
    .join(" / ");
}

/** 兼容旧调用名：站点组件一直用 tidyRuleSummary */
export const tidyRuleSummary = cleanRuleSummary;

/**
 * 公开领域模型 + 展示常量。
 * 这个文件会被客户端组件 import，所以只放纯类型/纯函数：
 * 不引 libsql 的 Row、不引 node:fs，也不放台账/对账等后台专用类型。
 */

/* 展示枚举的单一来源是 src/shared/domain.ts（小工具也用同一份，构建时转译进包）。
   这里 re-export 保持原有 import 路径不变。 */
export {
  INDUSTRIES,
  TIME_SLOTS,
  PERIODS,
  PACKAGE_TYPES,
  SORT_OPTIONS,
  PRICE_STEPS,
} from "@/shared/domain";
export type { SortValue } from "@/shared/domain";

/**
 * 重点城市：没选城市/没定位时优先展示。
 * 顺序按官方池的真实供给排（车场数），不是按行政级别——
 * 按级别排会把北京（167 个车场）顶到首位，首屏比深圳（1509 个）空一个数量级。
 */
export const FOCUS_CITIES = [
  "深圳市", "广州市", "上海市", "佛山市", "南京市", "东莞市",
  "中山市", "惠州市", "成都市", "重庆市", "杭州市", "天津市",
  "厦门市", "珠海市", "北京市", "福州市", "西安市", "长沙市",
  "南昌市", "江门市", "苏州市", "合肥市", "宁波市", "无锡市",
  "济南市", "海口市", "昆明市", "肇庆市", "太原市", "常州市",
] as const;

/** 首页快捷城市入口：知名度高、且供给撑得住首屏的城市 */
export const HOT_CITIES = [
  "深圳市", "广州市", "上海市", "北京市", "成都市",
  "重庆市", "杭州市", "南京市", "东莞市",
] as const;



export interface CarPark {
  id: string;
  name: string;
  city: string;
  district: string;
  area: string;
  address: string;
  keywords: string;
  industry: string;
  audience: string;
  note: string;
  /** 官方车场编码，导入数据用 */
  parkCode: string;
  province: string;
  lng: number;
  lat: number;
  /** manual = 手录，jtc = 官方选品池导入 */
  source: string;
  createdAt: number;
  updatedAt: number;
}

export interface Package {
  id: string;
  parkId: string;
  name: string;
  /** 时段：全天 / 白天 / 夜间 */
  period: string;
  durationDays: number;
  /** 售价，单位：分 */
  price: number;
  /** 佣金，单位：分 */
  commission: number;
  qrPath: string;
  qrUpdatedAt: number;
  /** active = 可售，soldout = 已售罄，hidden = 前台隐藏 */
  status: string;
  note: string;
  /** 套餐类型：月卡 / 季卡 / 年卡 … */
  typeLabel: string;
  /** 时长文案：1个月 / 3个月 … */
  durationLabel: string;
  /** 原价，单位：分 */
  originPrice: number;
  /** 使用规则摘要，如「工作日 18:30-08:00」 */
  ruleSummary: string;
  sourcePackageId: string;
  createdAt: number;
}

export interface ParkWithPackages extends CarPark {
  packages: Package[];
  /** 传了定位坐标时才有，单位米 */
  distance?: number | null;
}

/**
 * 官方分佣 shareCode 兜底值：前端拼套餐直达链接时用。
 * 优先取环境变量 JTC_SHARE_CODE，没配才用这枚（海报解码所得，2026-11-10）。
 */
export const DEFAULT_SHARE_CODE = "USC261110002056207ZEqLdE";

/** 分 → 元，用于展示 */
export function yuan(cent: number): string {
  return (cent / 100).toFixed(2).replace(/\.00$/, "");
}

/** 套餐文案与价格口径统一收口在 packageText.ts，这里 re-export 保持老调用不变 */
export {
  cleanPackageName,
  cleanRuleSummary,
  isLongTerm,
  LONG_TERM_DAYS,
  LONG_TERM_TYPES,
  monthlyPrice,
  shortPackageName,
  tidyRuleSummary,
} from "./packageText";

/** 两点球面距离，单位米 */
export function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** 距离展示：850m / 1.2km */
export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters <= 0) return "";
  if (meters < 1000) return `${Math.round(meters)}m`;
  return `${(meters / 1000).toFixed(meters < 10000 ? 1 : 0)}km`;
}

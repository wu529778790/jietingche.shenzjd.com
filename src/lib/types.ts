import type { Row } from "@libsql/client";

/** 这几个函数刻意不放在 db.ts，避免客户端组件引入 node:fs */
function str(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

function num(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

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

/** 套餐类型（官方 packageType：月/日/次/年/半年/季） */
export const PACKAGE_TYPES = ["月卡", "季卡", "半年卡", "年卡", "日卡", "次卡"] as const;

export const CHANNELS = ["微信群", "私聊", "朋友圈", "线下", "小红书", "闲鱼", "其他"] as const;

export const SORT_OPTIONS = [
  { value: "recommend", label: "推荐" },
  { value: "distance", label: "离我最近" },
  { value: "price", label: "价格最低" },
] as const;

export type SortValue = (typeof SORT_OPTIONS)[number]["value"];

/** 运营重点城市：购买力强、停车难，车场库默认优先展示 */
export const FOCUS_CITIES = [
  "北京市", "上海市", "广州市", "深圳市",
  "杭州市", "南京市", "成都市", "武汉市", "西安市", "重庆市", "天津市",
  "苏州市", "郑州市", "长沙市", "青岛市", "合肥市", "福州市", "厦门市",
  "济南市", "昆明市", "南昌市", "沈阳市", "大连市", "东莞市", "佛山市",
] as const;

/** 首页快捷城市入口 */
export const HOT_CITIES = [
  "北京市", "上海市", "广州市", "深圳市",
  "杭州市", "南京市", "成都市", "武汉市", "西安市",
] as const;

/** 价格档位（分），用于筛选栏 */
export const PRICE_STEPS = [
  { value: 0, label: "不限" },
  { value: 10000, label: "¥100 内" },
  { value: 20000, label: "¥200 内" },
  { value: 30000, label: "¥300 内" },
  { value: 50000, label: "¥500 内" },
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

export interface OutreachLog {
  id: string;
  parkId: string;
  packageId: string;
  channel: string;
  channelDetail: string;
  content: string;
  createdAt: number;
}

/** 台账列表带出的展示字段，避免前端为了拿名字再拉一次车场库 */
export interface OutreachLogRow extends OutreachLog {
  parkName: string;
  packageName: string;
}

export interface StatSnapshot {
  id: string;
  parkId: string;
  packageId: string;
  statDate: string;
  views: number;
  orders: number;
  /** 已结佣金，单位：分 */
  commission: number;
  createdAt: number;
}

export function toCarPark(row: Row): CarPark {
  return {
    id: str(row.id),
    name: str(row.name),
    city: str(row.city),
    district: str(row.district),
    area: str(row.area),
    address: str(row.address),
    keywords: str(row.keywords),
    industry: str(row.industry),
    audience: str(row.audience),
    note: str(row.note),
    parkCode: str(row.park_code),
    province: str(row.province),
    lng: num(row.lng),
    lat: num(row.lat),
    source: str(row.source) || "manual",
    createdAt: num(row.created_at),
    updatedAt: num(row.updated_at),
  };
}

export function toPackage(row: Row): Package {
  return {
    id: str(row.id),
    parkId: str(row.park_id),
    name: str(row.name),
    period: str(row.period),
    durationDays: num(row.duration_days),
    price: num(row.price),
    commission: num(row.commission),
    qrPath: str(row.qr_path),
    qrUpdatedAt: num(row.qr_updated_at),
    status: str(row.status) || "active",
    note: str(row.note),
    typeLabel: str(row.type_label),
    durationLabel: str(row.duration_label),
    originPrice: num(row.origin_price),
    ruleSummary: str(row.rule_summary),
    sourcePackageId: str(row.source_package_id),
    createdAt: num(row.created_at),
  };
}

export function toLog(row: Row): OutreachLogRow {
  return {
    id: str(row.id),
    parkId: str(row.park_id),
    packageId: str(row.package_id),
    channel: str(row.channel),
    channelDetail: str(row.channel_detail),
    content: str(row.content),
    createdAt: num(row.created_at),
    parkName: str(row.park_name),
    packageName: str(row.package_name),
  };
}

export function toSnapshot(row: Row): StatSnapshot {
  return {
    id: str(row.id),
    parkId: str(row.park_id),
    packageId: str(row.package_id),
    statDate: str(row.stat_date),
    views: num(row.views),
    orders: num(row.orders),
    commission: num(row.commission),
    createdAt: num(row.created_at),
  };
}

/** 分 → 元，用于展示 */
export function yuan(cent: number): string {
  return (cent / 100).toFixed(2).replace(/\.00$/, "");
}

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

/**
 * 服务端专用：把 libsql 的 Row 映射成业务对象。
 * 从 types.ts 拆出来，避免客户端组件 import 公开类型时把这个模块也拖进前端 bundle。
 */
import type { Row } from "@libsql/client";
import type { OutreachLogRow, StatSnapshot } from "./adminTypes";
import type { CarPark, Package } from "./types";

function str(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

function num(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
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

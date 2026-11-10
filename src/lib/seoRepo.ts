/**
 * SEO 落地页专用的服务端查询。
 *
 * 和 repo.ts 的区别：这里只读、不做分页交互，目标是一次查询拿到
 * 「一个车场 / 一个城市 / 一个区」的可索引内容，所以把聚合直接下推到 SQL，
 * 避免把几万行拉进 Node 再算。
 *
 * 口径与前台搜索保持一致：只算 active、排除官方「付定金专用」占位套餐、
 * 长租卡优先、跨卡种按折合月均比价。
 */
import type { Row } from "@libsql/client";
import { db, ensureSchema, num, str } from "./db";
import {
  LONG_TERM_DAYS,
  cleanPackageName,
  cleanRuleSummary,
  monthlyPrice,
} from "./packageText";
import type { CarPark, Package } from "./types";

const LONG_TERM_TYPE_SQL = "'月卡','季卡','半年卡','年卡'";
const PLACEHOLDER_WORDS = ["定金", "订金", "占位", "测试", "补差"];

const MONTHLY_EXPR = "ROUND(k.price * 30.0 / MAX(k.duration_days, 1))";
const NOT_PLACEHOLDER = PLACEHOLDER_WORDS.map((word) => `k.name NOT LIKE '%${word}%'`).join(
  " AND ",
);
/** 该车场最便宜的长租卡折合月均；没有长租卡时为 NULL */
const LONG_TERM_MONTHLY =
  `MIN(CASE WHEN k.type_label IN (${LONG_TERM_TYPE_SQL}) ` +
  `AND k.duration_days >= ${LONG_TERM_DAYS} THEN ${MONTHLY_EXPR} END)`;
/** 最低月价：优先长租卡，没有就用全量最低（日卡/次卡车场也有个参考价） */
const MIN_MONTHLY = `COALESCE(${LONG_TERM_MONTHLY}, MIN(${MONTHLY_EXPR}))`;

const ACTIVE_PACKAGE = `k.status = 'active' AND ${NOT_PLACEHOLDER}`;

export interface ParkSummary {
  id: string;
  parkCode: string;
  name: string;
  city: string;
  district: string;
  area: string;
  address: string;
  industry: string;
  audience: string;
  minMonthly: number;
  packageCount: number;
}

export interface DistrictStat {
  name: string;
  parkCount: number;
  minMonthly: number;
}

export interface CityStat {
  city: string;
  parkCount: number;
  minMonthly: number;
}

export interface CitySeo {
  city: string;
  parkCount: number;
  packageCount: number;
  minMonthly: number;
  districts: DistrictStat[];
}

function toParkSummary(row: Row): ParkSummary {
  return {
    id: str(row.id),
    parkCode: str(row.park_code),
    name: str(row.name),
    city: str(row.city),
    district: str(row.district),
    area: str(row.area),
    address: str(row.address),
    industry: str(row.industry),
    audience: str(row.audience),
    minMonthly: num(row.min_monthly),
    packageCount: num(row.package_count),
  };
}

/** 车场详情：按官方 park_code 查，兼容内部 id */
export async function getParkByCode(code: string): Promise<CarPark | null> {
  await ensureSchema();
  const res = await db.execute({
    sql: "SELECT * FROM car_parks WHERE park_code = ? OR id = ? LIMIT 1",
    args: [code, code],
  });
  const row = res.rows[0];
  if (!row) return null;
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

/** 车场的在售套餐，排序口径与前台一致：长租优先，再比折合月均 */
export async function listParkPackages(parkId: string): Promise<Package[]> {
  await ensureSchema();
  const res = await db.execute({
    sql: `SELECT * FROM packages k
          WHERE k.park_id = ? AND ${ACTIVE_PACKAGE}
          ORDER BY CASE WHEN k.type_label IN (${LONG_TERM_TYPE_SQL})
                        AND k.duration_days >= ${LONG_TERM_DAYS} THEN 0 ELSE 1 END ASC,
                   ${MONTHLY_EXPR} ASC, k.price ASC`,
    args: [parkId],
  });
  return res.rows.map((row) => ({
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
  }));
}

/** 一个城市有多少车场/套餐、最低月价多少、下辖哪些区 */
export async function getCitySeo(city: string): Promise<CitySeo> {
  await ensureSchema();
  const [districts, totals] = await Promise.all([
    db.execute({
      sql: `SELECT c.district AS district, COUNT(DISTINCT c.id) AS park_count, ${MIN_MONTHLY} AS min_monthly
            FROM car_parks c JOIN packages k ON k.park_id = c.id
            WHERE c.city = ? AND c.district <> '' AND ${ACTIVE_PACKAGE}
            GROUP BY c.district
            ORDER BY park_count DESC, district ASC`,
      args: [city],
    }),
    db.execute({
      sql: `SELECT COUNT(DISTINCT c.id) AS park_count, COUNT(k.id) AS package_count, ${MIN_MONTHLY} AS min_monthly
            FROM car_parks c JOIN packages k ON k.park_id = c.id
            WHERE c.city = ? AND ${ACTIVE_PACKAGE}`,
      args: [city],
    }),
  ]);
  const total = totals.rows[0];
  return {
    city,
    parkCount: num(total?.park_count),
    packageCount: num(total?.package_count),
    minMonthly: num(total?.min_monthly),
    districts: districts.rows.map((row) => ({
      name: str(row.district),
      parkCount: num(row.park_count),
      minMonthly: num(row.min_monthly),
    })),
  };
}

/** 区域的落地页只需要「有多少、最低多少」，区域内的车场单独分页查 */
export async function getDistrictSeo(
  city: string,
  district: string,
): Promise<CitySeo & { district: string }> {
  await ensureSchema();
  const [totals, siblings] = await Promise.all([
    db.execute({
      sql: `SELECT COUNT(DISTINCT c.id) AS park_count, COUNT(k.id) AS package_count, ${MIN_MONTHLY} AS min_monthly
            FROM car_parks c JOIN packages k ON k.park_id = c.id
            WHERE c.city = ? AND c.district = ? AND ${ACTIVE_PACKAGE}`,
      args: [city, district],
    }),
    db.execute({
      sql: `SELECT c.district AS district, COUNT(DISTINCT c.id) AS park_count, ${MIN_MONTHLY} AS min_monthly
            FROM car_parks c JOIN packages k ON k.park_id = c.id
            WHERE c.city = ? AND c.district <> '' AND c.district <> ? AND ${ACTIVE_PACKAGE}
            GROUP BY c.district
            ORDER BY park_count DESC, district ASC`,
      args: [city, district],
    }),
  ]);
  const total = totals.rows[0];
  return {
    city,
    district,
    parkCount: num(total?.park_count),
    packageCount: num(total?.package_count),
    minMonthly: num(total?.min_monthly),
    districts: siblings.rows.map((row) => ({
      name: str(row.district),
      parkCount: num(row.park_count),
      minMonthly: num(row.min_monthly),
    })),
  };
}

/** 城市/区域落地页的车场列表，按折合月价从低到高 */
export async function listParksByArea(
  city: string,
  district: string,
  limit = 60,
): Promise<ParkSummary[]> {
  await ensureSchema();
  const where = [`c.city = ?`, ACTIVE_PACKAGE];
  const args: (string | number)[] = [city];
  if (district) {
    where.push("c.district = ?");
    args.push(district);
  }
  const res = await db.execute({
    sql: `SELECT c.id, c.park_code, c.name, c.city, c.district, c.area, c.address, c.industry, c.audience,
                 COUNT(k.id) AS package_count, ${MIN_MONTHLY} AS min_monthly
          FROM car_parks c JOIN packages k ON k.park_id = c.id
          WHERE ${where.join(" AND ")}
          GROUP BY c.id
          ORDER BY COALESCE(${LONG_TERM_MONTHLY}, 2147483647) ASC, min_monthly ASC, c.name ASC
          LIMIT ?`,
    args: [...args, limit],
  });
  return res.rows.map(toParkSummary);
}

/** 车场页的内链：同区优先，不够再补同城 */
export async function listNearbyParks(
  city: string,
  district: string,
  excludeId: string,
  limit = 8,
): Promise<ParkSummary[]> {
  await ensureSchema();
  const res = await db.execute({
    sql: `SELECT c.id, c.park_code, c.name, c.city, c.district, c.area, c.address, c.industry, c.audience,
                 COUNT(k.id) AS package_count, ${MIN_MONTHLY} AS min_monthly
          FROM car_parks c JOIN packages k ON k.park_id = c.id
          WHERE c.city = ? AND c.id <> ? AND ${ACTIVE_PACKAGE}
          GROUP BY c.id
          ORDER BY CASE WHEN c.district = ? THEN 0 ELSE 1 END ASC,
                   COALESCE(${LONG_TERM_MONTHLY}, 2147483647) ASC, c.name ASC
          LIMIT ?`,
    args: [city, excludeId, district, limit],
  });
  return res.rows.map(toParkSummary);
}

/** 城市聚合（首页入口、sitemap 用），按车场数从多到少 */
export async function listCityStats(limit = 200): Promise<CityStat[]> {
  await ensureSchema();
  const res = await db.execute({
    sql: `SELECT c.city AS city, COUNT(DISTINCT c.id) AS park_count, ${MIN_MONTHLY} AS min_monthly
          FROM car_parks c JOIN packages k ON k.park_id = c.id
          WHERE c.city <> '' AND ${ACTIVE_PACKAGE}
          GROUP BY c.city
          ORDER BY park_count DESC, city ASC
          LIMIT ?`,
    args: [limit],
  });
  return res.rows.map((row) => ({
    city: str(row.city),
    parkCount: num(row.park_count),
    minMonthly: num(row.min_monthly),
  }));
}

/** 全国月卡最低的车场（首页内链用） */
export async function listCheapestParks(limit = 12): Promise<ParkSummary[]> {
  await ensureSchema();
  const res = await db.execute({
    sql: `SELECT c.id, c.park_code, c.name, c.city, c.district, c.area, c.address, c.industry, c.audience,
                 COUNT(k.id) AS package_count, ${MIN_MONTHLY} AS min_monthly
          FROM car_parks c JOIN packages k ON k.park_id = c.id
          WHERE ${ACTIVE_PACKAGE}
          GROUP BY c.id
          ORDER BY COALESCE(${LONG_TERM_MONTHLY}, 2147483647) ASC, c.name ASC
          LIMIT ?`,
    args: [limit],
  });
  return res.rows.map(toParkSummary);
}

/** 车场数最多的城市 + 区（首页内链、区域页内链用） */
export async function listTopDistricts(
  limit = 12,
): Promise<{ city: string; district: string; parkCount: number }[]> {
  await ensureSchema();
  const res = await db.execute({
    sql: `SELECT c.city AS city, c.district AS district, COUNT(DISTINCT c.id) AS park_count
          FROM car_parks c
          WHERE c.city <> '' AND c.district <> ''
            AND EXISTS (SELECT 1 FROM packages k WHERE k.park_id = c.id AND ${ACTIVE_PACKAGE})
          GROUP BY c.city, c.district
          ORDER BY park_count DESC, c.city ASC
          LIMIT ?`,
    args: [limit],
  });
  return res.rows.map((row) => ({
    city: str(row.city),
    district: str(row.district),
    parkCount: num(row.park_count),
  }));
}

/** 所有可索引的城市 + 区（sitemap、内链用） */
export async function listAreaRoutes(): Promise<{ city: string; district: string }[]> {
  await ensureSchema();
  const res = await db.execute({
    sql: `SELECT city, district FROM car_parks
          WHERE city <> '' AND district <> ''
          GROUP BY city, district
          ORDER BY city ASC, district ASC`,
  });
  return res.rows.map((row) => ({ city: str(row.city), district: str(row.district) }));
}

/** 可索引的车场路由（只收有在售套餐的车场，避免空页面进 sitemap） */
export async function listParkRoutes(): Promise<
  { code: string; updatedAt: number; city: string; district: string }[]
> {
  await ensureSchema();
  const res = await db.execute({
    sql: `SELECT c.park_code AS code, c.updated_at AS updated_at, c.city AS city, c.district AS district
          FROM car_parks c
          WHERE c.park_code <> ''
            AND EXISTS (SELECT 1 FROM packages k WHERE k.park_id = c.id AND ${ACTIVE_PACKAGE})
          ORDER BY c.updated_at DESC`,
  });
  return res.rows.map((row) => ({
    code: str(row.code),
    updatedAt: num(row.updated_at),
    city: str(row.city),
    district: str(row.district),
  }));
}

/** 页面展示用：把清洗规则再跑一遍，兜住还没刷库的旧数据 */
export function displayPackageName(parkName: string, raw: string): string {
  return cleanPackageName(raw, parkName);
}

export function displayRule(raw: string): string {
  return cleanRuleSummary(raw);
}

export function packageMonthly(pkg: Package): number {
  return monthlyPrice(pkg.price, pkg.durationDays);
}

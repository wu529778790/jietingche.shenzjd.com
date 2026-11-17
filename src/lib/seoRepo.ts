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
import { distanceMeters, type CarPark, type Package } from "./types";
import { normalizeDistrict } from "./district";

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

/**
 * 区县命中的两种写法：规范名，以及库里可能残留的「市名 + 区县名」旧写法。
 * 后者正在逐步清掉（scripts/import-jtc.mjs 入库时归一），保留这段是为了
 * 代码先上线、数据后刷新时不会有一批区县页突然 404。
 */
const DISTRICT_MATCH = `(c.district = ? OR c.district = c.city || ?)`;

/**
 * 城市页/兄弟区县列表的去重合并。
 *
 * SQL 的 GROUP BY 会把「上海市嘉定区」和「嘉定区」算成两行，直接渲染就是
 * 同一个区两个链接（其中一个必然是重复内容）。这里按归一后的名字合并：
 * 车场数相加（一个车场只有一个区县，不会重复计），最低价取更小的那个。
 */
function mergeDistricts(
  rows: Row[],
  city: string,
): { name: string; parkCount: number; minMonthly: number }[] {
  const merged = new Map<string, { parkCount: number; minMonthly: number }>();
  for (const row of rows) {
    const name = normalizeDistrict(city, str(row.district));
    if (!name) continue;
    const parkCount = num(row.park_count);
    const minMonthly = num(row.min_monthly);
    const prev = merged.get(name);
    merged.set(name, {
      parkCount: (prev?.parkCount ?? 0) + parkCount,
      minMonthly:
        prev && prev.minMonthly && minMonthly
          ? Math.min(prev.minMonthly, minMonthly)
          : prev?.minMonthly || minMonthly,
    });
  }
  return [...merged]
    .map(([name, value]) => ({ name, ...value }))
    .sort((a, b) => b.parkCount - a.parkCount || a.name.localeCompare(b.name, "zh"));
}

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
  /** 只有「按距离排」的场景才有，单位米 */
  distance?: number;
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
    districts: mergeDistricts(districts.rows, city),
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
            WHERE c.city = ? AND ${DISTRICT_MATCH} AND ${ACTIVE_PACKAGE}`,
      args: [city, district, district],
    }),
    db.execute({
      sql: `SELECT c.district AS district, COUNT(DISTINCT c.id) AS park_count, ${MIN_MONTHLY} AS min_monthly
            FROM car_parks c JOIN packages k ON k.park_id = c.id
            WHERE c.city = ? AND c.district <> '' AND NOT ${DISTRICT_MATCH} AND ${ACTIVE_PACKAGE}
            GROUP BY c.district
            ORDER BY park_count DESC, district ASC`,
      args: [city, district, district],
    }),
  ]);
  const total = totals.rows[0];
  return {
    city,
    district,
    parkCount: num(total?.park_count),
    packageCount: num(total?.package_count),
    minMonthly: num(total?.min_monthly),
    districts: mergeDistricts(siblings.rows, city),
  };
}

/** 城市/区域落地页的车场列表，按折合月价从低到高；offset 供分页用 */
export async function listParksByArea(
  city: string,
  district: string,
  limit = 60,
  offset = 0,
): Promise<ParkSummary[]> {
  await ensureSchema();
  const where = [`c.city = ?`, ACTIVE_PACKAGE];
  const args: (string | number)[] = [city];
  if (district) {
    where.push(DISTRICT_MATCH);
    args.push(district, district);
  }
  const res = await db.execute({
    sql: `SELECT c.id, c.park_code, c.name, c.city, c.district, c.area, c.address, c.industry, c.audience,
                 COUNT(k.id) AS package_count, ${MIN_MONTHLY} AS min_monthly
          FROM car_parks c JOIN packages k ON k.park_id = c.id
          WHERE ${where.join(" AND ")}
          GROUP BY c.id
          ORDER BY COALESCE(${LONG_TERM_MONTHLY}, 2147483647) ASC, min_monthly ASC, c.name ASC
          LIMIT ? OFFSET ?`,
    args: [...args, limit, offset],
  });
  return res.rows.map(toParkSummary);
}

/**
 * 一个区的月卡价格基准，车场页拿它算「这个车场比同区贵还是便宜」。
 *
 * 用中位数不用均价：库里存在 7200 元/月的极端值（指定车位/特殊合同），
 * 均价会被拉飞，中位数才代表「这个区的典型价格」。
 * 样本少于 5 个车场时返回 null——几个车场算出来的基准没有说服力，
 * 这种区宁可不显示对比句，也别给出误导性的百分比。
 */
export async function getDistrictMonthlyBenchmark(
  city: string,
  district: string,
): Promise<{ sampleCount: number; medianMonthly: number } | null> {
  if (!city || !district) return null;
  await ensureSchema();
  const res = await db.execute({
    sql: `SELECT ${MIN_MONTHLY} AS m
          FROM car_parks c JOIN packages k ON k.park_id = c.id
          WHERE c.city = ? AND ${DISTRICT_MATCH} AND ${ACTIVE_PACKAGE}
          GROUP BY c.id`,
    args: [city, district, district],
  });
  const values = res.rows
    .map((row) => num(row.m))
    .filter((value) => value > 0)
    .sort((a, b) => a - b);
  if (values.length < 5) return null;
  return {
    sampleCount: values.length,
    medianMonthly: values[Math.floor(values.length / 2)],
  };
}

export interface NearbyParksInput {
  city: string;
  district: string;
  excludeId: string;
  limit?: number;
  /**
   * 当前车场坐标。有它就按直线距离排，没有才退回「同区优先」的文本逻辑。
   *
   * 为什么必须按距离：区的边界和人的距离感无关。车场刚好在区界上时，
   * 「同区优先」会把 5 公里外的同区车场排在 200 米外的邻区车场前面——
   * 而用户看到的应该是「走得到的那几个」。
   */
  lat?: number;
  lng?: number;
  /** 第一档半径（km）；这一档一条都没有才放开放到 10km */
  radiusKm?: number;
}

/** 车场页的内链：默认按直线距离排，没有坐标时退回「同区优先、再比价」 */
export async function listNearbyParks(input: NearbyParksInput): Promise<ParkSummary[]> {
  const { city, district, excludeId } = input;
  const limit = Math.min(20, Math.max(1, Math.floor(input.limit ?? 8)));
  const lat = input.lat ?? 0;
  const lng = input.lng ?? 0;
  const hasGeo = Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0);

  await ensureSchema();

  if (hasGeo) {
    const cosLat = Math.cos((lat * Math.PI) / 180) ** 2 || 1;
    /** 距离平方（度²）：只用来比大小，不用开方 */
    const dist2 = "(((c.lat - ?) * (c.lat - ?)) + ((c.lng - ?) * (c.lng - ?)) * ?)";
    const geoArgs = [lat, lat, lng, lng, cosLat];
    const radii = [Math.max(0.5, input.radiusKm ?? 3), 10];

    for (const km of radii) {
      const deg2 = (km / 111.32) ** 2;
      const res = await db.execute({
        sql: `SELECT c.id, c.park_code, c.name, c.city, c.district, c.area, c.address, c.industry, c.audience,
                     c.lat, c.lng,
                     COUNT(k.id) AS package_count, ${MIN_MONTHLY} AS min_monthly,
                     ${dist2} AS dist2
              FROM car_parks c JOIN packages k ON k.park_id = c.id
              WHERE c.id <> ? AND ${ACTIVE_PACKAGE}
                    AND c.lat IS NOT NULL AND c.lng IS NOT NULL
                    AND ${dist2} <= ?
              GROUP BY c.id
              ORDER BY ${dist2} ASC, COALESCE(${LONG_TERM_MONTHLY}, 2147483647) ASC, c.name ASC
              LIMIT ?`,
        args: [...geoArgs, excludeId, ...geoArgs, deg2, ...geoArgs, limit],
      });
      if (!res.rows.length) continue;
      return res.rows.map((row) => {
        const summary = toParkSummary(row);
        const rowLat = num(row.lat);
        const rowLng = num(row.lng);
        // 行里没带坐标时用它自带的 dist2 反推：1 度纬度 ≈ 111.32km，横向已按 cos 缩放
        const meters =
          rowLat && rowLng
            ? distanceMeters(lat, lng, rowLat, rowLng)
            : Math.sqrt(Math.max(0, num(row.dist2))) * 111_320;
        return { ...summary, distance: meters };
      });
    }
    return [];
  }

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

/**
 * 车场数最多的城市 + 区（首页内链、区域页内链用）。
 *
 * 必须写成 JOIN 而不是 `EXISTS (SELECT 1 FROM packages WHERE park_id = c.id AND ...)`：
 * 相关子查询里带了 `status = 'active'`，SQLite 会优先选 idx_packages_status，
 * 于是每个车场都把 1.8 万个套餐扫一遍（8442 × 18632），实测 5831ms，
 * 首页整体被拖到 5.9 秒、EdgeOne 回源超时只拿到半截 HTML。
 * 换成 JOIN 后走 idx_packages_park 索引，同一份数据 20ms 以内。
 */
export async function listTopDistricts(
  limit = 12,
): Promise<{ city: string; district: string; parkCount: number }[]> {
  await ensureSchema();
  const res = await db.execute({
    sql: `SELECT c.city AS city, c.district AS district, COUNT(DISTINCT c.id) AS park_count
          FROM car_parks c JOIN packages k ON k.park_id = c.id
          WHERE c.city <> '' AND c.district <> '' AND ${ACTIVE_PACKAGE}
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
  // 归一后去重：「上海市嘉定区」和「嘉定区」只留一条，否则 sitemap 里同一区两个 URL
  const seen = new Set<string>();
  const routes: { city: string; district: string }[] = [];
  for (const row of res.rows) {
    const city = str(row.city);
    const district = normalizeDistrict(city, str(row.district));
    if (!city || !district) continue;
    const key = `${city}|${district}`;
    if (seen.has(key)) continue;
    seen.add(key);
    routes.push({ city, district });
  }
  return routes;
}

/** 可索引的车场路由（只收有在售套餐的车场，避免空页面进 sitemap） */
export async function listParkRoutes(): Promise<
  { code: string; updatedAt: number; city: string; district: string }[]
> {
  await ensureSchema();
  const res = await db.execute({
    sql: `SELECT c.park_code AS code, c.updated_at AS updated_at, c.city AS city, c.district AS district
          FROM car_parks c JOIN packages k ON k.park_id = c.id
          WHERE c.park_code <> '' AND ${ACTIVE_PACKAGE}
          GROUP BY c.id
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

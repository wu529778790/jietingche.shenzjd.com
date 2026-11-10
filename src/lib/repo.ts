import type { Row } from "@libsql/client";
import type { OutreachLogRow, StatSnapshot } from "./adminTypes";
import { db, ensureSchema, newId, now, num, str } from "./db";
import { toCarPark, toLog, toPackage, toSnapshot } from "./rows";
import { CONFIG_KEYS } from "./schema";
import {
  DEFAULT_SHARE_CODE,
  FOCUS_CITIES,
  LONG_TERM_DAYS,
  distanceMeters,
  type CarPark,
  type Package,
  type ParkWithPackages,
} from "./types";

/* ------------------------------ 公共工具 ------------------------------ */

function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(",");
}

function like(value: string): string {
  return `%${value.replace(/[%_]/g, "")}%`;
}

interface PackageFilter {
  activeOnly?: boolean;
  type?: string;
  slot?: string;
  maxPrice?: number;
}

/** 折合每月价格（分）：月卡/季卡/年卡/日卡混在一起时，只有月均可比 */
function monthlySql(prefix: string): string {
  return `ROUND(${prefix}price * 30.0 / MAX(${prefix}duration_days, 1))`;
}

/**
 * 长租卡（月/季/半年/年卡，且周期够一个月）排在日卡/次卡前面。
 * 次卡也会带 duration_days=30（30 天有效期、限 5 次），只看天数会把它当月卡。
 */
const LONG_TERM_TYPE_SQL = "'月卡','季卡','半年卡','年卡'";

function longTermSql(prefix: string): string {
  return (
    `CASE WHEN ${prefix}type_label IN (${LONG_TERM_TYPE_SQL}) ` +
    `AND ${prefix}duration_days >= ${LONG_TERM_DAYS} THEN 0 ELSE 1 END`
  );
}

/**
 * 官方池里的「付定金专用」是经销商下单用的虚拟商品（10 元、规则只到 00:00-01:00），
 * 不是可售月卡，按最低价排序会直接顶到首屏，前台统一排掉。
 */
const PLACEHOLDER_WORDS = ["定金", "订金", "占位", "测试", "补差"];

function notPlaceholderSql(prefix: string): string {
  return PLACEHOLDER_WORDS.map((word) => `${prefix}name NOT LIKE '%${word}%'`).join(" AND ");
}

/** 把套餐条件拼成 SQL 片段，条件里的列名统一带 pk 前缀时用 alias */
function packageConds(filter: PackageFilter, alias = ""): { sql: string[]; args: (string | number)[] } {
  const p = alias ? `${alias}.` : "";
  const sql: string[] = [];
  const args: (string | number)[] = [];
  if (filter.activeOnly !== false) {
    sql.push(`${p}status = 'active'`);
    sql.push(notPlaceholderSql(p));
  }
  if (filter.type) {
    sql.push(`${p}type_label = ?`);
    args.push(filter.type);
  }
  if (filter.slot) {
    sql.push(`${p}period = ?`);
    args.push(filter.slot);
  }
  if (filter.maxPrice && filter.maxPrice > 0) {
    // maxPrice 是「月均预算」：填 ¥300 内时，年卡 3000（月均 250）也应该命中
    sql.push(`${p}price > 0 AND ${monthlySql(p)} <= ?`);
    args.push(filter.maxPrice);
  }
  return { sql, args };
}

/** 批量取这些车场的套餐（默认只取可售的） */
async function packagesByPark(
  ids: string[],
  filter: PackageFilter = {},
): Promise<Map<string, Package[]>> {
  const grouped = new Map<string, Package[]>();
  if (!ids.length) return grouped;
  const conds = [`park_id IN (${placeholders(ids.length)})`];
  const { sql, args } = packageConds(filter);
  const res = await db.execute({
    // 长租卡在前，同卡种按折合月均排：一个车场的日卡不会挤掉它的月卡
    sql: `SELECT * FROM packages WHERE ${[...conds, ...sql].join(" AND ")}
          ORDER BY ${longTermSql("")} ASC, ${monthlySql("")} ASC, price ASC`,
    args: [...ids, ...args],
  });
  for (const row of res.rows) {
    const pkg = toPackage(row);
    const list = grouped.get(pkg.parkId) ?? [];
    list.push(pkg);
    grouped.set(pkg.parkId, list);
  }
  return grouped;
}

/* ------------------------------ 车场 ------------------------------ */

export interface ParkQuery {
  q?: string;
  page?: number;
  pageSize?: number;
  /** 只看「生成不出直达码」的车场：缺 park_code，或套餐缺 source_package_id */
  noCode?: boolean;
}

export async function listParks(
  query: ParkQuery = {},
): Promise<{ parks: ParkWithPackages[]; total: number; page: number; pageSize: number }> {
  await ensureSchema();
  const page = Math.max(1, Math.floor(query.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Math.floor(query.pageSize ?? 20)));
  const conds: string[] = [];
  const args: (string | number)[] = [];
  const kw = (query.q ?? "").trim();
  if (kw) {
    conds.push(
      "(name LIKE ? OR address LIKE ? OR keywords LIKE ? OR district LIKE ? OR area LIKE ? OR industry LIKE ?)",
    );
    for (let i = 0; i < 6; i += 1) args.push(like(kw));
  }
  if (query.noCode) {
    conds.push(
      "(park_code = '' OR EXISTS (SELECT 1 FROM packages pk WHERE pk.park_id = car_parks.id AND pk.source_package_id = ''))",
    );
  }
  const where = conds.length ? ` WHERE ${conds.join(" AND ")}` : "";
  // 车场库默认把北上广深/省会排前面（低购买力城市不用占首屏）
  const focusSql = `CASE WHEN city IN (${placeholders(FOCUS_CITIES.length)}) THEN 0 ELSE 1 END`;
  const [totalRes, parkRes] = await Promise.all([
    db.execute({ sql: `SELECT COUNT(*) AS n FROM car_parks${where}`, args }),
    db.execute({
      sql: `SELECT * FROM car_parks${where} ORDER BY ${focusSql} ASC, updated_at DESC LIMIT ? OFFSET ?`,
      args: [...args, ...FOCUS_CITIES, pageSize, (page - 1) * pageSize],
    }),
  ]);
  const parks: ParkWithPackages[] = parkRes.rows.map((row) => ({
    ...toCarPark(row),
    packages: [],
  }));
  const grouped = await packagesByPark(parks.map((park) => park.id));
  for (const park of parks) park.packages = grouped.get(park.id) ?? [];
  return { parks, total: num(totalRes.rows[0]?.n), page, pageSize };
}

export async function getPark(id: string): Promise<ParkWithPackages | null> {
  await ensureSchema();
  const parkRes = await db.execute({ sql: "SELECT * FROM car_parks WHERE id = ?", args: [id] });
  const row = parkRes.rows[0];
  if (!row) return null;
  const park: ParkWithPackages = { ...toCarPark(row), packages: [] };
  const grouped = await packagesByPark([park.id]);
  park.packages = grouped.get(park.id) ?? [];
  return park;
}

export interface ParkInput {
  name: string;
  city?: string;
  district?: string;
  area?: string;
  address?: string;
  keywords?: string;
  industry?: string;
  audience?: string;
  note?: string;
}

export async function createPark(input: ParkInput): Promise<string> {
  await ensureSchema();
  const id = newId();
  const ts = now();
  await db.execute({
    sql: `INSERT INTO car_parks
      (id, name, city, district, area, address, keywords, industry, audience, note, source, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?, ?)`,
    args: [
      id,
      input.name.trim(),
      str(input.city),
      str(input.district),
      str(input.area),
      str(input.address),
      str(input.keywords),
      str(input.industry),
      str(input.audience),
      str(input.note),
      ts,
      ts,
    ],
  });
  return id;
}

export async function updatePark(id: string, input: ParkInput): Promise<void> {
  await ensureSchema();
  await db.execute({
    sql: `UPDATE car_parks SET
      name = ?, city = ?, district = ?, area = ?, address = ?, keywords = ?,
      industry = ?, audience = ?, note = ?, updated_at = ?
      WHERE id = ?`,
    args: [
      input.name.trim(),
      str(input.city),
      str(input.district),
      str(input.area),
      str(input.address),
      str(input.keywords),
      str(input.industry),
      str(input.audience),
      str(input.note),
      now(),
      id,
    ],
  });
}

export async function deletePark(id: string): Promise<void> {
  await ensureSchema();
  await db.execute({ sql: "DELETE FROM packages WHERE park_id = ?", args: [id] });
  await db.execute({ sql: "DELETE FROM car_parks WHERE id = ?", args: [id] });
}

/* ------------------------------ 套餐 ------------------------------ */

export interface PackageInput {
  parkId: string;
  name: string;
  period?: string;
  durationDays?: number;
  price?: number;
  commission?: number;
  note?: string;
  status?: string;
}

export async function createPackage(input: PackageInput): Promise<string> {
  await ensureSchema();
  const id = newId();
  const period = str(input.period) || "全天";
  await db.execute({
    sql: `INSERT INTO packages
      (id, park_id, name, period, duration_days, price, commission, qr_path, qr_updated_at, status, note,
       type_label, duration_label, origin_price, rule_summary, source_package_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, '', 0, ?, ?, '', '', 0, '', '', ?)`,
    args: [
      id,
      input.parkId,
      input.name.trim(),
      period,
      input.durationDays ?? 30,
      input.price ?? 0,
      input.commission ?? 0,
      str(input.status) || "active",
      str(input.note),
      now(),
    ],
  });
  return id;
}

export async function updatePackage(
  id: string,
  patch: Partial<PackageInput> & { qrPath?: string },
): Promise<void> {
  await ensureSchema();
  const fields: string[] = [];
  const args: (string | number)[] = [];
  const push = (sqlName: string, value: string | number | undefined) => {
    if (value === undefined) return;
    fields.push(`${sqlName} = ?`);
    args.push(value);
  };
  push("name", patch.name?.trim());
  push("period", patch.period);
  push("duration_days", patch.durationDays);
  push("price", patch.price);
  push("commission", patch.commission);
  push("note", patch.note);
  push("status", patch.status);
  if (patch.qrPath !== undefined) {
    fields.push("qr_path = ?", "qr_updated_at = ?");
    args.push(patch.qrPath, now());
  }
  if (!fields.length) return;
  args.push(id);
  await db.execute({
    sql: `UPDATE packages SET ${fields.join(", ")} WHERE id = ?`,
    args,
  });
}

export async function deletePackage(id: string): Promise<void> {
  await ensureSchema();
  await db.execute({ sql: "DELETE FROM packages WHERE id = ?", args: [id] });
}

export interface PackageOption {
  id: string;
  name: string;
  parkId: string;
  parkName: string;
  price: number;
  period: string;
  typeLabel: string;
}

/** 对账录入时按关键词找套餐，避免把 6000 多个车场全塞进下拉框 */
export async function searchPackages(keyword: string, limit = 40): Promise<PackageOption[]> {
  await ensureSchema();
  const kw = keyword.trim();
  const conds: string[] = [];
  const args: (string | number)[] = [];
  if (kw) {
    conds.push("(k.name LIKE ? OR c.name LIKE ? OR c.address LIKE ?)");
    args.push(like(kw), like(kw), like(kw));
  }
  const where = conds.length ? ` WHERE ${conds.join(" AND ")}` : "";
  const res = await db.execute({
    sql: `SELECT k.id AS id, k.name AS name, k.park_id AS park_id, k.price AS price,
                 k.period AS period, k.type_label AS type_label, c.name AS park_name
          FROM packages k JOIN car_parks c ON c.id = k.park_id${where}
          ORDER BY k.created_at DESC LIMIT ?`,
    args: [...args, Math.min(100, Math.max(1, limit))],
  });
  return res.rows.map((row) => ({
    id: str(row.id),
    name: str(row.name),
    parkId: str(row.park_id),
    parkName: str(row.park_name),
    price: num(row.price),
    period: str(row.period),
    typeLabel: str(row.type_label),
  }));
}

/* ------------------------------ 公开搜索 ------------------------------ */

export interface SearchInput {
  q?: string;
  city?: string;
  district?: string;
  industry?: string;
  type?: string;
  slot?: string;
  maxPrice?: number;
  sort?: string;
  lat?: number;
  lng?: number;
  page?: number;
  pageSize?: number;
}

export interface SearchResult {
  parks: ParkWithPackages[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * 定位后自动认城市：取最近的 20 个车场，谁的城市场次最多就认谁。
 * 数据库里没有城市边界数据，用「最近车场的城市」比纯最近一个更抗边界误差（比如站在深莞交界）。
 */
export async function nearestCity(lat: number, lng: number): Promise<string> {
  await ensureSchema();
  const cosLat = Math.cos((lat * Math.PI) / 180) ** 2 || 1;
  const res = await db.execute({
    sql: `SELECT city FROM (
            SELECT c.city AS city,
                   ((c.lat - ?) * (c.lat - ?)) + ((c.lng - ?) * (c.lng - ?)) * ? AS d
            FROM car_parks c
            WHERE c.lat IS NOT NULL AND c.lng IS NOT NULL AND c.city <> ''
            ORDER BY d ASC
            LIMIT 20
          )
          GROUP BY city
          ORDER BY COUNT(*) DESC, MIN(d) ASC
          LIMIT 1`,
    args: [lat, lat, lng, lng, cosLat],
  });
  return str(res.rows[0]?.city);
}

/**
 * 面向访客的搜索：按官方那套筛（城市/区/业态/套餐类型/时段/价格）+ 定位距离排序。
 * 先按条件筛出车场 id 分页，再补车场和套餐，避免把几万行拉进内存。
 */
export async function searchPublic(input: SearchInput): Promise<SearchResult> {
  await ensureSchema();
  const page = Math.max(1, Math.floor(input.page ?? 1));
  const pageSize = Math.min(50, Math.max(1, Math.floor(input.pageSize ?? 20)));

  const parkConds: string[] = [];
  const parkArgs: (string | number)[] = [];

  const kw = (input.q ?? "").trim();
  if (kw) {
    parkConds.push(
      "(c.name LIKE ? OR c.address LIKE ? OR c.keywords LIKE ? OR c.district LIKE ? OR c.area LIKE ? OR c.industry LIKE ?)",
    );
    for (let i = 0; i < 6; i += 1) parkArgs.push(like(kw));
  }
  if (input.city) {
    parkConds.push("c.city = ?");
    parkArgs.push(input.city);
  }
  if (input.district) {
    parkConds.push("c.district = ?");
    parkArgs.push(input.district);
  }
  if (input.industry) {
    parkConds.push("c.industry = ?");
    parkArgs.push(input.industry);
  }
  // 套餐条件与后台/详情页共用一套口径（含排除官方「付定金专用」这类占位套餐）
  const pkgFilter = packageConds(
    {
      activeOnly: true,
      type: input.type,
      slot: input.slot,
      maxPrice: input.maxPrice,
    },
    "k",
  );
  const pkgConds = pkgFilter.sql;
  const pkgArgs = pkgFilter.args;

  const lat = typeof input.lat === "number" ? input.lat : 0;
  const lng = typeof input.lng === "number" ? input.lng : 0;
  const hasGeo = Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0);

  const orderArgs: (string | number)[] = [];
  // 没选城市、也不是按距离排时，推荐位优先给北上广深/省会
  // （前端为了展示「离我多远」会一直带经纬度，所以这里不能再看 hasGeo）
  const focusOrder =
    !input.city && !(input.sort === "distance" && hasGeo)
      ? `CASE WHEN c.city IN (${placeholders(FOCUS_CITIES.length)}) THEN 0 ELSE 1 END ASC`
      : "";
  /** 距离平方（度²）：纬度 1 度 ≈ 111.32km，只用来比较大小，不用开方 */
  const dist2Sql = "MIN(((c.lat - ?) * (c.lat - ?)) + ((c.lng - ?) * (c.lng - ?)) * ?)";
  const cosLat = Math.cos((lat * Math.PI) / 180) ** 2 || 1;
  /** 公里 → 度²，给圈层阈值用 */
  const deg2 = (km: number) => ((km / 111.32) ** 2).toFixed(10);

  /**
   * 比价口径：先「有长租卡的车场」，再按长租卡的折合月均，最后才看全量月均。
   * 直接按 MIN(price) 排会把 ¥8 的「夜间套餐 1 夜」日卡顶到月卡前面，
   * 而访客要买的是月卡；季卡/年卡也只有折合月均后才和月卡可比。
   * 只有日卡/次卡的车场（MIN 为 NULL）用一个大数兜底，排在长租卡车场之后。
   */
  const cheapLongTerm =
    `MIN(CASE WHEN k.type_label IN (${LONG_TERM_TYPE_SQL}) ` +
    `AND k.duration_days >= ${LONG_TERM_DAYS} THEN ${monthlySql("k.")} END)`;
  const priceOrder =
    `COALESCE(${cheapLongTerm}, 2147483647) ASC, ` +
    `MIN(${monthlySql("k.")}) ASC, MIN(k.price) ASC`;

  let orderSql = priceOrder;
  if (input.sort === "distance" && hasGeo) {
    orderSql = `${dist2Sql} ASC, ${priceOrder}`;
    orderArgs.push(lat, lat, lng, lng, cosLat);
  } else if (input.sort === "price") {
    orderSql = priceOrder;
  } else if (input.sort === "commission") {
    orderSql = `MAX(k.commission) DESC`;
  } else if (hasGeo) {
    // 推荐 = 官方 sortMode=1 的本地版：先给走得到的（1/3/10km），同圈层内比价。
    // 不按佣金排——佣金是商家侧指标，按它排会把远且贵的顶到首屏。
    const tier =
      `CASE WHEN ${dist2Sql} <= ${deg2(1)} THEN 0 ` +
      `WHEN ${dist2Sql} <= ${deg2(3)} THEN 1 ` +
      `WHEN ${dist2Sql} <= ${deg2(10)} THEN 2 ELSE 3 END`;
    orderSql = `${tier} ASC, ${priceOrder}`;
    for (let i = 0; i < 3; i += 1) orderArgs.push(lat, lat, lng, lng, cosLat);
  }

  const finalOrder = [focusOrder, orderSql].filter(Boolean).join(", ");
  const finalOrderArgs = focusOrder ? [...FOCUS_CITIES, ...orderArgs] : orderArgs;
  const whereSql = [...parkConds, ...pkgConds].join(" AND ");
  const [idRes, totalRes] = await Promise.all([
    db.execute({
      sql: `SELECT c.id AS id FROM car_parks c JOIN packages k ON k.park_id = c.id
            WHERE ${whereSql} GROUP BY c.id ORDER BY ${finalOrder} LIMIT ? OFFSET ?`,
      args: [...parkArgs, ...pkgArgs, ...finalOrderArgs, pageSize, (page - 1) * pageSize],
    }),
    db.execute({
      sql: `SELECT COUNT(DISTINCT c.id) AS n FROM car_parks c JOIN packages k ON k.park_id = c.id
            WHERE ${whereSql}`,
      args: [...parkArgs, ...pkgArgs],
    }),
  ]);

  const ids = idRes.rows.map((row) => str(row.id));
  const total = num(totalRes.rows[0]?.n);
  if (!ids.length) return { parks: [], total, page, pageSize };

  const parkRes = await db.execute({
    sql: `SELECT * FROM car_parks WHERE id IN (${placeholders(ids.length)})`,
    args: ids,
  });
  const byId = new Map(parkRes.rows.map((row) => [str(row.id), toCarPark(row)]));
  const parks: ParkWithPackages[] = ids
    .map((id) => byId.get(id))
    .filter((park): park is CarPark => Boolean(park))
    .map((park) => ({ ...park, packages: [] }));

  const grouped = await packagesByPark(
    parks.map((park) => park.id),
    {
      activeOnly: true,
      type: input.type,
      slot: input.slot,
      maxPrice: input.maxPrice,
    },
  );
  for (const park of parks) {
    park.packages = grouped.get(park.id) ?? [];
    if (hasGeo) {
      park.distance =
        park.lat && park.lng ? distanceMeters(lat, lng, park.lat, park.lng) : null;
    }
  }

  return { parks, total, page, pageSize };
}

export interface FacetItem {
  name: string;
  count: number;
}

export interface Facets {
  cities: FacetItem[];
  districts: FacetItem[];
  industries: FacetItem[];
  types: FacetItem[];
  slots: FacetItem[];
}

/** 筛选栏要用的分面：热门城市、该城市的区、业态、套餐类型、时段 */
export async function facets(city?: string): Promise<Facets> {
  await ensureSchema();
  const [cities, districts, industries, types, slots] = await Promise.all([
    db.execute(
      `SELECT city AS name, COUNT(*) AS n FROM car_parks WHERE city <> ''
       GROUP BY city ORDER BY n DESC LIMIT 40`,
    ),
    city
      ? db.execute({
          sql: `SELECT district AS name, COUNT(*) AS n FROM car_parks
                WHERE city = ? AND district <> '' GROUP BY district ORDER BY n DESC LIMIT 60`,
          args: [city],
        })
      : Promise.resolve({ rows: [] as never[] }),
    db.execute(
      `SELECT industry AS name, COUNT(*) AS n FROM car_parks WHERE industry <> ''
       GROUP BY industry ORDER BY n DESC`,
    ),
    db.execute(
      `SELECT type_label AS name, COUNT(*) AS n FROM packages WHERE type_label <> ''
       GROUP BY type_label ORDER BY n DESC`,
    ),
    db.execute(
      `SELECT period AS name, COUNT(*) AS n FROM packages WHERE period <> ''
       GROUP BY period ORDER BY n DESC`,
    ),
  ]);
  const toFacets = (rows: Row[]): FacetItem[] =>
    rows.map((row) => ({ name: str(row.name), count: num(row.n) })).filter((item) => item.name);
  return {
    cities: toFacets(cities.rows),
    districts: toFacets(districts.rows),
    industries: toFacets(industries.rows),
    types: toFacets(types.rows),
    slots: toFacets(slots.rows),
  };
}

/* ------------------------------ 站点配置 ------------------------------ */

async function readConfig(key: string): Promise<string> {
  const res = await db.execute({ sql: "SELECT cfg_value FROM app_config WHERE cfg_key = ?", args: [key] });
  return str(res.rows[0]?.cfg_value);
}

export async function getConfig(key: string): Promise<string> {
  await ensureSchema();
  return readConfig(key);
}

export async function setConfig(key: string, value: string): Promise<void> {
  await ensureSchema();
  await db.execute({
    sql: `INSERT INTO app_config (cfg_key, cfg_value, updated_at) VALUES (?, ?, ?)
          ON CONFLICT(cfg_key) DO UPDATE SET cfg_value = excluded.cfg_value, updated_at = excluded.updated_at`,
    args: [key, value, now()],
  });
}

export interface PublicConfig {
  /** 前端拼套餐直达链接、现场出码用的分佣码 */
  shareCode: string;
}

/** 分佣码优先级：后台配置 > 环境变量 > 内置兜底值 */
export async function getPublicConfig(): Promise<PublicConfig> {
  await ensureSchema();
  const fromDb = await readConfig(CONFIG_KEYS.shareCode);
  return { shareCode: fromDb || (process.env.JTC_SHARE_CODE || "").trim() || DEFAULT_SHARE_CODE };
}

/* ------------------------------ 台账 ------------------------------ */

export async function listLogs(limit = 200): Promise<OutreachLogRow[]> {
  await ensureSchema();
  const res = await db.execute({
    sql: `SELECT l.*, c.name AS park_name, k.name AS package_name
          FROM outreach_logs l
          LEFT JOIN car_parks c ON c.id = l.park_id
          LEFT JOIN packages k ON k.id = l.package_id
          ORDER BY l.created_at DESC LIMIT ?`,
    args: [limit],
  });
  return res.rows.map(toLog);
}

export async function createLog(input: {
  parkId?: string;
  packageId?: string;
  channel?: string;
  channelDetail?: string;
  content?: string;
}): Promise<string> {
  await ensureSchema();
  const id = newId();
  await db.execute({
    sql: `INSERT INTO outreach_logs (id, park_id, package_id, channel, channel_detail, content, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      str(input.parkId),
      str(input.packageId),
      str(input.channel),
      str(input.channelDetail),
      str(input.content),
      now(),
    ],
  });
  return id;
}

export async function deleteLog(id: string): Promise<void> {
  await ensureSchema();
  await db.execute({ sql: "DELETE FROM outreach_logs WHERE id = ?", args: [id] });
}

/* ------------------------------ 对账 ------------------------------ */

export async function listSnapshots(): Promise<StatSnapshot[]> {
  await ensureSchema();
  const res = await db.execute("SELECT * FROM stat_snapshots ORDER BY stat_date DESC");
  return res.rows.map(toSnapshot);
}

export async function upsertSnapshot(input: {
  parkId?: string;
  packageId?: string;
  statDate: string;
  views?: number;
  orders?: number;
  commission?: number;
}): Promise<void> {
  await ensureSchema();
  const existing = await db.execute({
    sql: "SELECT id FROM stat_snapshots WHERE package_id = ? AND stat_date = ?",
    args: [str(input.packageId), input.statDate],
  });
  const row = existing.rows[0];
  if (row) {
    await db.execute({
      sql: "UPDATE stat_snapshots SET views = ?, orders = ?, commission = ? WHERE id = ?",
      args: [input.views ?? 0, input.orders ?? 0, input.commission ?? 0, str(row.id)],
    });
    return;
  }
  await db.execute({
    sql: `INSERT INTO stat_snapshots (id, park_id, package_id, stat_date, views, orders, commission, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      newId(),
      str(input.parkId),
      str(input.packageId),
      input.statDate,
      input.views ?? 0,
      input.orders ?? 0,
      input.commission ?? 0,
      now(),
    ],
  });
}

export interface ParkStatRow {
  park: CarPark;
  views: number;
  orders: number;
  commission: number;
  conversion: number;
}

/** 对账汇总：只聚合有数据的车场，避免把整个车场库拉出来 */
export async function parkStats(): Promise<ParkStatRow[]> {
  await ensureSchema();
  const res = await db.execute(`
    SELECT COALESCE(NULLIF(s.park_id, ''), k.park_id, '') AS pid,
           SUM(s.views) AS views, SUM(s.orders) AS orders, SUM(s.commission) AS commission
    FROM stat_snapshots s
    LEFT JOIN packages k ON k.id = s.package_id
    GROUP BY pid`);
  const rows = res.rows.filter((row) => str(row.pid));
  if (!rows.length) return [];
  const ids = rows.map((row) => str(row.pid));
  const parkRes = await db.execute({
    sql: `SELECT * FROM car_parks WHERE id IN (${placeholders(ids.length)})`,
    args: ids,
  });
  const parkMap = new Map(parkRes.rows.map((row) => [str(row.id), toCarPark(row)]));
  return rows
    .map((row) => {
      const park = parkMap.get(str(row.pid));
      if (!park) return null;
      const views = num(row.views);
      const orders = num(row.orders);
      return {
        park,
        views,
        orders,
        commission: num(row.commission),
        conversion: views > 0 ? orders / views : 0,
      };
    })
    .filter((row): row is ParkStatRow => Boolean(row))
    .sort((a, b) => b.orders - a.orders || b.views - a.views);
}

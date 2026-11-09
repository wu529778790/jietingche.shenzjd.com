import type { Row } from "@libsql/client";
import { db, ensureSchema, newId, now, num, str } from "./db";
import { CONFIG_KEYS } from "./schema";
import {
  FOCUS_CITIES,
  distanceMeters,
  toCarPark,
  toLog,
  toPackage,
  toSnapshot,
  type CarPark,
  type OutreachLogRow,
  type Package,
  type ParkWithPackages,
  type StatSnapshot,
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
  withQr?: boolean;
}

/** 把套餐条件拼成 SQL 片段，条件里的列名统一带 pk 前缀时用 alias */
function packageConds(filter: PackageFilter, alias = ""): { sql: string[]; args: (string | number)[] } {
  const p = alias ? `${alias}.` : "";
  const sql: string[] = [];
  const args: (string | number)[] = [];
  if (filter.activeOnly !== false) sql.push(`${p}status = 'active'`);
  if (filter.type) {
    sql.push(`${p}type_label = ?`);
    args.push(filter.type);
  }
  if (filter.slot) {
    sql.push(`${p}period = ?`);
    args.push(filter.slot);
  }
  if (filter.maxPrice && filter.maxPrice > 0) {
    sql.push(`${p}price > 0 AND ${p}price <= ?`);
    args.push(filter.maxPrice);
  }
  if (filter.withQr) sql.push(`${p}qr_path <> ''`);
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
    sql: `SELECT * FROM packages WHERE ${[...conds, ...sql].join(" AND ")} ORDER BY price ASC`,
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
  withQr?: boolean;
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
  if (query.withQr) {
    conds.push("EXISTS (SELECT 1 FROM packages pk WHERE pk.park_id = car_parks.id AND pk.qr_path <> '')");
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
 * 面向访客的搜索：按官方那套筛（城市/区/业态/套餐类型/时段/价格）+ 定位距离排序。
 * 先按条件筛出车场 id 分页，再补车场和套餐，避免把几万行拉进内存。
 */
export async function searchPublic(input: SearchInput): Promise<SearchResult> {
  await ensureSchema();
  const page = Math.max(1, Math.floor(input.page ?? 1));
  const pageSize = Math.min(50, Math.max(1, Math.floor(input.pageSize ?? 20)));

  const parkConds: string[] = [];
  const parkArgs: (string | number)[] = [];
  const pkgConds = ["k.status = 'active'"];
  const pkgArgs: (string | number)[] = [];

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
  if (input.type) {
    pkgConds.push("k.type_label = ?");
    pkgArgs.push(input.type);
  }
  if (input.slot) {
    pkgConds.push("k.period = ?");
    pkgArgs.push(input.slot);
  }
  if (input.maxPrice && input.maxPrice > 0) {
    pkgConds.push("k.price > 0 AND k.price <= ?");
    pkgArgs.push(input.maxPrice);
  }

  const lat = typeof input.lat === "number" ? input.lat : 0;
  const lng = typeof input.lng === "number" ? input.lng : 0;
  const hasGeo = Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0);

  const orderArgs: (string | number)[] = [];
  // 没选城市、没定位时，推荐位优先给北上广深/省会
  const focusOrder =
    !input.city && !hasGeo
      ? `CASE WHEN c.city IN (${placeholders(FOCUS_CITIES.length)}) THEN 0 ELSE 1 END ASC`
      : "";
  let orderSql = "MAX(k.commission) DESC, MIN(k.price) ASC";
  if (input.sort === "distance" && hasGeo) {
    orderSql = "MIN(((c.lat - ?) * (c.lat - ?)) + ((c.lng - ?) * (c.lng - ?)) * ?) ASC, MIN(k.price) ASC";
    const cosLat = Math.cos((lat * Math.PI) / 180) ** 2;
    orderArgs.push(lat, lat, lng, lng, cosLat || 1);
  } else if (input.sort === "price") {
    orderSql = "MIN(k.price) ASC";
  } else if (input.sort === "commission") {
    orderSql = "MAX(k.commission) DESC";
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
  promoQrPath: string;
}

export async function getPublicConfig(): Promise<PublicConfig> {
  await ensureSchema();
  return { promoQrPath: await readConfig(CONFIG_KEYS.promoQrPath) };
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

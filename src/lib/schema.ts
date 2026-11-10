/**
 * 数据表结构
 * 设计原则：所有业务围绕「车场 → 套餐 → 专属码」这张主表展开，
 * 台账和对账都是挂在套餐上的流水，方便后续按车场聚合出 ROI。
 *
 * 车场/套餐里的 park_code、source_package_id、lng/lat 等字段是为
 * 「导入官方选品池数据」准备的：外部数据用稳定 id 幂等落库，重复导入不会产生重复行。
 *
 * 拆分说明：老库补列（COLUMN_MIGRATIONS）必须在建索引之前跑，
 * 否则「索引用到的列还不存在」会直接报 no such column。
 */

export const TABLE_SQL = `
CREATE TABLE IF NOT EXISTS car_parks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  city TEXT NOT NULL DEFAULT '',
  district TEXT DEFAULT '',
  area TEXT DEFAULT '',
  address TEXT DEFAULT '',
  keywords TEXT DEFAULT '',
  industry TEXT DEFAULT '',
  audience TEXT DEFAULT '',
  note TEXT DEFAULT '',
  park_code TEXT DEFAULT '',
  province TEXT DEFAULT '',
  lng REAL DEFAULT 0,
  lat REAL DEFAULT 0,
  source TEXT DEFAULT 'manual',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS packages (
  id TEXT PRIMARY KEY,
  park_id TEXT NOT NULL,
  name TEXT NOT NULL,
  period TEXT DEFAULT '',
  duration_days INTEGER DEFAULT 30,
  price INTEGER DEFAULT 0,
  commission INTEGER DEFAULT 0,
  qr_path TEXT DEFAULT '',
  qr_updated_at INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active',
  note TEXT DEFAULT '',
  type_label TEXT DEFAULT '',
  duration_label TEXT DEFAULT '',
  origin_price INTEGER DEFAULT 0,
  rule_summary TEXT DEFAULT '',
  source_package_id TEXT DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS outreach_logs (
  id TEXT PRIMARY KEY,
  park_id TEXT DEFAULT '',
  package_id TEXT DEFAULT '',
  channel TEXT DEFAULT '',
  channel_detail TEXT DEFAULT '',
  content TEXT DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS stat_snapshots (
  id TEXT PRIMARY KEY,
  park_id TEXT DEFAULT '',
  package_id TEXT DEFAULT '',
  stat_date TEXT NOT NULL,
  views INTEGER DEFAULT 0,
  orders INTEGER DEFAULT 0,
  commission INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS app_config (
  cfg_key TEXT PRIMARY KEY,
  cfg_value TEXT DEFAULT '',
  updated_at INTEGER NOT NULL
);
`;

export const INDEX_SQL = `
CREATE INDEX IF NOT EXISTS idx_packages_park ON packages(park_id);
CREATE INDEX IF NOT EXISTS idx_packages_status ON packages(status);
CREATE INDEX IF NOT EXISTS idx_packages_price ON packages(price);
CREATE INDEX IF NOT EXISTS idx_packages_type ON packages(type_label);
CREATE INDEX IF NOT EXISTS idx_packages_period ON packages(period);
CREATE INDEX IF NOT EXISTS idx_parks_city ON car_parks(city);
CREATE INDEX IF NOT EXISTS idx_parks_code ON car_parks(park_code);
CREATE INDEX IF NOT EXISTS idx_logs_created ON outreach_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_stats_package ON stat_snapshots(package_id);
`;

export const SCHEMA_SQL = `${TABLE_SQL}${INDEX_SQL}`;

/**
 * 老库补列：CREATE TABLE IF NOT EXISTS 不会给已存在的表加字段，
 * 这里给出「表 → 若干 (列名, 列定义)」，ensureSchema 时用 PRAGMA 检查后 ALTER。
 */
export const COLUMN_MIGRATIONS: Record<string, [string, string][]> = {
  car_parks: [
    ["park_code", "TEXT DEFAULT ''"],
    ["province", "TEXT DEFAULT ''"],
    ["lng", "REAL DEFAULT 0"],
    ["lat", "REAL DEFAULT 0"],
    ["source", "TEXT DEFAULT 'manual'"],
  ],
  packages: [
    ["type_label", "TEXT DEFAULT ''"],
    ["duration_label", "TEXT DEFAULT ''"],
    ["origin_price", "INTEGER DEFAULT 0"],
    ["rule_summary", "TEXT DEFAULT ''"],
    ["source_package_id", "TEXT DEFAULT ''"],
  ],
};

/** 站点配置的键名（码图不落库，全部前端现场生成） */
export const CONFIG_KEYS = {
  /** 分佣 shareCode：前端拼套餐直达链接用，后台可改 */
  shareCode: "share_code",
} as const;

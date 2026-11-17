#!/usr/bin/env node
/**
 * 官方选品池数据 → 业务库导入
 *
 * 源：data/jtc.db（scripts/crawl-jtc.mjs + enrich-jtc.mjs 抓的捷停车分销套餐）
 * 目标：TURSO_DATABASE_URL（配了）或 data/app.db
 *
 * 特点：
 *   - 以 park_code / package_id 派生稳定主键，重复导入只更新不重复
 *   - 重导入不会覆盖已上传的专属码（qr_path），也不会把手工隐藏的套餐放出来
 *   - 佣金统一换算成「分」，价格沿用官方分单位
 *
 * 用法：
 *   node --no-warnings scripts/import-jtc.mjs             全量导入
 *   node --no-warnings scripts/import-jtc.mjs --city 深圳市   只导一个城市
 *   node --no-warnings scripts/import-jtc.mjs --limit 500   先拿一小批试跑
 */

import { DatabaseSync } from "node:sqlite";
import { createClient } from "@libsql/client";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { COLUMN_MIGRATIONS, INDEX_SQL, TABLE_SQL } from "../src/lib/schema.ts";
import { cleanPackageName, cleanRuleSummary } from "../src/lib/packageText.ts";
import { normalizeDistrict } from "../src/lib/district.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SRC = resolve(ROOT, "data/jtc.db");

const args = process.argv.slice(2);
const argValue = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const onlyCity = argValue("--city");
const limit = Number(argValue("--limit") ?? 0) || 0;

if (!existsSync(SRC)) {
  console.error(`找不到源库：${SRC}`);
  process.exit(1);
}

/* ------------------------------ 字段清洗 ------------------------------ */

const INDUSTRY_RULES = [
  ["交通枢纽", /机场|火车站|高铁|客运站|长途汽车|地铁站|公交枢纽|交通中心/],
  ["医院", /医院|门诊|卫生服务|妇幼|口腔|中医|体检中心/],
  ["景区", /景区|古镇|乐园|湿地|动物园|植物园|海洋馆|度假区|旅游|公园|体育|展览馆|博物馆/],
  ["商场", /广场|购物中心|百货|商城|商业|万象|天街|万达|太古|印象城|大悦城|COCO|MALL|mall|凯德|茂业|益田|市场|酒店|商厦|家居|建材|服装|古玩|批发|超市/],
  ["写字楼", /大厦|写字楼|科技园|软件园|产业园|工业园|创业|基地|总部|中心|商务楼|办公|设计|研发|珠宝园|创意园|空间|厂/],
  ["社区", /小区|花园|家园|公寓|苑|府|村|公馆|住宅|宿舍|华庭|雅居|湾|庭/],
];

function guessIndustry(text) {
  for (const [label, re] of INDUSTRY_RULES) {
    if (re.test(text)) return label;
  }
  return "其他";
}

/** 官方推荐标签 → 适合人群 */
const AUDIENCE_MAP = {
  居住推荐: "周边住户",
  上班推荐: "上班族",
  畅停无忧: "长停首选",
  高性价比: "性价比之选",
  不常开: "偶尔用车",
  不限时: "不限时段",
};

function extractTags(name) {
  return [...String(name ?? "").matchAll(/<([^>]+)>/g)].map((m) => m[1].trim()).filter(Boolean);
}

const STATUS_MAP = { ENABLE: "active", SOLDOUT: "soldout" };

function toTimestamp(value) {
  const t = Date.parse(value ?? "");
  return Number.isFinite(t) ? t : Date.now();
}

function cleanName(name) {
  return (name ?? "").replace(/\s+/g, "").trim();
}

/* ------------------------------ 连库 ------------------------------ */

const remoteUrl = process.env.TURSO_DATABASE_URL;
const client = remoteUrl
  ? createClient({ url: remoteUrl, authToken: process.env.TURSO_AUTH_TOKEN })
  : createClient({ url: `file:${resolve(ROOT, "data/app.db")}` });

console.log(remoteUrl ? `目标：Turso ${remoteUrl}` : "目标：data/app.db");

await client.execute("PRAGMA foreign_keys = OFF");
for (const statement of TABLE_SQL.split(";").map((s) => s.trim()).filter(Boolean)) {
  await client.execute(statement);
}
for (const [table, columns] of Object.entries(COLUMN_MIGRATIONS)) {
  const info = await client.execute(`PRAGMA table_info(${table})`);
  const existing = new Set(info.rows.map((row) => String(row.name)));
  for (const [column, definition] of columns) {
    if (existing.has(column)) continue;
    await client.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
for (const statement of INDEX_SQL.split(";").map((s) => s.trim()).filter(Boolean)) {
  await client.execute(statement);
}

/* ------------------------------ 读源数据 ------------------------------ */

const src = new DatabaseSync(SRC, { readOnly: true });
const where = onlyCity ? "WHERE city = ?" : "";
const rows = onlyCity
  ? src.prepare(`SELECT * FROM packages ${where}`).all(onlyCity)
  : src.prepare("SELECT * FROM packages").all();
const cityNames = new Map(
  src.prepare("SELECT city_code, city_name FROM cities").all().map((row) => [
    String(row.city_code),
    String(row.city_name || ""),
  ]),
);
src.close();

/** 官方城市列表里直辖市写成「上海城区」「市辖区」，归一化成前台用的市名 */
const CITY_ALIAS = {
  上海城区: "上海市",
  北京城区: "北京市",
  天津城区: "天津市",
  市辖区: "重庆市",
};
function fallbackCity(code) {
  const name = cleanName(cityNames.get(code));
  return CITY_ALIAS[name] || (name.endsWith("城区") ? name.replace(/城区$/, "市") : name);
}

console.log(`源数据：${rows.length} 条套餐`);

/* ------------------------------ 归并车场 ------------------------------ */

const parks = new Map();
for (const row of rows) {
  const code = cleanName(row.park_code);
  if (!code) continue;
  const name = cleanName(row.park_name) || "未命名车场";
  let park = parks.get(code);
  if (!park) {
    // 区县入库时就归一：「上海市嘉定区」和「嘉定区」是同一个区，两套写法各自成页
    // 就是两个 URL 两份内容（实测 57 组），归一后 sitemap/内链/路由只认一个
    const city = cleanName(row.city) || fallbackCity(cleanName(row.city_code));
    park = {
      code,
      name,
      city,
      district: normalizeDistrict(city, cleanName(row.district)),
      province: cleanName(row.province),
      address: (row.address ?? "").trim(),
      lng: Number(row.lng) || 0,
      lat: Number(row.lat) || 0,
      names: new Set(),
      slots: new Set(),
      tags: new Set(),
      packages: [],
      createdAt: toTimestamp(row.fetched_at),
      updatedAt: toTimestamp(row.fetched_at),
    };
    parks.set(code, park);
  }
  park.names.add(name);
  if (row.time_slot) park.slots.add(row.time_slot);
  for (const tag of extractTags(row.package_name)) park.tags.add(tag);
  park.createdAt = Math.min(park.createdAt, toTimestamp(row.fetched_at));
  park.updatedAt = Math.max(park.updatedAt, toTimestamp(row.fetched_at));
  park.packages.push(row);
}

console.log(`归并后车场：${parks.size} 个`);

/* ------------------------------ 生成写入语句 ------------------------------ */

const parkStmt = `INSERT INTO car_parks
  (id, name, city, district, area, address, keywords, industry, audience, note,
   park_code, province, lng, lat, source, created_at, updated_at)
  VALUES (?, ?, ?, ?, '', ?, ?, ?, ?, '', ?, ?, ?, ?, 'jtc', ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    name = excluded.name, city = excluded.city, district = excluded.district,
    address = excluded.address, keywords = excluded.keywords, industry = excluded.industry,
    audience = excluded.audience, province = excluded.province,
    lng = excluded.lng, lat = excluded.lat, park_code = excluded.park_code,
    updated_at = excluded.updated_at`;

const pkgStmt = `INSERT INTO packages
  (id, park_id, name, period, duration_days, price, commission, qr_path, qr_updated_at, status, note,
   type_label, duration_label, origin_price, rule_summary, source_package_id, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, '', 0, ?, '', ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    name = excluded.name, period = excluded.period, duration_days = excluded.duration_days,
    price = excluded.price, commission = excluded.commission,
    type_label = excluded.type_label, duration_label = excluded.duration_label,
    origin_price = excluded.origin_price, rule_summary = excluded.rule_summary,
    source_package_id = excluded.source_package_id,
    status = CASE WHEN packages.status = 'hidden' THEN packages.status ELSE excluded.status END`;

const statements = [];
const parkCount = { value: 0 };
const pkgCount = { value: 0 };

for (const park of parks.values()) {
  const parkId = `jtc_${park.code}`;
  const name = park.name;
  const tags = [...park.tags];
  const keywordParts = [
    ...new Set([
      ...park.names,
      name.replace(/停车场|车库|车场|地下|地面/g, ""),
      park.district,
      park.address.replace(/\(.*?\)|（.*?）/g, ""),
    ]),
  ].filter(Boolean);
  const industryText = `${name} ${park.address} ${[...park.names].join(" ")}`;
  const audience =
    [...new Set(tags.map((tag) => AUDIENCE_MAP[tag]).filter(Boolean))].slice(0, 2).join(" / ") ||
    (park.slots.has("夜间") ? "上班族 / 周边住户" : "通勤上班族");

  statements.push({
    sql: parkStmt,
    args: [
      parkId,
      name,
      park.city,
      park.district,
      park.address,
      keywordParts.join(" "),
      guessIndustry(industryText),
      audience,
      park.code,
      park.province,
      park.lng,
      park.lat,
      park.createdAt,
      park.updatedAt,
    ],
  });
  parkCount.value += 1;

  if (limit && pkgCount.value >= limit) continue;

  for (const row of park.packages) {
    if (limit && pkgCount.value >= limit) break;
    const packageId = String(row.package_id ?? "").trim();
    if (!packageId) continue;
    const price = Math.max(0, Math.round(Number(row.current_price) || 0));
    const originPrice = Math.max(0, Math.round(Number(row.origin_price) || 0));
    const commissionYuan = Number(row.max_commission) || 0;
    const commission = Math.max(0, Math.round(commissionYuan * 100));
    const durationDays = Math.max(1, Math.round(Number(row.duration_days) || 30));
    const typeLabel = cleanName(row.package_type_label) || "月卡";
    const period = cleanName(row.time_slot) || "全天";

    statements.push({
      sql: pkgStmt,
      args: [
        `jtc_${packageId}`,
        parkId,
        cleanPackageName(row.package_name, name) || typeLabel,
        period,
        durationDays,
        price,
        commission,
        STATUS_MAP[row.status] ?? "active",
        typeLabel,
        cleanName(row.duration_label),
        originPrice,
        cleanRuleSummary(row.rule_summary),
        packageId,
        toTimestamp(row.fetched_at),
      ],
    });
    pkgCount.value += 1;
  }
  if (limit && pkgCount.value >= limit) break;
}

/* ------------------------------ 分批写入 ------------------------------ */

const CHUNK = 300;
let done = 0;
for (let i = 0; i < statements.length; i += CHUNK) {
  const chunk = statements.slice(i, i + CHUNK);
  await client.batch(chunk, "write");
  done += chunk.length;
  if (done % 3000 === 0 || done === statements.length) {
    console.log(`写入 ${done}/${statements.length}`);
  }
}

const summary = await client.execute(`
  SELECT
    (SELECT COUNT(*) FROM car_parks WHERE source = 'jtc') AS parks,
    (SELECT COUNT(*) FROM packages WHERE park_id LIKE 'jtc_%') AS packages,
    (SELECT COUNT(*) FROM packages WHERE park_id LIKE 'jtc_%' AND status = 'active') AS sellable,
    (SELECT COUNT(*) FROM car_parks WHERE source = 'jtc' AND lng = 0) AS no_geo
`);

console.log("完成：", {
  车场: Number(summary.rows[0]?.parks ?? 0),
  套餐: Number(summary.rows[0]?.packages ?? 0),
  可售: Number(summary.rows[0]?.sellable ?? 0),
  无坐标: Number(summary.rows[0]?.no_geo ?? 0),
});

if (limit) console.log(`（本次带 --limit，实际写入 车场 ${parkCount.value} / 套餐 ${pkgCount.value}）`);

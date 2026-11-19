#!/usr/bin/env node
/**
 * 导出小工具用的数据快照：data/jtc.db（原始选品池）→ 一份瘦身 JSON。
 *
 * 为什么要有这一步：
 *   - 原始池 59MB 且只在自己电脑上，CI / 另一台机器拿不到，小工具就打不了包；
 *   - 打包只需要「在售套餐 + 城市中心点」，raw 里其它字段纯属浪费，
 *     这里把 raw 提前压成 packageInterval 一个数，快照能小一大截。
 *
 * 用法：
 *   node scripts/export-snapshot.mjs                       # → data/jtc-snapshot.json
 *   node scripts/export-snapshot.mjs --out snapshots/a.json
 *
 * 产物可以直接交给：node scripts/build-h5.mjs --target xhs|toy --snapshot data/jtc-snapshot.json
 */
import { DatabaseSync } from "node:sqlite";
import { normalizeDistrict } from "../src/lib/district.ts";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const argValue = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const SRC = resolve(ROOT, argValue("--db") ?? "data/jtc.db");
const OUT = resolve(ROOT, argValue("--out") ?? "data/jtc-snapshot.json");

if (!existsSync(SRC)) {
  console.error(`找不到原始池：${SRC}`);
  console.error("先跑 node --no-warnings scripts/crawl-jtc.mjs");
  process.exit(1);
}

function safeJson(text) {
  try {
    return JSON.parse(text) ?? {};
  } catch {
    return {};
  }
}

const db = new DatabaseSync(SRC, { readOnly: true });

const rows = db
  .prepare(
    `SELECT park_code, park_name, package_name, package_id, package_type,
            address, district, city, lng, lat, current_price, origin_price,
            package_rules, raw
     FROM packages
     WHERE status = 'ENABLE'`,
  )
  .all()
  .map((r) => {
    const city = String(r.city ?? "");
    return {
      park_code: r.park_code,
      park_name: r.park_name,
      package_name: r.package_name,
      package_id: r.package_id,
      package_type: r.package_type,
      address: r.address,
      // 原始池里同一区县有「上海市嘉定区」/「嘉定区」两套写法，包里跟着线上站一起归一，
      // 否则小工具的城市/区县筛选会出现两个同名项，各只能搜到一半车场
      district: normalizeDistrict(city, String(r.district ?? "")),
      city,
      lng: r.lng,
      lat: r.lat,
      current_price: r.current_price,
      origin_price: r.origin_price,
      package_rules: r.package_rules,
      // raw 里只有这一个字段进包，单独提出来，其余全丢
      interval: Number(safeJson(r.raw).packageInterval ?? 0) || 0,
    };
  });

const cities = db
  .prepare("SELECT city_name, longitude, latitude FROM cities WHERE longitude AND latitude")
  .all()
  .map((c) => ({ city_name: c.city_name, longitude: c.longitude, latitude: c.latitude }));

db.close();

const json = JSON.stringify({
  version: 1,
  generatedAt: new Date().toISOString(),
  source: "data/jtc.db",
  cities,
  rows,
});

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, json);

const sizeMB = (Buffer.byteLength(json) / 1024 / 1024).toFixed(1);
console.log(`快照：${rows.length} 条在售套餐 / ${cities.length} 个城市中心 → ${OUT}（${sizeMB}MB）`);

#!/usr/bin/env node
/**
 * 捷停车 · 分销选品池爬虫
 *
 * 数据源（均无需登录）：
 *   1. cw.jparking.cn/cw-gateway/park-search/rentout/query_hot_city   全国城市 + 中心坐标
 *   2. sytgate.jslife.com.cn/base-gateway/distribute-business/query_package_list  按城市拉套餐
 *
 * 输出：data/jtc.db（sqlite）
 *
 * 用法：
 *   node scripts/crawl-jtc.mjs               全量爬
 *   node scripts/crawl-jtc.mjs --city 440300 只爬单个城市
 *   node scripts/crawl-jtc.mjs --reset       清空重爬
 */

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { splitCanton } from './lib/canton.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DB_PATH = resolve(ROOT, 'data/jtc.db');

const CITY_API = 'https://cw.jparking.cn/cw-gateway/park-search/rentout/query_hot_city';
const LIST_API = 'https://sytgate.jslife.com.cn/base-gateway/distribute-business/query_package_list';
const HEADERS = {
  'Content-Type': 'application/json;charset=UTF-8',
  applicationVersion: '1.1.0',
  'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) MicroMessenger/8.0.49',
};
const PAGE_SIZE = 200;
const DELAY_MS = 250;

const args = process.argv.slice(2);
const onlyCity = args.includes('--city') ? args[args.indexOf('--city') + 1] : null;
const doReset = args.includes('--reset');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function post(url, body, retry = 2) {
  for (let i = 0; i <= retry; i++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (i === retry) throw err;
      await sleep(800 * (i + 1));
    }
  }
}

function initDb() {
  mkdirSync(dirname(DB_PATH), { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS cities (
      city_code   TEXT PRIMARY KEY,
      city_name   TEXT NOT NULL,
      province    TEXT,
      longitude   REAL,
      latitude    REAL,
      package_count INTEGER,
      crawled_at  TEXT
    );

    CREATE TABLE IF NOT EXISTS packages (
      package_id     TEXT PRIMARY KEY,
      goods_id       TEXT,
      park_code      TEXT,
      park_name      TEXT,
      package_name   TEXT,
      simple_name    TEXT,
      biz_type       TEXT,
      package_type   TEXT,
      address        TEXT,
      canton         TEXT,
      province       TEXT,
      city           TEXT,
      district       TEXT,
      lng            REAL,
      lat            REAL,
      distance       REAL,
      current_price  INTEGER,
      origin_price   INTEGER,
      distribute_price INTEGER,
      max_commission REAL,
      commission     REAL,
      commission_amt REAL,
      favour_amt     REAL,
      status         TEXT,
      package_rules  TEXT,
      city_code      TEXT,
      source_sort    TEXT,
      raw            TEXT,
      fetched_at     TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_pkg_city     ON packages(city_code);
    CREATE INDEX IF NOT EXISTS idx_pkg_province ON packages(province);
    CREATE INDEX IF NOT EXISTS idx_pkg_canton   ON packages(canton);
    CREATE INDEX IF NOT EXISTS idx_pkg_park     ON packages(park_code);
    CREATE INDEX IF NOT EXISTS idx_pkg_commission ON packages(max_commission DESC);
    CREATE INDEX IF NOT EXISTS idx_pkg_price    ON packages(current_price);

    CREATE TABLE IF NOT EXISTS crawl_log (
      city_code TEXT PRIMARY KEY,
      total     INTEGER,
      fetched   INTEGER,
      pages     INTEGER,
      ok        INTEGER,
      error     TEXT,
      ran_at    TEXT
    );
  `);
  return db;
}

async function fetchCities() {
  const json = await post(CITY_API, { channelCode: 'WX_XCX' });
  const allCity = json?.obj?.allCity || {};
  const list = [];
  for (const arr of Object.values(allCity)) {
    for (const c of arr) {
      if (!c?.cityCode) continue;
      list.push({
        cityCode: String(c.cityCode),
        cityName: c.cityName || '',
        lng: Number(c.longitude),
        lat: Number(c.latitude),
        packageCount: Number(c.packageCount) || 0,
      });
    }
  }
  return list.sort((a, b) => b.packageCount - a.packageCount);
}

const insertPkg = (db) => db.prepare(`
  INSERT INTO packages (
    package_id, goods_id, park_code, park_name, package_name, simple_name,
    biz_type, package_type, address, canton, province, city, district,
    lng, lat, distance, current_price, origin_price, distribute_price,
    max_commission, commission, commission_amt, favour_amt,
    status, package_rules, city_code, source_sort, raw, fetched_at
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  ON CONFLICT(package_id) DO UPDATE SET
    province       = excluded.province,
    city           = excluded.city,
    district       = excluded.district,
    canton         = excluded.canton,
    current_price  = excluded.current_price,
    max_commission = excluded.max_commission,
    commission     = excluded.commission,
    status         = excluded.status,
    raw            = excluded.raw,
    fetched_at     = excluded.fetched_at
`);

function toRow(item, cityCode, sortMode) {
  const g = splitCanton(item.canton || '');
  const df = item.distributeFavour || {};
  return [
    item.packageId || item.packageCode,
    item.goodsId || null,
    item.parkCode || null,
    item.parkName || null,
    item.packageName || null,
    item.simpleName || null,
    item.bizType || null,
    item.packageType != null ? String(item.packageType) : null,
    item.address || null,
    item.canton || null,
    g.province || null,
    g.city || null,
    g.district || null,
    item.longitude != null ? Number(item.longitude) : null,
    item.latitude != null ? Number(item.latitude) : null,
    item.distance != null ? Number(item.distance) : null,
    item.currentPrice != null ? Number(item.currentPrice) : null,
    item.originPrice != null ? Number(item.originPrice) : null,
    df.currentPrice != null ? Number(df.currentPrice) : null,
    item.maxCommission != null ? Number(item.maxCommission) : null,
    df.commission != null ? Number(df.commission) : null,
    df.commissionAmt != null ? Number(df.commissionAmt) : null,
    df.favourAmt != null ? Number(df.favourAmt) : null,
    item.status || null,
    item.packageRuleList ? JSON.stringify(item.packageRuleList) : null,
    cityCode,
    sortMode,
    JSON.stringify(item),
    new Date().toISOString(),
  ];
}

async function crawlCity(db, city, sortMode = '1') {
  const stmt = insertPkg(db);
  let pageIndex = 1;
  let total = 0;
  let fetched = 0;
  let pages = 0;

  while (true) {
    const json = await post(LIST_API, {
      userId: '',
      openId: '',
      pageSize: PAGE_SIZE,
      pageIndex,
      longitude: city.lng,
      latitude: city.lat,
      userLongitude: city.lng,
      userLatitude: city.lat,
      sortMode,
      platform: ['ios'],
    });
    const data = json?.data || {};
    const list = data.data || [];
    total = Number(data.totalRecord) || total;
    if (!list.length) break;

    db.exec('BEGIN');
    try {
      for (const item of list) {
        if (!(item.packageId || item.packageCode)) continue;
        stmt.run(...toRow(item, city.cityCode, sortMode));
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    fetched += list.length;
    pages += 1;

    const totalPage = Number(data.totalPage) || Math.ceil(total / PAGE_SIZE);
    if (pageIndex >= totalPage || pageIndex >= 100) break;
    pageIndex += 1;
    await sleep(DELAY_MS);
  }

  db.prepare(`
    INSERT INTO crawl_log (city_code, total, fetched, pages, ok, error, ran_at)
    VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(city_code) DO UPDATE SET
      total=excluded.total, fetched=excluded.fetched, pages=excluded.pages,
      ok=excluded.ok, error=excluded.error, ran_at=excluded.ran_at
  `).run(city.cityCode, total, fetched, pages, 1, null, new Date().toISOString());

  return { total, fetched, pages };
}

async function main() {
  const db = initDb();

  if (doReset) {
    db.exec('DELETE FROM packages; DELETE FROM crawl_log; DELETE FROM cities;');
    console.log('已清空数据');
  }

  console.log('拉取城市列表…');
  const cities = await fetchCities();
  console.log(`城市数 ${cities.length}，套餐计数合计 ${cities.reduce((s, c) => s + c.packageCount, 0)}`);

  const updCity = db.prepare(`
    INSERT INTO cities (city_code, city_name, province, longitude, latitude, package_count, crawled_at)
    VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(city_code) DO UPDATE SET
      city_name=excluded.city_name, longitude=excluded.longitude,
      latitude=excluded.latitude, package_count=excluded.package_count
  `);
  for (const c of cities) {
    updCity.run(c.cityCode, c.cityName, c.cityName.replace(/市$/, ''), c.lng, c.lat, c.packageCount, null);
  }

  const targets = onlyCity ? cities.filter((c) => c.cityCode === onlyCity) : cities;
  if (!targets.length) {
    console.error(`未找到城市 ${onlyCity}`);
    process.exit(1);
  }

  let i = 0;
  let grand = 0;
  for (const city of targets) {
    i += 1;
    const t0 = Date.now();
    try {
      const r = await crawlCity(db, city);
      grand += r.fetched;
      const dup = db.prepare('SELECT COUNT(*) AS c FROM packages').get().c;
      console.log(
        `[${i}/${targets.length}] ${city.cityName}(${city.cityCode}) 声明${r.total} 拉取${r.fetched} 页${r.pages} ` +
        `${Date.now() - t0}ms | 库内累计 ${dup}`
      );
    } catch (err) {
      console.log(`[${i}/${targets.length}] ${city.cityName} 失败：${err.message}`);
      db.prepare(`
        INSERT INTO crawl_log (city_code, total, fetched, pages, ok, error, ran_at)
        VALUES (?,?,?,?,?,?,?)
        ON CONFLICT(city_code) DO UPDATE SET ok=0, error=excluded.error, ran_at=excluded.ran_at
      `).run(city.cityCode, 0, 0, 0, 0, String(err.message).slice(0, 200), new Date().toISOString());
    }
    await sleep(DELAY_MS);
  }

  const stat = db.prepare('SELECT COUNT(*) AS total, COUNT(DISTINCT park_code) AS parks, COUNT(DISTINCT city) AS cities FROM packages').get();
  console.log(`\n完成：本轮拉取 ${grand} 条`);
  console.log(`库内套餐 ${stat.total} 条 / 停车场 ${stat.parks} 个 / 城市 ${stat.cities} 个`);
  console.log(`数据库：${DB_PATH}`);
  db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

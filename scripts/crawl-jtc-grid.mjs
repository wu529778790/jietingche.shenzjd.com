#!/usr/bin/env node
/**
 * 捷停车选品池 · 网格补抓
 *
 * 背景：query_package_list 是按「查询坐标」附近由近到远分页的，
 * 没有任何省市区参数（传 cityCode 无效）。每城只查市中心一个点，
 * 只能拿到市中心半径内的套餐，远郊/其他城区会被漏掉。
 *
 * 做法：以城市中心为原点做多圈网格采样，每个点翻若干页，
 * 用 package_id 去重合并进同一个 data/jtc.db（可反复增量跑）。
 *
 * 用法：
 *   node --no-warnings scripts/crawl-jtc-grid.mjs                 全量补抓
 *   node --no-warnings scripts/crawl-jtc-grid.mjs --city 440300   只跑一个城市
 *   node --no-warnings scripts/crawl-jtc-grid.mjs --pages 6       每个点最多翻 6 页
 */

import { DatabaseSync } from "node:sqlite";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { splitCanton } from "./lib/canton.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = resolve(__dirname, "../data/jtc.db");

const LIST_API = "https://sytgate.jslife.com.cn/base-gateway/distribute-business/query_package_list";
const HEADERS = {
  "Content-Type": "application/json;charset=UTF-8",
  applicationVersion: "1.1.0",
  "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) MicroMessenger/8.0.49",
};
const PAGE_SIZE = 200;
const DELAY_MS = 250;
/** 内圈半径 9km（8 个方向），大城市再加一圈 18km、30km */
const INNER_M = 9000;
const OUTER_M = 18000;
const FAR_M = 30000;
/** 单个点位实测池子超过这个值算大城市，再外扩一圈（官方声明量不可靠，用实测值判断） */
const BIG_CITY_POOL = 800;
const HUGE_CITY_POOL = 1500;

const args = process.argv.slice(2);
const argValue = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const onlyCity = argValue("--city");
const maxPages = Number(argValue("--pages") ?? 8) || 8;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function post(body, retry = 2) {
  for (let i = 0; i <= retry; i += 1) {
    try {
      const res = await fetch(LIST_API, {
        method: "POST",
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

/** 以中心点为中心，按米生成环形采样点 */
function ringPoints(lng, lat, radiusM, count = 8) {
  const dLat = radiusM / 111000;
  const cosLat = Math.max(0.2, Math.cos((lat * Math.PI) / 180));
  const dLng = radiusM / (111000 * cosLat);
  const points = [];
  for (let i = 0; i < count; i += 1) {
    const angle = (2 * Math.PI * i) / count;
    points.push({
      lng: Number((lng + dLng * Math.cos(angle)).toFixed(6)),
      lat: Number((lat + dLat * Math.sin(angle)).toFixed(6)),
    });
  }
  return points;
}

function db() {
  const database = new DatabaseSync(DB_PATH);
  database.exec("PRAGMA journal_mode = WAL");
  database.exec(`
    CREATE TABLE IF NOT EXISTS crawl_grid_log (
      city_code TEXT PRIMARY KEY,
      points    INTEGER,
      requests  INTEGER,
      added     INTEGER,
      total     INTEGER,
      ran_at    TEXT
    );
  `);
  return database;
}

function toRow(item, cityCode) {
  const { province, city, district } = splitCanton(item.canton);

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
    province || null,
    city || null,
    district || null,
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
    "grid",
    JSON.stringify(item),
    new Date().toISOString(),
  ];
}

const UPSERT = `
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
`;

async function main() {
  const database = db();
  const upsert = database.prepare(UPSERT);

  const known = new Set(
    database.prepare("SELECT package_id AS id FROM packages").all().map((row) => row.id),
  );
  console.log(`库里已有套餐 ${known.size} 条`);

  const cities = database
    .prepare(
      `SELECT city_code AS code, city_name AS name, longitude AS lng, latitude AS lat,
              COALESCE(package_count, 0) AS cnt
       FROM cities WHERE longitude IS NOT NULL AND latitude IS NOT NULL
       ORDER BY cnt DESC`,
    )
    .all();

  const targets = onlyCity ? cities.filter((c) => String(c.code) === onlyCity) : cities;
  if (!targets.length) {
    console.error(`未找到城市 ${onlyCity}`);
    process.exit(1);
  }

  const logStmt = database.prepare(`
    INSERT INTO crawl_grid_log (city_code, points, requests, added, total, ran_at)
    VALUES (?,?,?,?,?,?)
    ON CONFLICT(city_code) DO UPDATE SET
      points=excluded.points, requests=excluded.requests, added=excluded.added,
      total=excluded.total, ran_at=excluded.ran_at
  `);

  let index = 0;
  let grandAdded = 0;

  for (const city of targets) {
    index += 1;
    const startedAt = Date.now();
    const lng = Number(city.lng);
    const lat = Number(city.lat);
    let requests = 0;
    let added = 0;
    let cityTotal = 0;
    let pointsUsed = 0;

    const crawlPoint = async (point) => {
      pointsUsed += 1;
      let stale = 0;
      for (let pageIndex = 1; pageIndex <= maxPages; pageIndex += 1) {
        const json = await post({
          userId: "",
          openId: "",
          pageSize: PAGE_SIZE,
          pageIndex,
          longitude: point.lng,
          latitude: point.lat,
          userLongitude: point.lng,
          userLatitude: point.lat,
          sortMode: "1",
          platform: ["ios"],
        });
        requests += 1;
        const data = json?.data || {};
        const list = data.data || [];
        cityTotal = Math.max(cityTotal, Number(data.totalRecord) || 0);
        if (!list.length) break;

        let fresh = 0;
        database.exec("BEGIN");
        try {
          for (const item of list) {
            const id = item.packageId || item.packageCode;
            if (!id) continue;
            if (!known.has(id)) fresh += 1;
            upsert.run(...toRow(item, String(city.code)));
          }
          database.exec("COMMIT");
        } catch (err) {
          database.exec("ROLLBACK");
          throw err;
        }
        for (const item of list) {
          const id = item.packageId || item.packageCode;
          if (id) known.add(id);
        }
        added += fresh;

        // 连续两页基本都是老数据，说明这个点周边已被覆盖
        stale = fresh <= Math.max(3, list.length * 0.03) ? stale + 1 : 0;
        if (stale >= 2) break;

        const totalPage = Number(data.totalPage) || 0;
        if (totalPage && pageIndex >= totalPage) break;
        await sleep(DELAY_MS);
      }
      await sleep(DELAY_MS);
    };

    try {
      const inner = [{ lng, lat }, ...ringPoints(lng, lat, INNER_M, 8)];
      for (const point of inner) await crawlPoint(point);

      // 按实测池子大小（而不是官方声明量）决定是否再外扩
      if (cityTotal >= BIG_CITY_POOL) {
        for (const point of ringPoints(lng, lat, OUTER_M, 8)) await crawlPoint(point);
      }
      if (cityTotal >= HUGE_CITY_POOL) {
        for (const point of ringPoints(lng, lat, FAR_M, 8)) await crawlPoint(point);
      }

      logStmt.run(String(city.code), pointsUsed, requests, added, cityTotal, new Date().toISOString());
      grandAdded += added;
      console.log(
        `[${index}/${targets.length}] ${city.name} 点${pointsUsed} 请求${requests} 新增${added} ` +
          `实测池${cityTotal} 库内${known.size} ${Date.now() - startedAt}ms`,
      );
    } catch (err) {
      console.log(`[${index}/${targets.length}] ${city.name} 失败：${err.message}`);
      logStmt.run(String(city.code), pointsUsed, requests, added, cityTotal, new Date().toISOString());
    }
  }

  const stat = database
    .prepare(
      `SELECT COUNT(*) AS total, COUNT(DISTINCT park_code) AS parks, COUNT(DISTINCT city_code) AS cities
       FROM packages`,
    )
    .get();
  console.log(`\n本轮新增 ${grandAdded} 条`);
  console.log(`库内套餐 ${stat.total} / 车场 ${stat.parks} / 城市 ${stat.cities}`);
  database.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

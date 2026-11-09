#!/usr/bin/env node
/**
 * 重点城市深度补抓（北上广深优先）
 *
 * 与 crawl-jtc-grid.mjs 的区别：
 *   - grid 是「以城市中心撒几圈点」的粗采样，适合全国扫一遍；
 *   - deep 用「已有套餐坐标自举 + 10~60km 多圈」的密集锚点，
 *     把大城市远郊、卫星城、行政区交界处捞干净，可多轮迭代到饱和。
 *
 * 自举原理：官方列表只按查询坐标由近到远分页，没有行政区参数；
 * 已抓到的每个套餐坐标本身就是「这里确实有车场」的证据，
 * 按 ~3km 网格去重后每个格子中心再查一次，就能覆盖所有已知密集区。
 *
 * 用法：
 *   node --no-warnings scripts/crawl-jtc-deep.mjs                 北上广深，2 轮
 *   node --no-warnings scripts/crawl-jtc-deep.mjs --city 110100   只跑北京
 *   node --no-warnings scripts/crawl-jtc-deep.mjs --capitals      只跑省会/直辖市（不含已饱和的北上广深）
 *   node --no-warnings scripts/crawl-jtc-deep.mjs --rounds 3      多迭代一轮
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
const DELAY_MS = 200;

/** 重点城市：city_code → 前台用的城市名 */
const TOP4 = {
  "110100": "北京市",
  "310100": "上海市",
  "440100": "广州市",
  "440300": "深圳市",
};
/** 省会 / 直辖市 / 计划单列市，只取官方城市列表里真实存在的 code */
const CAPITALS = {
  "120100": "天津市", "500100": "重庆市",
  "320100": "南京市", "330100": "杭州市", "510100": "成都市", "420100": "武汉市",
  "610100": "西安市", "370100": "济南市", "350100": "福州市", "430100": "长沙市",
  "410100": "郑州市", "230100": "哈尔滨市", "220100": "长春市", "210100": "沈阳市",
  "340100": "合肥市", "360100": "南昌市", "530100": "昆明市", "520100": "贵阳市",
  "450100": "南宁市", "460100": "海口市", "620100": "兰州市", "140100": "太原市",
  "130100": "石家庄市", "150100": "呼和浩特市",
  "650100": "乌鲁木齐市", "540100": "拉萨市", "210200": "大连市", "370200": "青岛市",
};

/** 环半径（米）与每圈点数 */
const RINGS_M = [10000, 20000, 30000, 40000, 50000, 60000];
const RING_COUNT = 12;
/** 已有坐标自举网格，单位度（约 3km） */
const GRID_STEP = 0.03;
/** 锚点合并去重精度 */
const ANCHOR_STEP = 0.01;

const args = process.argv.slice(2);
const argValue = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const onlyCity = argValue("--city");
const withCapitals = args.includes("--capitals");
const rounds = Math.max(1, Math.min(5, Number(argValue("--rounds") ?? 2) || 2));
const maxPages = Math.max(1, Math.min(8, Number(argValue("--pages") ?? 3) || 3));

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

function ringPoints(lng, lat, radiusM, count = RING_COUNT) {
  const dLat = radiusM / 111000;
  const cosLat = Math.max(0.2, Math.cos((lat * Math.PI) / 180));
  const dLng = radiusM / (111000 * cosLat);
  return Array.from({ length: count }, (_, i) => {
    const angle = (2 * Math.PI * i) / count;
    return {
      lng: Number((lng + dLng * Math.cos(angle)).toFixed(6)),
      lat: Number((lat + dLat * Math.sin(angle)).toFixed(6)),
    };
  });
}

function toRow(item, cityCode) {
  const geo = splitCanton(item.canton);
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
    geo.province || null,
    geo.city || null,
    geo.district || null,
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
    "deep",
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
    province = excluded.province, city = excluded.city, district = excluded.district,
    canton = excluded.canton, current_price = excluded.current_price,
    max_commission = excluded.max_commission, commission = excluded.commission,
    status = excluded.status, raw = excluded.raw, fetched_at = excluded.fetched_at
`;

/** 环采样 + 已抓坐标自举，按 ANCHOR_STEP 合并去重 */
function buildAnchors(database, city) {
  const lng = Number(city.lng);
  const lat = Number(city.lat);
  const raw = [{ lng, lat }];
  for (const radius of RINGS_M) raw.push(...ringPoints(lng, lat, radius));

  const spots = database
    .prepare("SELECT lng, lat FROM packages WHERE city = ? AND lng > 0 AND lat > 0")
    .all(city.bizName);
  const cells = new Map();
  for (const spot of spots) {
    const key = `${Math.round(spot.lng / GRID_STEP)},${Math.round(spot.lat / GRID_STEP)}`;
    const acc = cells.get(key) ?? { lng: 0, lat: 0, n: 0 };
    acc.lng += Number(spot.lng);
    acc.lat += Number(spot.lat);
    acc.n += 1;
    cells.set(key, acc);
  }
  for (const acc of cells.values()) {
    raw.push({ lng: Number((acc.lng / acc.n).toFixed(6)), lat: Number((acc.lat / acc.n).toFixed(6)) });
  }

  const seen = new Set();
  return raw.filter((point) => {
    const key = `${Math.round(point.lng / ANCHOR_STEP)},${Math.round(point.lat / ANCHOR_STEP)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function main() {
  const database = new DatabaseSync(DB_PATH);
  database.exec("PRAGMA journal_mode = WAL");
  database.exec(`
    CREATE TABLE IF NOT EXISTS crawl_deep_log (
      city_code TEXT PRIMARY KEY,
      rounds    INTEGER,
      anchors   INTEGER,
      requests  INTEGER,
      added     INTEGER,
      ran_at    TEXT
    );
  `);
  const upsert = database.prepare(UPSERT);
  const known = new Set(
    database.prepare("SELECT package_id AS id FROM packages").all().map((row) => row.id),
  );
  console.log(`库里已有套餐 ${known.size} 条`);

  // --capitals 时只跑省会，避免把已饱和的北上广深再跑一遍
  const wanted = withCapitals ? CAPITALS : TOP4;
  const cityRows = database
    .prepare(
      `SELECT city_code AS code, longitude AS lng, latitude AS lat FROM cities
       WHERE city_code IN (${Object.keys(wanted).map(() => "?").join(",")})`,
    )
    .all(...Object.keys(wanted));
  const targets = cityRows
    .filter((row) => !onlyCity || String(row.code) === onlyCity)
    .map((row) => ({ ...row, bizName: wanted[String(row.code)] }));

  if (!targets.length) {
    console.error(`未找到城市 ${onlyCity ?? ""}`);
    process.exit(1);
  }
  console.log(`目标城市 ${targets.length} 个：${targets.map((c) => c.bizName).join("、")}`);

  const logStmt = database.prepare(`
    INSERT INTO crawl_deep_log (city_code, rounds, anchors, requests, added, ran_at)
    VALUES (?,?,?,?,?,?)
    ON CONFLICT(city_code) DO UPDATE SET
      rounds=excluded.rounds, anchors=excluded.anchors, requests=excluded.requests,
      added=excluded.added, ran_at=excluded.ran_at
  `);

  for (let index = 0; index < targets.length; index += 1) {
    const city = targets[index];
    const startedAt = Date.now();
    let requests = 0;
    let added = 0;
    let anchorsTotal = 0;

    try {
      for (let round = 1; round <= rounds; round += 1) {
        const anchors = buildAnchors(database, city);
        anchorsTotal += anchors.length;
        let roundAdded = 0;

        for (const point of anchors) {
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
            const list = json?.data?.data || [];
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
            roundAdded += fresh;

            stale = fresh <= Math.max(3, list.length * 0.03) ? stale + 1 : 0;
            if (stale >= 2) break;
            const totalPage = Number(json?.data?.totalPage) || 0;
            if (totalPage && pageIndex >= totalPage) break;
            await sleep(DELAY_MS);
          }
          await sleep(DELAY_MS);
        }

        console.log(
          `  ${city.bizName} 第${round}/${rounds}轮 锚点${anchors.length} 新增${roundAdded} 库内${known.size}`,
        );
        if (roundAdded === 0) break; // 已经饱和，不用再迭代
      }

      logStmt.run(String(city.code), rounds, anchorsTotal, requests, added, new Date().toISOString());
      console.log(
        `[${index + 1}/${targets.length}] ${city.bizName} 锚点${anchorsTotal} 请求${requests} 新增${added} ` +
          `${Date.now() - startedAt}ms`,
      );
    } catch (err) {
      console.log(`[${index + 1}/${targets.length}] ${city.bizName} 失败：${err.message}`);
      logStmt.run(String(city.code), rounds, anchorsTotal, requests, added, new Date().toISOString());
    }
  }

  const stat = database
    .prepare(
      `SELECT COUNT(*) AS total, COUNT(DISTINCT park_code) AS parks FROM packages
       WHERE city IN (${Object.values(wanted).map(() => "?").join(",")})`,
    )
    .get(...Object.values(wanted));
  console.log(`\n重点城市合计：套餐 ${stat.total} / 车场 ${stat.parks}，全库 ${known.size} 条套餐`);
  database.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

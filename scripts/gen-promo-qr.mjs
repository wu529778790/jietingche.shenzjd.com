#!/usr/bin/env node
/**
 * 推广二维码批量生成（路线 A：纯码图）
 *
 * 源：data/jtc.db（scripts/crawl-jtc.mjs 抓的捷停车选品池）
 * 出：data/promo/{城市}/{park_code}_{package_id前8}.png + data/promo/manifest.json
 *
 * 码内容 = 官方海报解码验证的 H5 链接（见 reference/promo-qr-research.md 第二节）：
 *   https://m.jparking.cn/carParkDetail?detailTab=service&sourceId=FXFX02
 *     &showPackageId={package_id}&parkCode={park_code}&shareCode={shareCode}
 *
 * ⚠️ shareCode 稳定性还没验证（码内嵌疑似生成时间戳），全量跑之前先按
 *    reference/promo-qr-research.md 第五节再出两张官方海报对比。
 *
 * 用法：
 *   node --no-warnings scripts/gen-promo-qr.mjs --limit 20        试跑 20 张
 *   node --no-warnings scripts/gen-promo-qr.mjs --city 深圳市      单城市
 *   node --no-warnings scripts/gen-promo-qr.mjs --park p240672210  单车场全部套餐
 *   node --no-warnings scripts/gen-promo-qr.mjs --global           全局兜底码（模板未验证）
 *   node --no-warnings scripts/gen-promo-qr.mjs --all              含售罄套餐（默认只在售）
 *
 * shareCode 可用 --share-code 或环境变量 JTC_SHARE_CODE 覆盖，默认用解码拿到的那枚。
 */

import { DatabaseSync } from "node:sqlite";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import QRCode from "qrcode";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SRC = resolve(ROOT, "data/jtc.db");
const OUT_DIR = resolve(ROOT, "data/promo");

/* ------------------------------ 参数 ------------------------------ */

const args = process.argv.slice(2);
const argValue = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const hasFlag = (name) => args.includes(name);

const SHARE_CODE = argValue("--share-code") ?? process.env.JTC_SHARE_CODE
  ?? "USC26110923541177396R1w5";
const onlyCity = argValue("--city");
const onlyPark = argValue("--park");
const limit = Number(argValue("--limit") ?? 0) || 0;
const wantGlobal = hasFlag("--global");
const includeSoldout = hasFlag("--all");

const PACKAGE_URL = (pkgId, parkCode) =>
  `https://m.jparking.cn/carParkDetail?detailTab=service&sourceId=FXFX02`
  + `&showPackageId=${encodeURIComponent(pkgId)}&parkCode=${encodeURIComponent(parkCode)}`
  + `&shareCode=${encodeURIComponent(SHARE_CODE)}`;
// 2026-11-10 官方首页海报解码验证（sourceId=FXFX01）
const GLOBAL_URL = `https://m.jparking.cn/search-stall?shareCode=${encodeURIComponent(SHARE_CODE)}&sourceId=FXFX01`;

if (!existsSync(SRC)) {
  console.error(`找不到源库：${SRC}`);
  console.error("先跑数据抓取：node --no-warnings scripts/crawl-jtc.mjs");
  process.exit(1);
}

if (!wantGlobal && !onlyPark && !onlyCity && !limit) {
  console.error("shareCode 稳定性未验证，拒绝无范围全量出码。");
  console.error("请加 --limit N 试跑，或用 --city / --park 圈定范围。");
  process.exit(1);
}

/* ------------------------------ 出码 ------------------------------ */

const db = new DatabaseSync(SRC, { readOnly: true });

async function writeQr(filePath, url) {
  // 600px、margin 2：微信扫一扫相册识别的稳妥尺寸
  await QRCode.toFile(filePath, url, {
    width: 600,
    margin: 2,
    errorCorrectionLevel: "M",
    color: { dark: "#000000", light: "#ffffff" },
  });
}

const manifest = [];
let generated = 0;

if (wantGlobal) {
  mkdirSync(OUT_DIR, { recursive: true });
  const file = resolve(OUT_DIR, "global-fallback.png");
  await writeQr(file, GLOBAL_URL);
  manifest.push({
    packageId: "",
    parkCode: "",
    parkName: "全局兜底",
    packageName: "搜索页",
    city: "",
    url: GLOBAL_URL,
    file,
  });
  generated += 1;
  console.log(`兜底码：${file}`);
}

const where = [];
const params = [];
if (!includeSoldout) where.push(`status = 'ENABLE'`);
if (onlyCity) { where.push(`city = ?`); params.push(onlyCity); }
if (onlyPark) { where.push(`park_code = ?`); params.push(onlyPark); }
const sql = `
  SELECT package_id, park_code, park_name, package_name, city, district, current_price
  FROM packages
  ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
  ORDER BY max_commission DESC
  ${limit ? `LIMIT ${limit}` : ""}
`;
const rows = db.prepare(sql).all(...params);

for (const row of rows) {
  const cityDir = resolve(OUT_DIR, row.city || "未知城市");
  mkdirSync(cityDir, { recursive: true });
  const file = resolve(cityDir, `${row.park_code}_${row.package_id.slice(0, 8)}.png`);
  const url = PACKAGE_URL(row.package_id, row.park_code);
  await writeQr(file, url);
  manifest.push({
    packageId: row.package_id,
    parkCode: row.park_code,
    parkName: row.park_name,
    packageName: row.package_name,
    city: row.city,
    district: row.district,
    priceFen: row.current_price,
    url,
    file,
  });
  generated += 1;
}

writeFileSync(resolve(OUT_DIR, "manifest.json"), JSON.stringify({
  shareCode: SHARE_CODE,
  generatedAt: new Date().toISOString(),
  total: manifest.length,
  items: manifest,
}, null, 2));

console.log(`完成：${generated} 张 → ${OUT_DIR}`);
console.log(`清单：${resolve(OUT_DIR, "manifest.json")}`);

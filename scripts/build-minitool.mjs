#!/usr/bin/env node
/**
 * 小红书小工具构建：jtc.db → 全城市数据/二维码 → minitool/dist → zip
 * 打包规范：minitool-zip-builder SKILL（zip-artifact-spec / device-capabilities /
 * js-compatibility / css-compatibility / performance-budget / mini-tool-manifest）
 *
 * 多城市结构（官方 §2.7 静态资源外移）：
 *   minitool/dist/index.html            入口（根目录）
 *   minitool/dist/{app,style,data,qr-data}.{js,css}   主包文件（入口不进 assets/）
 *       data.js = window.__JTC_INDEX__（130 城索引）+ window.__JTC_DATA__（默认城市数据）
 *   minitool/dist/assets/city-*.js      各城市数据（参与平台外移，切换时动态加载）
 *   minitool/dist/mini_tool.json        高消耗能力标记
 *   minitool/dist/zhao-tingche-minitool.zip   上传包
 *
 * 用法：
 *   node --no-warnings scripts/build-minitool.mjs                       默认内联深圳市
 *   node --no-warnings scripts/build-minitool.mjs --city 广州市          内联城市改为广州
 *   node --no-warnings scripts/build-minitool.mjs --share-code USC…     覆盖兜底码 shareCode
 */

import { DatabaseSync } from "node:sqlite";
import { mkdirSync, copyFileSync, writeFileSync, existsSync, rmSync, readdirSync, readFileSync } from "node:fs";
import { dirname, resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import QRCode from "qrcode";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC_DB = resolve(ROOT, "data/jtc.db");
const SRC_DIR = resolve(ROOT, "minitool/src");
const DIST = resolve(ROOT, "minitool/dist");
const HOME = process.env.USERPROFILE || process.env.HOME;
const BUILDER = resolve(HOME ?? "", ".agents/skills/minitool-zip-builder");

const args = process.argv.slice(2);
const argValue = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const inlineCity = argValue("--city") ?? "深圳市";
// 全局兜底码：2026-11-10 官方首页海报解码（search-stall 会话）
const shareCode = argValue("--share-code") ?? process.env.JTC_SHARE_CODE
  ?? "USC261110002056207ZEqLdE";

/* ---------------------------- 数据清洗工具 ---------------------------- */

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

function stripTags(name) {
  return String(name ?? "").replace(/<[^>]+>/g, "").trim();
}

/** 套餐名去重：剥掉和车场名重复的前缀（performance-budget §2 数据瘦身） */
function stripPkgName(name, parkName) {
  const raw = String(name || "");
  let s = raw;
  if (parkName && s.indexOf(parkName) === 0) {
    s = s.slice(parkName.length)
      .replace(/^[（(\-－_·.、\s]+/, "")
      .replace(/[）)]$/, "");
  }
  return s.trim().length >= 2 ? s.trim() : raw;
}

const TIME_TYPE_CN = {
  EVERY_DAY: "每天",
  WORK_DAY: "工作日",
  WEEK_DAY: "周末",
  HOLIDAY: "节假日",
};

/** package_rules 存的是 JSON 数组文本 → 解析成「每天 00:00-23:59」式人话（解析失败回退原文） */
function ruleText(raw) {
  const text = String(raw || "").trim();
  if (!text.startsWith("[")) return text;
  try {
    const arr = JSON.parse(text);
    if (!Array.isArray(arr)) return text;
    const parts = arr.map((x) => {
      if (x && x.timePeriod) return String(x.timePeriod);
      const day = x && TIME_TYPE_CN[x.timeType] ? TIME_TYPE_CN[x.timeType] : "";
      const range = x && x.beginTime && x.endTime ? `${x.beginTime}-${x.endTime}` : "";
      return [day, range].filter(Boolean).join(" ");
    }).filter(Boolean);
    return parts.join(" / ") || text;
  } catch {
    return text;
  }
}

function safeJson(text) {
  try { return JSON.parse(text); } catch { return {}; }
}

/* ------------------------------ 1. 读库 → 全城市数据 ------------------------------ */

if (!existsSync(SRC_DB)) {
  console.error(`找不到源库：${SRC_DB}`);
  console.error("先跑数据抓取：node --no-warnings scripts/crawl-jtc.mjs");
  process.exit(1);
}

const db = new DatabaseSync(SRC_DB, { readOnly: true });
const rows = db.prepare(`
  SELECT park_code, park_name, package_name, package_id, package_type,
         address, district, city, lng, lat, current_price, origin_price,
         package_rules, raw
  FROM packages
  WHERE status = 'ENABLE'
`).all();

// 城市中心坐标（cities 表，定位自动切城用）
const cityCenters = new Map();
for (const c of db.prepare("SELECT city_name, longitude, latitude FROM cities").all()) {
  if (c.longitude && c.latitude) cityCenters.set(c.city_name, [c.longitude, c.latitude]);
}

const parks = new Map();
let skippedDeposit = 0;
for (const r of rows) {
  // 过滤「付定金专用」类非月卡套餐（避免拉低最低价误导用户）
  if (stripTags(r.package_name).includes("付定金")) { skippedDeposit += 1; continue; }
  let park = parks.get(r.park_code);
  if (!park) {
    park = {
      pc: r.park_code,
      n: r.park_name,
      a: r.address || "",
      d: r.district === "中国" ? "" : (r.district || ""),
      i: guessIndustry(`${r.park_name} ${r.address || ""}`),
      g: [r.lng || 0, r.lat || 0],
      c: r.city || "",
      p: [],
    };
    parks.set(r.park_code, park);
  }
  const raw = safeJson(r.raw);
  park.p.push({
    id: r.package_id,
    n: stripPkgName(stripTags(r.package_name), r.park_name),
    t: String(r.package_type),
    v: String(raw.packageInterval ?? 0),
    pr: r.current_price || 0,
    po: r.origin_price || 0,
    ru: ruleText(r.package_rules),
  });
}

// 按城市分组，城市按套餐量降序排
const byCity = new Map();
for (const park of parks.values()) {
  const c = park.c || "未知城市";
  if (!byCity.has(c)) byCity.set(c, []);
  byCity.get(c).push(park);
}
const cityList = [...byCity.entries()]
  .map(([c, list]) => ({
    c,
    parks: list,
    n: list.length,
    p: list.reduce((s, x) => s + x.p.length, 0),
  }))
  .sort((a, b) => b.p - a.p);

if (!byCity.has(inlineCity)) {
  console.error(`内联城市「${inlineCity}」没有在售套餐，可用城市 TOP5：`
    + cityList.slice(0, 5).map((x) => `${x.c}(${x.p})`).join(" "));
  process.exit(1);
}

const updatedAt = new Date().toISOString().slice(0, 10);
const cityIndex = cityList.map((x, i) => ({
  c: x.c,
  n: x.n,
  p: x.p,
  g: cityCenters.get(x.c) || null,
  // 默认内联城市不带文件（主包 data.js 里已有），其余为 assets/city-N.js
  f: x.c === inlineCity ? "" : `c${i}.js`,
}));

/* ------------------------------ 2. 兜底推广码 base64 ------------------------------ */

const globalUrl = `https://m.jparking.cn/search-stall?shareCode=${shareCode}&sourceId=FXFX01`;
const qrBuf = await QRCode.toBuffer(globalUrl, {
  width: 600,
  margin: 2,
  errorCorrectionLevel: "M",
});

/* ------------------------------ 3. 组装 dist（入口在根，城市数据进 assets/） ------------------------------ */

rmSync(DIST, { recursive: true, force: true });
mkdirSync(resolve(DIST, "assets"), { recursive: true });
copyFileSync(resolve(SRC_DIR, "index.html"), resolve(DIST, "index.html"));
for (const f of ["app.js", "style.css"]) {
  copyFileSync(resolve(SRC_DIR, f), resolve(DIST, f));
}
// 纯 JS 二维码编码器（运行时为每个套餐现场画直达码）
copyFileSync(resolve(ROOT, "node_modules/qrcode-generator/dist/qrcode.js"), resolve(DIST, "qr-encoder.js"));

const inline = cityList.find((x) => x.c === inlineCity);
writeFileSync(
  resolve(DIST, "data.js"),
  `window.__JTC_INDEX__=${JSON.stringify({ updatedAt, cities: cityIndex })};\n`
  + `window.__JTC_DATA__=${JSON.stringify({ city: inline.c, updatedAt, parks: inline.parks })};\n`
);
writeFileSync(
  resolve(DIST, "qr-data.js"),
  `window.__JTC_QR__={global:"data:image/png;base64,${qrBuf.toString("base64")}"};\n`
  + `window.__JTC_SHARE__=${JSON.stringify(shareCode)};\n`
);

let cityFiles = 0;
let cityBytes = 0;
for (const entry of cityIndex) {
  if (!entry.f) continue;
  const x = byCity.get(entry.c);
  const body = JSON.stringify({ city: entry.c, updatedAt, parks: x });
  const file = resolve(DIST, "assets", entry.f);
  writeFileSync(file, `window.__JTC_CITY_DATA__=${body};\n`);
  cityFiles += 1;
  cityBytes += body.length;
}

/* ------------------------------ 4. 禁用 API 静态扫描门禁（device-capabilities §6） ------------------------------ */

const BANNED = [
  { re: /fetch\s*\(/, label: "fetch()" },
  { re: /XMLHttpRequest/, label: "XMLHttpRequest" },
  { re: /new\s+WebSocket\s*\(/, label: "WebSocket" },
  { re: /new\s+EventSource\s*\(/, label: "EventSource" },
  { re: /new\s+RTCPeerConnection\s*\(/, label: "RTCPeerConnection" },
  {
    re: /navigator\.geolocation/,
    label: "navigator.geolocation（仅允许「平台 getLocation 优先 + 浏览器降级」双路径）",
    allow: (t) => /typeof\s+mini\.getLocation\s*===\s*"function"/.test(t),
  },
  { re: /navigator\.clipboard/, label: "navigator.clipboard" },
  { re: /execCommand\s*\(/, label: "document.execCommand" },
  { re: /navigator\.(bluetooth|usb|hid|serial)/, label: "硬件连接 API" },
  { re: /navigator\.(getBattery|connection)/, label: "设备信息 API" },
  { re: /navigator\.(credentials|locks)/, label: "凭据 API" },
  { re: /navigator\.storage\.persist/, label: "持久化存储" },
  { re: /navigator\.serviceWorker/, label: "Service Worker" },
  { re: /new\s+(Shared)?Worker\s*\(/, label: "Worker（未评估前禁用）" },
  { re: /eval\s*\(/, label: "eval()" },
  { re: /new\s+Function\s*\(/, label: "new Function()" },
  { re: /WebAssembly\./, label: "WebAssembly" },
  { re: /window\.open\s*\(/, label: "window.open" },
  { re: /window\.prompt\s*\(/, label: "window.prompt" },
  { re: /location\.href\s*=|location\.assign\s*\(/, label: "站外跳转" },
  { re: /requestFullscreen/, label: "requestFullscreen" },
  { re: /target\s*=\s*["']_blank["']/, label: "target=_blank" },
  { re: /<iframe[\s>]|<object[\s>]/i, label: "iframe/object" },
  { re: /type\s*=\s*["']module["']/, label: "type=module（容器必须经典脚本）" },
  { re: /(src|href)\s*=\s*["']https?:/i, label: "外部资源引用" },
  { re: /url\(\s*["']?https?:/i, label: "外部 CSS 资源" },
];

function scanText(fileLabel, text) {
  for (const rule of BANNED) {
    if (!rule.re.test(text)) continue;
    if (rule.allow && rule.allow(text)) continue;
    violations.push(`${fileLabel}: ${rule.label}`);
  }
}

const violations = [];
scanText("index.html", readFileSync(resolve(DIST, "index.html"), "utf8"));
for (const f of ["app.js", "style.css", "data.js", "qr-data.js", "qr-encoder.js"]) {
  scanText(f, readFileSync(resolve(DIST, f), "utf8"));
}
for (const name of readdirSync(resolve(DIST, "assets"))) {
  if (!/\.(html|css|js)$/.test(extname(name))) continue;
  scanText(`assets/${name}`, readFileSync(resolve(DIST, "assets", name), "utf8"));
}

if (violations.length) {
  console.error("禁用 API 扫描未通过（device-capabilities §6）：");
  for (const v of violations) console.error("  ✗ " + v);
  process.exit(1);
}
console.log("禁用 API 扫描：通过（0 命中）");

/* ------------------------------ 5. mini_tool.json（官方脚本，false：无 Worker/WASM/离屏/引擎） ------------------------------ */

const writeManifest = resolve(BUILDER, "scripts/write_manifest.mjs");
if (existsSync(writeManifest)) {
  execFileSync("node", [writeManifest, DIST, "false"]);
  console.log("mini_tool.json：false（无高消耗能力）");
} else {
  console.warn(`警告：未找到官方 write_manifest.mjs（${BUILDER}），跳过清单生成`);
}

/* ------------------------------ 6. 官方审计 → zip → 审计 zip ------------------------------ */

const audit = resolve(BUILDER, "scripts/audit_artifact.mjs");
if (existsSync(audit)) {
  console.log("--- 官方审计：dist 目录 ---");
  execFileSync("node", [audit, DIST], { stdio: "inherit" });
} else {
  console.warn("警告：未找到官方 audit_artifact.mjs，未运行自动审计");
}

const zipPath = resolve(DIST, "zhao-tingche-minitool.zip");
execFileSync("powershell", [
  "-NoProfile", "-Command",
  `Compress-Archive -Path '${DIST}\\index.html','${DIST}\\app.js','${DIST}\\style.css','${DIST}\\data.js','${DIST}\\qr-data.js','${DIST}\\qr-encoder.js','${DIST}\\mini_tool.json','${DIST}\\assets' -DestinationPath '${zipPath}' -Force`,
]);

if (existsSync(audit)) {
  console.log("--- 官方审计：最终 zip ---");
  execFileSync("node", [audit, zipPath], { stdio: "inherit" });
}

console.log(`城市：${cityList.length} 个｜车场 ${parks.size}｜套餐 ${cityList.reduce((s, x) => s + x.p, 0)}${skippedDeposit ? `｜已过滤付定金 ${skippedDeposit} 条` : ""}`);
console.log(`内联城市：${inlineCity}（data.js ${(JSON.stringify(inline.parks).length / 1024).toFixed(0)}KB）｜城市分包 ${cityFiles} 个共 ${(cityBytes / 1024).toFixed(0)}KB`);
console.log(`兜底码：${globalUrl}`);
console.log(`上传包：${zipPath}`);

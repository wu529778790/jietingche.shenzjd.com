#!/usr/bin/env node
/**
 * 静态落地页生成（GitHub Pages 用）：把快照铺成「城市 / 区域 / 车场」三类可收录页面。
 *
 * 为什么要有这个脚本：H5 静态包只有一个 index.html，城市切换是 JS 里的内存数组，
 * 爬虫只看到一个页面；而旧 Next 站那 9 千多个 /city/* /park/* 是 SEO 的全部家当。
 * 这里用同一份快照（data/jtc-snapshot.json）在**构建期**把它们重新铺成纯静态 HTML，
 * URL 规则与旧站完全一致（见 src/lib/seo.ts）：
 *
 *   /city/<中文城市>/                       城市页
 *   /city/<中文城市>/<中文区域>/             区域页
 *   /park/<park_code>/                     车场页
 *   /city/                                 全站城市索引（hub）
 *
 * 生成物写进 --out（默认 platforms/pages/dist）；sitemap.xml 按**实际生成的文件**重写，
 * 不再手写 URL 清单，避免出现「sitemap 里有、站点上没有」的 404。
 *
 * 用法：
 *   node scripts/build-pages-site.mjs --snapshot data/jtc-snapshot.json --out _site
 *   node scripts/build-pages-site.mjs --city 深圳市 --parks 20 --out /tmp/site   # 样本
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const argValue = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const SNAPSHOT = resolve(ROOT, argValue("--snapshot") ?? "data/jtc-snapshot.json");
const OUT = resolve(ROOT, argValue("--out") ?? "platforms/pages/dist");
/** 样本模式：只出这个城市的车场页（城市/区域页照出，方便看整条链路） */
const ONLY_CITY = argValue("--city") ?? "";
/** 样本模式：每个城市最多出多少个车场页（0 = 全量） */
const PARK_LIMIT = Number(argValue("--parks") ?? 0) || 0;

const SITE = "https://jietingche.shenzjd.com";
const SITE_NAME = "泊月";
const TAGLINE = "停车月卡，附近谁家最省";
/** 城市页/区域页里最多列多少个车场（再多就靠 sitemap 直接发现，不做分页） */
const LIST_CAP = 100;

/* ------------------------------ 口径（与 src/shared/domain.ts 一致） ------------------------------ */

const TYPE_LABEL = { "1": "月卡", "2": "日卡", "3": "次卡", "4": "年卡", "5": "半年卡", "6": "季卡" };
const TYPE_DAYS = { "1": 30, "2": 1, "3": 1, "4": 365, "5": 180, "6": 90 };

const daysOfType = (type) => TYPE_DAYS[type] || 30;
/** 折合月价（分） */
const monthlyPrice = (price, days) => Math.round((price * 30) / Math.max(1, days));
const yuan = (cent) => (cent / 100).toFixed(2).replace(/\.00$/, "");
const monthlyText = (cent) => (cent > 0 ? `¥${Math.round(cent / 100)}` : "");
const cityShort = (city) => String(city || "").replace(/市$/, "");

const esc = (text) =>
  String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");

/** 目录/链接里的中文段：与旧站一致，href 用编码后的形式，文件目录用原文 */
const seg = (text) => encodeURIComponent(String(text));

/* ------------------------------ 快照 → 车场/套餐 ------------------------------ */

function cleanPkgName(raw, parkName) {
  let name = String(raw ?? "").replace(/\s+/g, " ").trim();
  name = name.replace(/[<>《》]/g, "");
  if (parkName && name.startsWith(parkName)) name = name.slice(parkName.length).trim();
  const wrapped = /^[（(](.+)[）)]$/.exec(name);
  if (wrapped) name = wrapped[1].trim();
  name = name.replace(/^[·\-—、,，\s]+/, "");
  // 「夜间套餐_1月 / _1季 / _1年」→「夜间套餐」：时长在类型列里，不重复展示
  name = name.replace(/[_\s]*\d+\s*(月|季|年|天|日|次)$/, "").trim();
  return name || "套餐";
}

/** 规则摘要：把 package_rules 的 timePeriod 去重拼起来（「工作日 17:30-08:30；周末 全天」） */
function ruleSummary(raw) {
  try {
    const rules = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!Array.isArray(rules)) return "";
    const seen = [];
    for (const rule of rules) {
      const text = String(rule?.timePeriod || "").replace(/\s+/g, " ").trim();
      if (!text) continue;
      // 「工作日 工作日 18:30-08:30」这种重复词压掉
      const tidy = text.replace(/^(\S+)\s+\1\s*/, "$1 ");
      if (!seen.includes(tidy)) seen.push(tidy);
    }
    return seen.slice(0, 3).join("；");
  } catch {
    return "";
  }
}

function slotOf(name) {
  if (/夜间|晚上|下班/.test(name)) return "夜间";
  if (/白天|日间/.test(name)) return "白天";
  if (/全天|24小时/.test(name)) return "全天";
  return "";
}

const snap = JSON.parse(readFileSync(SNAPSHOT, "utf8"));
const parksByCode = new Map();

for (const row of snap.rows || []) {
  const code = String(row.park_code || "");
  if (!code) continue;
  const price = Number(row.current_price) || 0;
  if (price <= 0) continue; // 未定价的不进页面（与 H5 包口径一致）
  // 「付定金专用」是占位套餐（¥10），不是真实月卡价，照着算会把城市最低价写歪
  if (/付定金|定金专用/.test(String(row.package_name || ""))) continue;

  let park = parksByCode.get(code);
  if (!park) {
    park = {
      code,
      name: String(row.park_name || code).trim(),
      address: String(row.address || "").trim(),
      district: String(row.district || "").trim(),
      city: String(row.city || "").trim(),
      lat: Number(row.lat) || 0,
      lng: Number(row.lng) || 0,
      packages: [],
      lowest: Infinity,
    };
    parksByCode.set(code, park);
  }
  const type = String(row.package_type || "1");
  const days = daysOfType(type);
  const monthly = monthlyPrice(price, days);
  park.packages.push({
    id: String(row.package_id || ""),
    name: cleanPkgName(row.package_name, park.name),
    type: TYPE_LABEL[type] || "套餐",
    days,
    price,
    origin: Number(row.origin_price) || 0,
    monthly,
    rules: ruleSummary(row.package_rules),
    slot: slotOf(row.package_name),
  });
  if (monthly > 0 && monthly < park.lowest) park.lowest = monthly;
}

const parks = [...parksByCode.values()].filter((park) => park.packages.length && park.city);
for (const park of parks) {
  park.packages.sort((a, b) => a.price - b.price);
  park.nameLabel = /(停车场|停车库|车库|车场)$/.test(park.name) ? park.name : `${park.name}停车场`;
  if (!Number.isFinite(park.lowest)) park.lowest = 0;
}

/* 城市 / 区域聚合 */
const byCity = new Map();
for (const park of parks) {
  if (!byCity.has(park.city)) byCity.set(park.city, []);
  byCity.get(park.city).push(park);
}
const byArea = new Map(); // `${city}|${district}` → parks
for (const park of parks) {
  if (!park.district) continue;
  const key = `${park.city}|${park.district}`;
  if (!byArea.has(key)) byArea.set(key, []);
  byArea.get(key).push(park);
}

/** 区域中间价（车场数 <5 不出「贵/便宜」句子，样本太小没意义） */
const areaMedian = new Map();
for (const [key, list] of byArea) {
  if (list.length < 5) continue;
  const values = list.map((park) => park.lowest).filter((v) => v > 0).sort((a, b) => a - b);
  if (values.length < 5) continue;
  const mid = Math.floor(values.length / 2);
  areaMedian.set(key, values.length % 2 ? values[mid] : Math.round((values[mid - 1] + values[mid]) / 2));
}

const haversine = (lat1, lng1, lat2, lng2) => {
  const rad = (d) => (d * Math.PI) / 180;
  const a1 = rad(lat1), b1 = rad(lng1), a2 = rad(lat2), b2 = rad(lng2);
  const x = Math.sin(a1) * Math.sin(a2) + Math.cos(a1) * Math.cos(a2) * Math.cos(b2 - b1);
  return 6371000 * Math.acos(Math.min(1, Math.max(-1, x)));
};
const distText = (m) => (m < 1000 ? `${Math.round(m)}m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)}km`);

/* ------------------------------ 页面骨架 ------------------------------ */

const CSS = `
:root{--ink:#101828;--sub:#667085;--line:#e6e9ef;--brand:#1b6bff;--bg:#f6f8fb}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.65 -apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif}
a{color:inherit;text-decoration:none}
.wrap{max-width:720px;margin:0 auto;padding:0 16px 48px}
header.top{background:linear-gradient(135deg,#1b6bff,#0d3fb0);color:#fff;padding:20px 0 26px;margin-bottom:18px}
header.top .wrap{padding-bottom:0}
.brand{display:flex;align-items:center;gap:8px;font-weight:700;font-size:17px}
.brand .pin{width:22px;height:22px;border-radius:6px;background:rgba(255,255,255,.22);display:flex;align-items:center;justify-content:center;font-size:12px}
.brand small{font-weight:400;opacity:.85;font-size:12px}
h1{font-size:22px;line-height:1.35;margin:16px 0 6px}
.lead{color:var(--sub);font-size:13px;margin:0 0 14px}
header.top .lead{color:rgba(255,255,255,.88);margin:0}
.crumb{font-size:12px;color:var(--sub);margin:0 0 14px}
.crumb a{color:var(--sub)}
.crumb span{margin:0 6px;opacity:.5}
.card{background:#fff;border:1px solid var(--line);border-radius:14px;padding:16px;margin-bottom:14px}
.card h2{font-size:16px;margin:0 0 12px}
.price-tag{font-size:28px;font-weight:700;color:var(--brand);line-height:1.2}
.price-tag small{font-size:13px;font-weight:400;color:var(--sub);margin-left:4px}
.kv{display:flex;flex-wrap:wrap;gap:8px 18px;font-size:13px;color:var(--sub);margin-top:8px}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{text-align:left;padding:9px 6px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--sub);font-weight:500;font-size:12px}
td.num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
.was{color:#98a2b3;text-decoration:line-through;font-size:12px;margin-left:4px}
.rules{font-size:12px;color:var(--sub);margin-top:4px}
.cta{display:block;text-align:center;background:var(--brand);color:#fff;font-weight:600;padding:13px;border-radius:12px;margin:16px 0}
.cta-note{text-align:center;font-size:12px;color:var(--sub);margin:-6px 0 0}
.links{display:flex;flex-wrap:wrap;gap:8px}
.links a{background:#eef4ff;color:#1250c8;border-radius:999px;padding:7px 12px;font-size:13px}
.links a .n{color:#7a90c8;font-size:12px;margin-left:4px}
.list{display:grid;gap:10px}
.item{display:flex;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid var(--line)}
.item:last-child{border-bottom:0}
.item .name{font-weight:600;font-size:14px}
.item .addr{font-size:12px;color:var(--sub);margin-top:2px}
.item .p{text-align:right;white-space:nowrap;font-weight:700;color:var(--brand);font-size:15px}
.item .p small{display:block;font-weight:400;color:var(--sub);font-size:12px}
.note{font-size:12px;color:var(--sub);margin:10px 0 0}
footer{font-size:12px;color:var(--sub);text-align:center;padding:22px 16px 40px;border-top:1px solid var(--line);margin-top:8px}
footer a{color:var(--brand)}
`;

function shell({ title, description, canonical, jsonld, headerExtra = "", body }) {
  const ld = (jsonld || [])
    .map((item) => `<script type="application/ld+json">${JSON.stringify(item)}</script>`)
    .join("\n");
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:image" content="${SITE}/og.png">
<meta name="theme-color" content="#1b6bff">
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<style>${CSS}</style>
${ld}
</head>
<body>
<header class="top"><div class="wrap">
<a class="brand" href="/"><span class="pin">P</span>${SITE_NAME}<small>${TAGLINE}</small></a>
${headerExtra}
</div></header>
<main class="wrap">
${body}
</main>
<footer>
<a href="/">${SITE_NAME}</a> · ${TAGLINE}<br>
数据来自捷停车公开选品池，价格为发布时的快照（${esc(snap.generatedAt || "")}），实际以下单页为准。
</footer>
</body>
</html>
`;
}

const breadcrumbLd = (items) => ({
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: items.map((item, index) => ({
    "@type": "ListItem",
    position: index + 1,
    name: item.name,
    ...(item.url ? { item: item.url } : {}),
  })),
});

/* ------------------------------ 三个模板 ------------------------------ */

const urls = [];
/**
 * 写一个页面。目录名必须用**原文**（深圳市/index.html）——服务器收到请求时会把
 * %E6%B7%B1… 解码再查文件，目录名写成编码形式反而 404；href / canonical 才用编码形式。
 */
const write = (dirPath, hrefPath, html) => {
  const file = join(OUT, dirPath, "index.html");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, html);
  urls.push(hrefPath);
};

const cityDir = (city) => `/city/${city}/`;
const areaDir = (city, district) => `/city/${city}/${district}/`;
const parkDir = (code) => `/park/${code}/`;

function cityUrl(city) {
  return `/city/${seg(city)}/`;
}
function areaUrl(city, district) {
  return `/city/${seg(city)}/${seg(district)}/`;
}
function parkUrl(code) {
  return `/park/${seg(code)}/`;
}

function pricePosition(park) {
  const median = areaMedian.get(`${park.city}|${park.district}`);
  if (!median || !park.lowest) return "";
  const diff = (park.lowest - median) / median;
  const pct = Math.round(Math.abs(diff) * 100);
  const area = `${cityShort(park.city)}${park.district}`;
  if (pct < 5) return `和${area}的中间价（${monthlyText(median)}/月）基本持平。`;
  return diff < 0
    ? `比${area}的中间价（${monthlyText(median)}/月）便宜约 ${pct}%。`
    : `比${area}的中间价（${monthlyText(median)}/月）贵约 ${pct}%，同区还有更便宜的，见下方。`;
}

function parkPage(park) {
  const area = `${cityShort(park.city)}${park.district}`;
  const title = park.lowest
    ? `${park.nameLabel}月卡 ${monthlyText(park.lowest)}/月（${area}）｜${SITE_NAME}`
    : `${park.nameLabel}停车月卡价格（${area}）｜${SITE_NAME}`;
  const description = `${park.nameLabel}月卡最低 ${monthlyText(park.lowest)}/月起，共 ${park.packages.length} 个套餐在售，夜间/白天/全天可选，扫码在捷停车官方小程序办理。地址：${park.address || area}。`;

  const rows = park.packages
    .slice(0, 12)
    .map((pkg) => {
      const label = [pkg.type, pkg.slot].filter(Boolean).join(" · ");
      return `<tr><td>${esc(pkg.name)}<div class="rules">${esc(label)}${pkg.rules ? "｜" + esc(pkg.rules) : ""}</div></td>
<td class="num">¥${yuan(pkg.price)}${pkg.origin > pkg.price ? `<span class="was">¥${yuan(pkg.origin)}</span>` : ""}
<div class="rules">折合 ${monthlyText(pkg.monthly)}/月</div></td></tr>`;
    })
    .join("\n");

  // 周边车场：同城 + 同区优先，按直线距离取 8 个（区界上也不会指到 10 公里外）
  const nearby = parks
    .filter((other) => other.code !== park.code && other.city === park.city)
    .map((other) => ({ other, d: haversine(park.lat, park.lng, other.lat, other.lng) }))
    .filter((item) => item.d > 0 && item.d < 8000)
    .sort((a, b) => a.d - b.d)
    .slice(0, 8)
    .map(
      (item) =>
        `<a href="${parkUrl(item.other.code)}">${esc(item.other.nameLabel)}<span class="n">${distText(item.d)} · ${monthlyText(item.other.lowest)}/月</span></a>`,
    )
    .join("");

  const faq = [
    {
      q: `${park.nameLabel}停车月卡多少钱？`,
      a: `发布时在售 ${park.packages.length} 个套餐，最低折合 ${monthlyText(park.lowest)}/月，最贵 ${monthlyText(Math.max(...park.packages.map((p) => p.monthly)))}/月；套餐按时段分${[...new Set(park.packages.map((p) => p.slot).filter(Boolean))].join("、") || "全天"}，价格与规则以下单页为准。`,
    },
    {
      q: `${park.nameLabel}月卡怎么办理？`,
      a: `点页面上的「打开查询页」进入${SITE_NAME}，搜到该车场后选套餐，用微信扫官方小程序码办理；费用由捷停车官方收取，本站不代收。`,
    },
  ];

  const body = `
<nav class="crumb"><a href="/">首页</a><span>/</span><a href="${cityUrl(park.city)}">${esc(cityShort(park.city))}停车月卡</a>${
    park.district ? `<span>/</span><a href="${areaUrl(park.city, park.district)}">${esc(park.district)}</a>` : ""
  }<span>/</span>${esc(park.nameLabel)}</nav>
<h1>${esc(park.nameLabel)}月卡</h1>
<p class="lead">${esc(park.address || area)}${park.district ? ` · ${esc(park.district)}` : ""}</p>

<div class="card">
  <div class="price-tag">${monthlyText(park.lowest)}<small>/月起</small></div>
  <div class="kv"><span>${park.packages.length} 个套餐在售</span><span>${esc(area)}</span></div>
  ${pricePosition(park) ? `<p class="note">${esc(pricePosition(park))}</p>` : ""}
</div>

<div class="card">
  <h2>在售套餐</h2>
  <table><thead><tr><th>套餐 / 时段</th><th class="num">价格</th></tr></thead><tbody>
  ${rows}
  </tbody></table>
  <p class="note">「折合月价」= 套餐价 ÷ 有效天数 × 30，用来跨卡种比价。</p>
</div>

<a class="cta" href="/?city=${seg(park.city)}&amp;kw=${seg(park.name)}">打开查询页，看这个车场的套餐</a>
<p class="cta-note">扫码在捷停车官方小程序办理 · 本站不代收费用</p>

${
  nearby
    ? `<div class="card"><h2>附近还有这些车场</h2><div class="links">${nearby}</div></div>`
    : ""
}
<div class="card">
  <h2>常见问题</h2>
  ${faq.map((item) => `<p><strong>${esc(item.q)}</strong><br><span class="note">${esc(item.a)}</span></p>`).join("")}
</div>
`;

  write(
    parkDir(park.code),
    parkUrl(park.code),
    shell({
      title,
      description,
      canonical: SITE + parkUrl(park.code),
      jsonld: [
        breadcrumbLd([
          { name: "首页", url: SITE + "/" },
          { name: `${cityShort(park.city)}停车月卡`, url: SITE + cityUrl(park.city) },
          ...(park.district
            ? [{ name: park.district, url: SITE + areaUrl(park.city, park.district) }]
            : []),
          { name: park.nameLabel },
        ]),
        {
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: faq.map((item) => ({
            "@type": "Question",
            name: item.q,
            acceptedAnswer: { "@type": "Answer", text: item.a },
          })),
        },
      ],
      body,
    }),
  );
}

function parkListHtml(list) {
  return `<div class="list">${list
    .map(
      (park) => `<a class="item" href="${parkUrl(park.code)}">
  <div><div class="name">${esc(park.nameLabel)}</div><div class="addr">${esc(park.district)} · ${esc(park.address || "")}</div></div>
  <div class="p">${monthlyText(park.lowest)}<small>起/月</small></div>
</a>`,
    )
    .join("\n")}</div>`;
}

function cityPage(city, list) {
  const short = cityShort(city);
  const sorted = [...list].sort((a, b) => a.lowest - b.lowest || a.name.localeCompare(b.name));
  const lowest = sorted.find((park) => park.lowest > 0)?.lowest || 0;
  const packageCount = list.reduce((sum, park) => sum + park.packages.length, 0);

  const districts = [...new Set(list.map((park) => park.district).filter(Boolean))]
    .map((district) => ({ district, parks: byArea.get(`${city}|${district}`) || [] }))
    .sort((a, b) => b.parks.length - a.parks.length);

  const title = `${short}停车月卡多少钱？${list.length} 个车场最低 ${monthlyText(lowest)}/月｜${SITE_NAME}`;
  const description = `${short}有 ${list.length} 个停车场能办月卡，共 ${packageCount} 个在售套餐，最低 ${monthlyText(lowest)}/月起，覆盖${districts
    .slice(0, 4)
    .map((item) => item.district)
    .join("、")}等区域。按价格挑最省的，扫码在捷停车官方小程序办理。`;

  const body = `
<nav class="crumb"><a href="/">首页</a><span>/</span>${esc(short)}停车月卡</nav>
<h1>${esc(short)}停车月卡</h1>
<p class="lead">${esc(short)} ${list.length} 个车场可办月卡，最低 ${monthlyText(lowest)}/月</p>

<div class="card">
  <div class="kv"><span>车场 ${list.length} 个</span><span>在售套餐 ${packageCount} 个</span><span>最低 ${monthlyText(lowest)}/月</span></div>
</div>

<div class="card">
  <h2>${esc(short)}的区域</h2>
  <div class="links">${districts
    .map(
      (item) =>
        `<a href="${areaUrl(city, item.district)}">${esc(item.district)}<span class="n">${item.parks.length}</span></a>`,
    )
    .join("")}</div>
</div>

<div class="card">
  <h2>${esc(short)}月卡最省的 ${Math.min(sorted.length, LIST_CAP)} 个车场</h2>
  ${parkListHtml(sorted.slice(0, LIST_CAP))}
  ${sorted.length > LIST_CAP ? `<p class="note">还有 ${sorted.length - LIST_CAP} 个车场没列出，可用上方区域入口查看，或直接搜车场名。</p>` : ""}
</div>

<a class="cta" href="/?city=${seg(city)}">打开查询页，按位置找${esc(short)}的车场</a>
<p class="cta-note">点「位置」选区域，或直接搜车场名</p>

<div class="card">
  <h2>其他城市</h2>
  <div class="links">${[...byCity.entries()]
    .filter(([name]) => name !== city)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 12)
    .map(([name, item]) => `<a href="${cityUrl(name)}">${esc(cityShort(name))}<span class="n">${item.length}</span></a>`)
    .join("")}</div>
</div>
`;

  write(
    cityDir(city),
    cityUrl(city),
    shell({
      title,
      description,
      canonical: SITE + cityUrl(city),
      jsonld: [
        breadcrumbLd([
          { name: "首页", url: SITE + "/" },
          { name: `${short}停车月卡` },
        ]),
      ],
      body,
    }),
  );
}

function areaPage(city, district, list) {
  const short = cityShort(city);
  const sorted = [...list].sort((a, b) => a.lowest - b.lowest || a.name.localeCompare(b.name));
  const lowest = sorted.find((park) => park.lowest > 0)?.lowest || 0;
  const median = areaMedian.get(`${city}|${district}`);
  const title = `${short}${district}停车月卡｜${list.length} 个车场最低 ${monthlyText(lowest)}/月｜${SITE_NAME}`;
  const description = `${short}${district}有 ${list.length} 个车场能办停车月卡，最低 ${monthlyText(lowest)}/月起${
    median ? `，区域中间价 ${monthlyText(median)}/月` : ""
  }。按价格排序，扫码在捷停车官方小程序办理。`;

  const body = `
<nav class="crumb"><a href="/">首页</a><span>/</span><a href="${cityUrl(city)}">${esc(short)}停车月卡</a><span>/</span>${esc(district)}</nav>
<h1>${esc(short)}${esc(district)}停车月卡</h1>
<p class="lead">${list.length} 个车场可办 · 最低 ${monthlyText(lowest)}/月起${median ? ` · 区域中间价 ${monthlyText(median)}/月` : ""}</p>

<div class="card">
  <h2>${esc(district)}的车场（按月价升序）</h2>
  ${parkListHtml(sorted.slice(0, LIST_CAP))}
  ${sorted.length > LIST_CAP ? `<p class="note">还有 ${sorted.length - LIST_CAP} 个车场没列出。</p>` : ""}
</div>

<a class="cta" href="/?city=${seg(city)}">打开查询页，按位置找${esc(district)}的车场</a>

<div class="card">
  <h2>${esc(short)}其他区域</h2>
  <div class="links">${[...new Set(parks.filter((p) => p.city === city).map((p) => p.district))]
    .filter((name) => name && name !== district)
    .map((name) => ({ name, size: (byArea.get(`${city}|${name}`) || []).length }))
    .sort((a, b) => b.size - a.size)
    .slice(0, 12)
    .map((item) => `<a href="${areaUrl(city, item.name)}">${esc(item.name)}<span class="n">${item.size}</span></a>`)
    .join("")}</div>
</div>
`;

  write(
    areaDir(city, district),
    areaUrl(city, district),
    shell({
      title,
      description,
      canonical: SITE + areaUrl(city, district),
      jsonld: [
        breadcrumbLd([
          { name: "首页", url: SITE + "/" },
          { name: `${short}停车月卡`, url: SITE + cityUrl(city) },
          { name: district },
        ]),
      ],
      body,
    }),
  );
}

function cityIndexPage() {
  const list = [...byCity.entries()].sort((a, b) => b[1].length - a[1].length);
  const title = `全国 ${list.length} 个城市的停车月卡价格｜${SITE_NAME}`;
  const description = `${list.length} 个城市、${parks.length} 个停车场能办月卡，按月价排序，扫码在捷停车官方小程序办理。`;
  const body = `
<nav class="crumb"><a href="/">首页</a><span>/</span>全部城市</nav>
<h1>全部城市</h1>
<p class="lead">${list.length} 个城市 · ${parks.length} 个车场可办月卡</p>
<div class="card"><div class="links">${list
    .map(([name, item]) => `<a href="${cityUrl(name)}">${esc(cityShort(name))}<span class="n">${item.length}</span></a>`)
    .join("")}</div></div>
<a class="cta" href="/">打开查询页，按位置找车场</a>
`;
  write(
    "/city/",
    "/city/",
    shell({
      title,
      description,
      canonical: SITE + "/city/",
      jsonld: [
        breadcrumbLd([
          { name: "首页", url: SITE + "/" },
          { name: "全部城市" },
        ]),
      ],
      body,
    }),
  );
}

/* ------------------------------ 主流程 ------------------------------ */

const targetCities = ONLY_CITY ? [...byCity.keys()].filter((city) => city === ONLY_CITY) : [...byCity.keys()];
if (!targetCities.length) {
  console.error(`快照里没有城市「${ONLY_CITY}」`);
  process.exit(1);
}

let parkPages = 0;
for (const city of targetCities) {
  const list = byCity.get(city);
  if (!list?.length) continue;
  cityPage(city, list);
  for (const district of new Set(list.map((park) => park.district).filter(Boolean))) {
    const areaList = byArea.get(`${city}|${district}`);
    if (areaList?.length) areaPage(city, district, areaList);
  }
  const ordered = [...list].sort((a, b) => a.lowest - b.lowest || a.name.localeCompare(b.name));
  const picked = PARK_LIMIT > 0 ? ordered.slice(0, PARK_LIMIT) : ordered;
  for (const park of picked) parkPage(park);
  parkPages += picked.length;
}
if (!ONLY_CITY) cityIndexPage();

/* sitemap：按真实生成的文件来，首页 + /city/ + 所有落地页 */
const today = new Date().toISOString().slice(0, 10);
const entries = ["/", ...urls].map((urlPath) => {
  const loc = SITE + urlPath;
  const priority = urlPath === "/" ? "1.0" : urlPath.startsWith("/park/") ? "0.7" : "0.8";
  return `  <url><loc>${esc(loc)}</loc><lastmod>${today}</lastmod><priority>${priority}</priority></url>`;
});
writeFileSync(
  join(OUT, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.join("\n")}
</urlset>
`,
);

console.log(
  `落地页生成完成：${urls.length + 1} 个 URL（车场 ${parkPages} / 城市 ${targetCities.length} / 区域 ${urls.filter((u) => u.startsWith("/city/") && u.split("/").length > 4).length}）`,
);
console.log(`sitemap.xml：${entries.length} 条 → ${join(OUT, "sitemap.xml")}`);
if (ONLY_CITY) console.log(`样本模式：只出了「${ONLY_CITY}」`);
if (!existsSync(join(OUT, "index.html"))) console.log("提示：--out 里没有 index.html（H5 主站），落地页可以单独预览");

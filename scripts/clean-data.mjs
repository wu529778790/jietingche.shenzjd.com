#!/usr/bin/env node
/**
 * 存量数据清洗（幂等，可反复跑）。
 *
 * 官方选品池写进库里的套餐名带着推荐标签和下划线，规则摘要还会叠重复词：
 *   金銮国际商务大厦停车场（<禁停一期地库>夜间套餐1月）
 *   工作日 工作日 18:30-08:30 / 周末 周末 00:00-23:59
 * 这些会直接出现在访客界面和 SEO 标题里，所以导入侧（import-jtc.mjs）
 * 已经改成边导边洗，这个脚本负责把已经在库里的存量刷一遍。
 *
 * 用法：
 *   node --no-warnings scripts/clean-data.mjs            # 有 TURSO_* 就清线上，否则清本地
 *   node --no-warnings scripts/clean-data.mjs --local    # 强制只清 data/app.db
 *   node --no-warnings scripts/clean-data.mjs --dry      # 只统计要改多少，不写
 */

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@libsql/client";
import { cleanPackageName, cleanRuleSummary } from "../src/lib/packageText.ts";

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const hit = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!hit || line.trimStart().startsWith("#")) continue;
    const value = hit[2].replace(/^["']|["']$/g, "");
    if (!process.env[hit[1]]) process.env[hit[1]] = value;
  }
}

loadEnvFile(path.join(process.cwd(), ".env.local"));
loadEnvFile(path.join(process.cwd(), ".env"));

const args = process.argv.slice(2);
const forceLocal = args.includes("--local");
const dry = args.includes("--dry");

const remoteUrl = forceLocal ? "" : (process.env.TURSO_DATABASE_URL ?? "");
const client = remoteUrl
  ? createClient({ url: remoteUrl, authToken: process.env.TURSO_AUTH_TOKEN })
  : createClient({ url: `file:${path.resolve("data/app.db")}` });

console.log(`目标库：${remoteUrl || "data/app.db"}${dry ? "（dry run，不写库）" : ""}`);

function cleanParkName(name) {
  return String(name ?? "")
    .replace(/[<＜][^>＞]{1,24}[>＞]/g, "")
    .replace(/[ \t\u3000]+/g, " ")
    .trim();
}

function cleanKeywords(keywords) {
  return String(keywords ?? "")
    .replace(/[<＞]/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

const parkRes = await client.execute("SELECT id, name, keywords FROM car_parks");
const parkName = new Map(parkRes.rows.map((row) => [String(row.id), String(row.name ?? "")]));
console.log(`车场：${parkRes.rows.length}`);

const pkgRes = await client.execute(
  "SELECT id, park_id, name, rule_summary FROM packages",
);
console.log(`套餐：${pkgRes.rows.length}`);

const chunks = [];
let parkChanges = 0;
let nameChanges = 0;
let ruleChanges = 0;
const samples = [];

for (const row of parkRes.rows) {
  const id = String(row.id);
  const nextName = cleanParkName(row.name);
  const nextKeywords = cleanKeywords(row.keywords);
  if (nextName !== String(row.name ?? "") || nextKeywords !== String(row.keywords ?? "")) {
    parkChanges += 1;
    chunks.push({
      sql: "UPDATE car_parks SET name = ?, keywords = ? WHERE id = ?",
      args: [nextName, nextKeywords, id],
    });
  }
}

for (const row of pkgRes.rows) {
  const id = String(row.id);
  const park = parkName.get(String(row.park_id)) ?? "";
  const nextName = cleanPackageName(row.name, park);
  const nextRule = cleanRuleSummary(row.rule_summary);
  const nameChanged = nextName !== String(row.name ?? "");
  const ruleChanged = nextRule !== String(row.rule_summary ?? "");
  if (!nameChanged && !ruleChanged) continue;
  if (nameChanged) nameChanges += 1;
  if (ruleChanged) ruleChanges += 1;
  if (samples.length < 8 && nameChanged) {
    samples.push(`${row.name}  →  ${nextName}`);
  }
  chunks.push({
    sql: "UPDATE packages SET name = ?, rule_summary = ? WHERE id = ?",
    args: [nextName, nextRule, id],
  });
}

console.log({
  待改车场: parkChanges,
  待改套餐名: nameChanges,
  待改规则摘要: ruleChanges,
});
if (samples.length) {
  console.log("样例：");
  for (const line of samples) console.log("  " + line);
}

if (dry) {
  console.log("dry run 结束，未写库");
  process.exit(0);
}

const CHUNK = 200;
let done = 0;
for (let i = 0; i < chunks.length; i += CHUNK) {
  const slice = chunks.slice(i, i + CHUNK);
  await client.batch(slice, "write");
  done += slice.length;
  if (done % 2000 === 0 || done === chunks.length) {
    console.log(`写入 ${done}/${chunks.length}`);
  }
}

if (!chunks.length) console.log("没有需要清洗的数据");
else console.log(`完成，共更新 ${chunks.length} 行`);

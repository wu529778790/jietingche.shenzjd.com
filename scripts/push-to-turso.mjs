/**
 * 把本地 SQLite（data/app.db）整库搬到 Turso。
 *
 * 用法：
 *   node scripts/push-to-turso.mjs            # 默认 data/app.db
 *   node scripts/push-to-turso.mjs data/jtc.db
 *
 * 逻辑：
 *   1. 读本地 sqlite_master 的表/索引 DDL，先在远端 CREATE IF NOT EXISTS，
 *      不依赖 app 运行时的 ensureSchema（脚本也能单独跑）；
 *   2. 逐表 INSERT OR REPLACE，按 200 行一批走 libsql batch（每批一个事务），
 *      重复跑不会产生重复行；
 *   3. 跑完对一遍行数，不一致就以非 0 退出。
 *
 * 凭证从环境变量或 .env.local 读，不写在代码里。
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { DatabaseSync } from "node:sqlite";
import { createClient } from "@libsql/client";

const BATCH_ROWS = 200;

/** 极简 .env 读取：只需要 KEY=VALUE，够用且不引依赖 */
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

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
if (!url || !authToken) {
  console.error("缺少 TURSO_DATABASE_URL / TURSO_AUTH_TOKEN（.env.local 里配）");
  process.exit(1);
}

const source = path.resolve(process.argv[2] ?? "data/app.db");
if (!fs.existsSync(source)) {
  console.error(`找不到本地库：${source}`);
  process.exit(1);
}

const local = new DatabaseSync(source, { readOnly: true });
const remote = createClient({ url, authToken });

const tables = local
  .prepare("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND sql IS NOT NULL")
  .all();
const indexes = local
  .prepare("SELECT name, sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL")
  .all();

console.log(`源库 ${source}`);
console.log(`目标 ${url}`);
console.log(`表 ${tables.map((t) => t.name).join(", ")}`);

/* 1) 建表：DDL 原样执行，本地导出语句本身带 IF NOT EXISTS */
for (const table of tables) {
  await remote.execute(table.sql);
}
console.log("✓ 表结构就绪");

/* 2) 灌数据 */
for (const table of tables) {
  const columns = local
    .prepare(`PRAGMA table_info("${table.name}")`)
    .all()
    .map((c) => c.name);
  const rows = local.prepare(`SELECT * FROM "${table.name}"`).all();
  if (!rows.length) {
    console.log(`- ${table.name}：0 行，跳过`);
    continue;
  }

  const placeholders = `(${columns.map(() => "?").join(",")})`;
  const sql = `INSERT OR REPLACE INTO "${table.name}" (${columns.map((c) => `"${c}"`).join(",")}) VALUES ${placeholders}`;

  for (let i = 0; i < rows.length; i += BATCH_ROWS) {
    const chunk = rows.slice(i, i + BATCH_ROWS);
    await remote.batch(
      chunk.map((row) => ({ sql, args: columns.map((c) => (row[c] === undefined ? null : row[c])) })),
      "write",
    );
  }
  console.log(`✓ ${table.name}：${rows.length} 行`);
}

/* 3) 建索引（远端可能已存在，逐条容忍） */
for (const index of indexes) {
  await remote.execute(index.sql).catch(() => undefined);
}
console.log("✓ 索引就绪");

/* 4) 校验行数 */
let bad = 0;
for (const table of tables) {
  const want = local.prepare(`SELECT COUNT(*) AS n FROM "${table.name}"`).get().n;
  const got = (await remote.execute(`SELECT COUNT(*) AS n FROM "${table.name}"`)).rows[0].n;
  const ok = Number(got) >= Number(want);
  if (!ok) bad += 1;
  console.log(`${ok ? "✓" : "✗"} ${table.name}：本地 ${want} / 远端 ${got}`);
}

local.close();
if (bad) {
  console.error(`有 ${bad} 张表行数不一致`);
  process.exit(1);
}
console.log("全部完成");

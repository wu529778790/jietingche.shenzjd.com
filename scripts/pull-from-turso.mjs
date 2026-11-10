/**
 * 把 Turso 上的整库拉回本地 SQLite（push-to-turso 的反向操作）。
 *
 * 用法：
 *   node --no-warnings scripts/pull-from-turso.mjs                    # 默认写 data/app.db（旧的先备份成 .bak）
 *   node --no-warnings scripts/pull-from-turso.mjs data/other.db      # 换一个目标
 *
 * 为什么需要它：
 *   线上后台改过的数据只落在 Turso 上，本地 data/app.db 是上一次导入时的旧快照。
 *   要把线上切成本地 SQLite，就必须先从 Turso 拉一份「最新且一致」的副本，
 *   否则本地那些没推上去的改动会把线上的后台编辑冲掉。
 *
 * 逻辑：
 *   1. 读远端 sqlite_master 的建表/建索引 DDL，在本地文件里重建；
 *   2. 逐表分页 SELECT（每页 2000 行），按事务批量 INSERT；
 *   3. 跑完对一遍行数，不一致就以非 0 退出；
 *   4. 关闭前 VACUUM，保证产物是单个自包含文件（可以直接 scp 上传）。
 *
 * 凭证从环境变量或 .env.local 读，不写在代码里。
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { DatabaseSync } from "node:sqlite";
import { createClient } from "@libsql/client";

const PAGE_ROWS = 2000;

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

const target = path.resolve(process.argv[2] ?? "data/app.db");
const backup = `${target}.bak`;

console.log(`源 ${url}`);
console.log(`目标 ${target}`);

const remote = createClient({ url, authToken });

/* 1) 读远端表结构 */
const tables = (
  await remote.execute(
    "SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND sql IS NOT NULL",
  )
).rows;
const indexes = (
  await remote.execute("SELECT name, sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL")
).rows;

if (!tables.length) {
  console.error("远端一张表都没有，检查 TURSO_DATABASE_URL 是不是拿错了");
  process.exit(1);
}
console.log(`表：${tables.map((t) => String(t.name)).join(", ")}`);

/* 2) 建一个干净的目标文件（已有的先挪成 .bak，不直接删） */
fs.mkdirSync(path.dirname(target), { recursive: true });
if (fs.existsSync(target)) {
  for (const f of [backup, `${backup}-wal`, `${backup}-shm`]) {
    if (fs.existsSync(f)) fs.rmSync(f);
  }
  fs.renameSync(target, backup);
  console.log(`旧库已备份：${backup}`);
}
for (const suffix of ["", "-wal", "-shm"]) {
  const f = `${target}${suffix}`;
  if (fs.existsSync(f)) fs.rmSync(f);
}
const local = new DatabaseSync(target);
// 产物要能直接传走，所以不启用 WAL（否则会多出 -wal/-shm 两个文件）
local.exec("PRAGMA journal_mode = DELETE");
local.exec("PRAGMA synchronous = OFF");
local.exec("PRAGMA foreign_keys = OFF");

const withIfNotExists = (ddl) => String(ddl).replace(/^CREATE\s+(TABLE|INDEX)\s+/i, "CREATE $1 IF NOT EXISTS ");

for (const table of tables) {
  local.exec(withIfNotExists(table.sql));
}
console.log("✓ 表结构就绪");

/* 3) 逐表分页搬数据 */
const summary = [];
for (const table of tables) {
  const name = String(table.name);
  const columns = local
    .prepare(`PRAGMA table_info("${name}")`)
    .all()
    .map((c) => c.name);
  const total = Number((await remote.execute(`SELECT COUNT(*) AS n FROM "${name}"`)).rows[0].n);
  if (!total) {
    console.log(`- ${name}：0 行`);
    summary.push({ name, remote: 0, local: 0 });
    continue;
  }

  const sql = `INSERT OR REPLACE INTO "${name}" (${columns.map((c) => `"${c}"`).join(",")}) VALUES (${columns
    .map(() => "?")
    .join(",")})`;
  const insert = local.prepare(sql);

  local.exec("BEGIN");
  let done = 0;
  for (let offset = 0; offset < total; offset += PAGE_ROWS) {
    const page = await remote.execute({
      sql: `SELECT * FROM "${name}" LIMIT ? OFFSET ?`,
      args: [PAGE_ROWS, offset],
    });
    for (const row of page.rows) {
      insert.run(...columns.map((c) => (row[c] === undefined ? null : row[c])));
    }
    done += page.rows.length;
    if (page.rows.length === 0) break;
    process.stdout.write(`\r  ${name}：${done}/${total}`);
  }
  local.exec("COMMIT");
  process.stdout.write(`\r✓ ${name}：${done} 行\n`);
  summary.push({ name, remote: total, local: done });
}

/* 4) 建索引 */
for (const index of indexes) {
  local.exec(withIfNotExists(index.sql));
}
console.log("✓ 索引就绪");

local.exec("VACUUM");
local.close();

/* 5) 校验：远端 vs 新拉下来的本地 */
let bad = 0;
console.log("\n行数校验（远端 / 新本地）");
for (const item of summary) {
  const ok = item.remote === item.local;
  if (!ok) bad += 1;
  console.log(`${ok ? "✓" : "✗"} ${item.name}：${item.remote} / ${item.local}`);
}

/* 6) 提示旧库差在哪（备份文件不动） */
if (fs.existsSync(backup)) {
  try {
    const old = new DatabaseSync(backup, { readOnly: true });
    console.log(`\n旧库对比（${backup}）：`);
    for (const item of summary) {
      let oldRows = "n/a";
      try {
        oldRows = String(old.prepare(`SELECT COUNT(*) AS n FROM "${item.name}"`).get().n);
      } catch {
        /* 旧库没这张表 */
      }
      const same = oldRows === String(item.remote) ? "相同" : "不同";
      console.log(`  ${item.name}：旧 ${oldRows} / 远端 ${item.remote}（${same}）`);
    }
    old.close();
  } catch (error) {
    console.log(`\n旧库读不了，跳过对比：${error.message}`);
  }
}

const size = (fs.statSync(target).size / 1024 / 1024).toFixed(1);
console.log(`\n产物：${target}（${size} MB）`);
if (bad) {
  console.error(`有 ${bad} 张表行数不一致，别拿去覆盖线上`);
  process.exit(1);
}
console.log("全部完成");

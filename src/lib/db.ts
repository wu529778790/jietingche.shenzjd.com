import path from "node:path";
import fs from "node:fs";
import { createClient, type Client, type Row } from "@libsql/client";
import { COLUMN_MIGRATIONS, INDEX_SQL, TABLE_SQL } from "./schema";

/**
 * 数据库走本地 SQLite 文件，运行时不再依赖远程 Turso。
 *
 * 原因：服务器在新加坡、Turso 免费版只能开在东京、访客在大陆。
 * 一次跨洋往返 70~90ms，而首页一轮要跑 14 次查询，光等网络就 1 秒多。
 * 换成同机文件后单次查询 <1ms（数据量只有 10MB / 8.4k 车场 / 18.4k 套餐）。
 *
 * 数据怎么来：scripts/pull-from-turso.mjs 从 Turso 拉一份到 data/app.db
 * （或在服务器上直接放一份），上传流程见 README「数据分发」。
 *
 * 环境变量：
 *   JTC_DB=remote   临时直连 Turso（本地想读线上最新数据时用，需要 TURSO_*）
 *   JTC_DB_FILE=... 换一个库文件路径（默认 <cwd>/data/app.db）
 */
declare global {
  var __jtcClient: Client | undefined;
  var __jtcSchemaReady: boolean | undefined;
}

function createDb(): Client {
  if (process.env.JTC_DB === "remote") {
    const remoteUrl = process.env.TURSO_DATABASE_URL;
    if (!remoteUrl) throw new Error("JTC_DB=remote 但没配 TURSO_DATABASE_URL");
    return createClient({ url: remoteUrl, authToken: process.env.TURSO_AUTH_TOKEN });
  }
  const file = process.env.JTC_DB_FILE
    ? path.resolve(process.env.JTC_DB_FILE)
    : path.join(process.cwd(), "data", "app.db");
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return createClient({ url: `file:${file}` });
}

export const db: Client = globalThis.__jtcClient ?? createDb();
if (process.env.NODE_ENV !== "production") globalThis.__jtcClient = db;

/** 幂等建表 + 补列，第一次访问时执行 */
export async function ensureSchema() {
  if (globalThis.__jtcSchemaReady) return;
  const run = async (sql: string) => {
    for (const statement of sql.split(";").map((s) => s.trim()).filter(Boolean)) {
      await db.execute(statement);
    }
  };
  await run(TABLE_SQL);
  for (const [table, columns] of Object.entries(COLUMN_MIGRATIONS)) {
    const info = await db.execute(`PRAGMA table_info(${table})`);
    const existing = new Set(info.rows.map((row) => str(row.name)));
    for (const [column, definition] of columns) {
      if (existing.has(column)) continue;
      await db.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }
  await run(INDEX_SQL);
  globalThis.__jtcSchemaReady = true;
}

export function now() {
  return Date.now();
}

export function newId() {
  return crypto.randomUUID();
}

export function str(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

export function num(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function mapRows<T>(rows: Row[], mapper: (row: Row) => T): T[] {
  return rows.map(mapper);
}

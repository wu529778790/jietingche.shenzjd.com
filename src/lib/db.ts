import path from "node:path";
import fs from "node:fs";
import { createClient, type Client, type Row } from "@libsql/client";
import { COLUMN_MIGRATIONS, INDEX_SQL, TABLE_SQL } from "./schema";

declare global {
  var __jtcClient: Client | undefined;
  var __jtcSchemaReady: boolean | undefined;
}

function createDb(): Client {
  const remoteUrl = process.env.TURSO_DATABASE_URL;
  if (remoteUrl) {
    return createClient({
      url: remoteUrl,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
  }
  const dir = path.join(process.cwd(), "data");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return createClient({ url: `file:${path.join(dir, "app.db")}` });
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

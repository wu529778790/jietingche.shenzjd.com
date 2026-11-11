/**
 * 访问日志 / 事件埋点的写入端。
 *
 * 三条纪律：
 *   1. 绝不阻塞业务——调用方一律 `void recordVisit(...)`，内部自己 try/catch，
 *      日志写失败不能把页面带崩（这是「有日志」而不是「日志驱动业务」）。
 *   2. 不存原始 IP——只存加盐 sha256 前 16 位和 /24、/48 网段，
 *      既能算 UV、能做「同一个来源刷了多少次」排行，又不落个人标识。
 *   3. 按天裁剪——默认只留 90 天（LOG_KEEP_DAYS 可调），每小时最多裁一次。
 *
 * 关闭方式：LOG_OFF=1（埋点接口与访问日志一起停）。
 */
import crypto from "node:crypto";
import { db, ensureSchema } from "./db";
import { classifyUa } from "./ua";

/** 保留天数：够看季度趋势，又不至于把库撑大 */
const KEEP_DAYS = Math.max(1, Number(process.env.LOG_KEEP_DAYS ?? 90));
/** IP 加盐：只影响哈希，泄露也无所谓，但换个盐历史 UV 就断代了，别乱改 */
const IP_SALT = process.env.LOG_SALT ?? "jtc-visit-log";
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;

let lastPrune = 0;

export function logEnabled(): boolean {
  return process.env.LOG_OFF !== "1";
}

/** 北京时间（UTC+8）的 YYYY-MM-DD：站点的「今天」按北京时间算 */
export function dayKey(ts = Date.now()): string {
  const d = new Date(ts + 8 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

export function hashIp(ip: string): string {
  if (!ip) return "";
  return crypto.createHash("sha256").update(`${IP_SALT}:${ip}`).digest("hex").slice(0, 16);
}

/** IPv4 取前三段、IPv6 取前三段十六进制位：看得出机房/地域，认不出人 */
export function ipPrefix(ip: string): string {
  if (!ip) return "";
  if (ip.includes(":")) return ip.split(":").slice(0, 3).join(":") + "::";
  const parts = ip.split(".");
  return parts.length === 4 ? `${parts[0]}.${parts[1]}.${parts[2]}.0/24` : ip;
}

function cut(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

export interface VisitInput {
  kind: "page" | "api" | "event";
  /** 事件名（kind=event）或接口 scope（kind=api）；page 留空 */
  name?: string;
  path?: string;
  referer?: string;
  ua?: string;
  ip?: string;
  country?: string;
  region?: string;
  status?: number;
  /** 是否带 EdgeOne 特征头；false 代表请求没经过 CDN */
  viaCdn?: boolean;
  parkCode?: string;
  packageId?: string;
  q?: string;
  extra?: Record<string, unknown>;
}

export async function recordVisit(input: VisitInput): Promise<void> {
  if (!logEnabled()) return;
  try {
    await ensureSchema();
    const ts = Date.now();
    const ua = cut(input.ua ?? "", 200);
    await db.execute({
      sql: `INSERT INTO visit_logs
              (ts, day, kind, name, path, referer, ua_class, ua, ip_hash, ip_prefix,
               country, region, status, via_cdn, park_code, package_id, q, extra)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      args: [
        ts,
        dayKey(ts),
        input.kind,
        cut(input.name ?? "", 40),
        cut(input.path ?? "", 200),
        cut(input.referer ?? "", 200),
        classifyUa(input.ua ?? ""),
        ua,
        hashIp(input.ip ?? ""),
        ipPrefix(input.ip ?? ""),
        cut(input.country ?? "", 24),
        cut(input.region ?? "", 40),
        input.status ?? 0,
        input.viaCdn === false ? 0 : 1,
        cut(input.parkCode ?? "", 40),
        cut(input.packageId ?? "", 60),
        cut(input.q ?? "", 60),
        input.extra ? cut(JSON.stringify(input.extra), 300) : "",
      ],
    });
    void pruneIfDue(ts);
  } catch (error) {
    // 日志失败只打一行，不影响请求
    console.error("[visit-log] 写入失败", (error as Error).message);
  }
}

/** 每小时最多裁一次，别让 DELETE 跟着每个请求跑 */
async function pruneIfDue(now: number): Promise<void> {
  if (now - lastPrune < PRUNE_INTERVAL_MS) return;
  lastPrune = now;
  try {
    await db.execute({
      sql: "DELETE FROM visit_logs WHERE ts < ?",
      args: [now - KEEP_DAYS * 24 * 60 * 60 * 1000],
    });
  } catch {
    /* 裁剪失败下次再来 */
  }
}

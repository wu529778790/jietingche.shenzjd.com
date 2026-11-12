/**
 * 流量报表的读端：把 visit_logs 聚合成后台能直接看的样子。
 *
 * 口径（很重要，别和「真实商业数据」混）：
 *   - pv / uv 只统计 kind=page，即页面请求；api 与 event 单列。
 *   - uv 按 ip_hash 去重，等于「独立来源数」，不是人数——公司网络/运营商 NAT 会合并。
 *   - 二维码漏斗：park_pv（车场页曝光，页面本身就出码）→ sheet（首页点开套餐码弹层）
 *     → save（点了「下载二维码」）。微信内长按识别、iOS 存相册都点不到按钮，
 *     所以 save 一定小于真实拿到码的人数；再往后的扫码发生在捷停车官方小程序，本站拿不到。
 *   - direct = 请求没带 EdgeOne 特征头，即绕过 CDN 直连源站。
 */
import { db, ensureSchema, num, str } from "./db";
import { dayKey } from "./visitLog";

/**
 * 搜索词噪声：输入法中间态与过短的串。
 *
 * 历史上「科技园」被打成 ke → ke'ji → ke'ji'y → 科 → 科技园 五条，报表里全是碎片。
 * 前端现在会等输入停顿再埋点，但历史数据和个别浏览器不触发 composition 的情况
 * 仍会有碎片进来，所以在读端再滤一层：
 *   - 单字（「科」）
 *   - 拼音候选串（含 ' 或 ’）
 *   - 纯 ASCII 且长度 < 4（ke / ab / 123）
 */
function isNoiseQuery(raw: string): boolean {
  const q = raw.trim();
  if (q.length < 2) return true;
  if (/['’]/.test(q)) return true;
  if (/^[\x20-\x7e]+$/.test(q) && q.length < 4) return true;
  return false;
}

function decodeSeg(seg: string): string {
  try {
    return decodeURIComponent(seg);
  } catch {
    return seg;
  }
}

/**
 * 路径 → 人话。
 *
 * 原来报表直接显示 `/city/%E6%B7%B1%E5%9C%B3%E5%B8%82`，谁也看不懂；
 * 城市页/区域页/分页/车场页各自翻成中文，车场页再翻成车场名（code 本身没意义）。
 */
export function pageLabel(path: string, parkNames: Map<string, string>): string {
  const parts = path.split("/").filter(Boolean);
  if (!parts.length) return "首页";
  if (parts[0] === "city") {
    const city = decodeSeg(parts[1] ?? "");
    const rest = parts.slice(2);
    if (rest[0] === "page" && rest[1]) return `城市页 · ${city} · 第 ${rest[1]} 页`;
    if (rest[0]) return `区域页 · ${city} / ${decodeSeg(rest[0])}`;
    return `城市页 · ${city}`;
  }
  if (parts[0] === "park") {
    const code = decodeSeg(parts[1] ?? "");
    const name = parkNames.get(code);
    return name ? `车场页 · ${name}` : `车场页 · ${code}`;
  }
  if (parts[0] === "admin") {
    const sub = parts.slice(1).join("/");
    return sub ? `后台 · ${decodeSeg(sub)}` : "后台";
  }
  if (parts[0] === "offline") return "离线页";
  return decodeSeg(path);
}

/** 从 /park/{code} 里取车场编码 */
function parkCodeOf(path: string): string {
  const match = /^\/park\/([^/]+)/.exec(path);
  return match ? decodeSeg(match[1]) : "";
}

export interface DailyTraffic {
  day: string;
  pv: number;
  uv: number;
  api: number;
  events: number;
  blocked: number;
  parkPv: number;
  sheet: number;
  save: number;
  search: number;
}

export interface UaStat {
  cls: string;
  hits: number;
  uv: number;
}

export interface PageStat {
  /** 原始路径（含 URL 编码），排查时看这个 */
  path: string;
  /** 给人看的名字：城市页 · 深圳市 / 车场页 · 深圳湾科技生态园 */
  label: string;
  pv: number;
  uv: number;
  blocked: number;
  /** 命中 404 的次数（多半是爬虫在猜路径，或车场已下架） */
  missing: number;
}

export interface SourceStat {
  ipHash: string;
  /** 原始 IP（2026-11-12 起记录；更早的历史数据是空的，只能退回网段） */
  ip: string;
  prefix: string;
  uaClass: string;
  hits: number;
  firstTs: number;
  lastTs: number;
  direct: number;
  sample: string;
}

export interface TrafficReport {
  days: number;
  since: number;
  /** 服务端的「今天」（北京时间），前端别自己算 Date.now()，构建期会被判成不稳定值 */
  today: string;
  daily: DailyTraffic[];
  ua: UaStat[];
  pages: PageStat[];
  sources: SourceStat[];
  queries: { q: string; n: number }[];
  /** 全站未经过 CDN 的请求数 / 总请求数 */
  directHits: number;
  totalHits: number;
}

export async function trafficReport(days = 7): Promise<TrafficReport> {
  await ensureSchema();
  const since = Date.now() - days * 24 * 60 * 60 * 1000;

  const [dailyRes, uvRes, uaRes, pageRes, sourceRes, queryRes, directRes] = await Promise.all([
    db.execute({
      sql: `SELECT day,
                   SUM(kind = 'page') AS pv,
                   SUM(kind = 'api') AS api,
                   SUM(kind = 'event') AS events,
                   SUM(status = 403) AS blocked,
                   SUM(kind = 'page' AND path LIKE '/park/%') AS park_pv,
                   SUM(kind = 'event' AND name = 'sheet_open') AS sheet,
                   SUM(kind = 'event' AND name = 'qr_save') AS save,
                   SUM(kind = 'event' AND name = 'search') AS search
            FROM visit_logs WHERE ts >= ? GROUP BY day ORDER BY day`,
      args: [since],
    }),
    db.execute({
      sql: `SELECT day, COUNT(DISTINCT ip_hash) AS uv
            FROM visit_logs WHERE ts >= ? AND kind = 'page' GROUP BY day`,
      args: [since],
    }),
    db.execute({
      sql: `SELECT ua_class AS cls, COUNT(*) AS hits, COUNT(DISTINCT ip_hash) AS uv
            FROM visit_logs WHERE ts >= ? AND kind <> 'event'
            GROUP BY ua_class ORDER BY hits DESC`,
      args: [since],
    }),
    db.execute({
      sql: `SELECT path, COUNT(*) AS pv, COUNT(DISTINCT ip_hash) AS uv,
                   SUM(status = 403) AS blocked, SUM(status = 404) AS missing
            FROM visit_logs WHERE ts >= ? AND kind = 'page'
            GROUP BY path ORDER BY pv DESC LIMIT 25`,
      args: [since],
    }),
    db.execute({
      sql: `SELECT ip_hash, MAX(ip) AS ip, ip_prefix, ua_class, COUNT(*) AS hits,
                   MIN(ts) AS first_ts, MAX(ts) AS last_ts,
                   SUM(via_cdn = 0) AS direct, MAX(ua) AS sample
            FROM visit_logs WHERE ts >= ? AND kind <> 'event'
            GROUP BY ip_hash ORDER BY hits DESC LIMIT 25`,
      args: [since],
    }),
    // 搜索词榜只数前端埋点（真人主动搜），口径与 daily 里的 search 列一致。
    // 以前不区分 kind，同一个词会被记两遍（proxy 的 /api/search + 前端 beacon），
    // 报表里每个词都翻倍。多取一些再在 JS 里滤噪声，过滤后仍能凑够 25 条。
    db.execute({
      sql: `SELECT q, COUNT(*) AS n FROM visit_logs
            WHERE ts >= ? AND kind = 'event' AND name = 'search' AND trim(q) <> ''
            GROUP BY q ORDER BY n DESC LIMIT 100`,
      args: [since],
    }),
    db.execute({
      sql: `SELECT SUM(via_cdn = 0) AS direct, COUNT(*) AS total FROM visit_logs WHERE ts >= ?`,
      args: [since],
    }),
  ]);

  // 车场页 URL 里只有 park_code，翻成车场名报表才有意义（一次 IN 查询，最多 25 个）
  const parkCodes = Array.from(
    new Set(pageRes.rows.map((row) => parkCodeOf(str(row.path))).filter(Boolean)),
  );
  const parkNames = new Map<string, string>();
  if (parkCodes.length) {
    const nameRes = await db.execute({
      sql: `SELECT park_code, name FROM car_parks
            WHERE park_code IN (${parkCodes.map(() => "?").join(",")})`,
      args: parkCodes,
    });
    for (const row of nameRes.rows) parkNames.set(str(row.park_code), str(row.name));
  }

  const uvByDay = new Map(uvRes.rows.map((row) => [str(row.day), num(row.uv)]));

  return {
    days,
    since,
    today: dayKey(),
    daily: dailyRes.rows.map((row) => ({
      day: str(row.day),
      pv: num(row.pv),
      uv: uvByDay.get(str(row.day)) ?? 0,
      api: num(row.api),
      events: num(row.events),
      blocked: num(row.blocked),
      parkPv: num(row.park_pv),
      sheet: num(row.sheet),
      save: num(row.save),
      search: num(row.search),
    })),
    ua: uaRes.rows.map((row) => ({
      cls: str(row.cls),
      hits: num(row.hits),
      uv: num(row.uv),
    })),
    pages: pageRes.rows.map((row) => {
      const path = str(row.path);
      const missing = num(row.missing);
      const label = pageLabel(path, parkNames);
      return {
        path,
        // 404 的路径几乎都是爬虫在猜（/park/nope123），标出来免得当成真实页面
        label: missing > 0 ? `${label}（不存在）` : label,
        pv: num(row.pv),
        uv: num(row.uv),
        blocked: num(row.blocked),
        missing,
      };
    }),
    sources: sourceRes.rows.map((row) => ({
      ipHash: str(row.ip_hash),
      ip: str(row.ip),
      prefix: str(row.ip_prefix),
      uaClass: str(row.ua_class),
      hits: num(row.hits),
      firstTs: num(row.first_ts),
      lastTs: num(row.last_ts),
      direct: num(row.direct),
      sample: str(row.sample).slice(0, 60),
    })),
    queries: queryRes.rows
      .map((row) => ({ q: str(row.q), n: num(row.n) }))
      .filter((row) => !isNoiseQuery(row.q))
      .slice(0, 25),
    directHits: num(directRes.rows[0]?.direct),
    totalHits: num(directRes.rows[0]?.total),
  };
}

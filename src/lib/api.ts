/**
 * 公开接口的公共外壳：CORS + 限流 + 统一 JSON 结构。
 *
 * 这几个接口不只给主站用，小红书小工具和 B 站 Toy 也会读，所以：
 *   - 路径和返回结构视为契约（对外统一走 /api/v1/*，见 next.config 的 rewrites）；
 *   - 跨域只放白名单（ALLOWED_ORIGINS，逗号分隔，可写 * 放开）；
 *   - 按 IP 限流，进程内计数即可——单机单容器，没必要上 Redis。
 */

/** 单个 IP 每分钟的默认配额 */
const DEFAULT_LIMIT = 120;
const WINDOW_MS = 60_000;
/** 表太大就直接清空，防止被刷爆内存 */
const MAX_BUCKETS = 5000;

const buckets = new Map<string, { count: number; resetAt: number }>();

export interface ApiInit {
  status?: number;
  /** 每分钟每 IP 配额，false 表示不限流（写接口不经过这里） */
  limit?: number | false;
  headers?: Record<string, string>;
  /** 跟 data 平级的额外字段，比如列表接口的 total/page/pageSize */
  meta?: Record<string, unknown>;
}

function allowedOrigins(): string[] {
  return (process.env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  const list = allowedOrigins();
  const allow = origin && (list.includes("*") || list.includes(origin)) ? origin : "";
  // 不管放不放行都带 Vary，避免 CDN 把带不同 Origin 的响应串味
  const headers: Record<string, string> = { Vary: "Origin" };
  if (!allow) return headers;
  headers["Access-Control-Allow-Origin"] = allow;
  headers["Access-Control-Allow-Methods"] = "GET,OPTIONS";
  headers["Access-Control-Allow-Headers"] = "Content-Type";
  headers["Access-Control-Max-Age"] = "600";
  return headers;
}

/** 预检请求：公开路由里 OPTIONS 直接回 204 */
export function preflight(req: Request): Response {
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}

/**
 * 客户端 IP（限流分桶键）。
 *
 * 优先 EdgeOne 的 EO-Connecting-IP：它由边缘节点写入并覆盖客户端自带的同名头，
 * 是链路上唯一「访客改不了」的字段。旧的 XFF-first 写法有两个坑：
 *   - 源站 80 端口公网直达，脚本直连时自己编一个 X-Forwarded-For 就能换桶绕限流；
 *   - 走 CDN 时 XFF 可能被中间层追加，取到的未必是访客而是边缘地址。
 */
export function clientIp(req: Request): string {
  const direct =
    req.headers.get("eo-connecting-ip") ??
    req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-real-ip");
  const ip = direct?.trim();
  if (ip) return ip;

  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return "unknown";
}

function take(scope: string, req: Request, limit: number): boolean {
  const now = Date.now();
  if (buckets.size > MAX_BUCKETS) buckets.clear();
  const key = `${scope}:${clientIp(req)}`;
  const hit = buckets.get(key);
  if (!hit || hit.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (hit.count >= limit) return false;
  hit.count += 1;
  return true;
}

/**
 * 统一的 JSON 出口。
 * @param scope 限流分组的名字（一般就是路由名），不同接口各算各的配额
 */
export function apiJson(
  scope: string,
  req: Request,
  data: unknown,
  init: ApiInit = {},
): Response {
  const headers: Record<string, string> = { ...corsHeaders(req), ...init.headers };
  const limit = init.limit ?? DEFAULT_LIMIT;

  if (limit !== false && !take(scope, req, limit)) {
    return Response.json(
      { ok: false, error: "请求太频繁，稍后再试" },
      { status: 429, headers: { ...headers, "Retry-After": "60" } },
    );
  }

  return Response.json(
    { ok: true, data, ...(init.meta ?? {}) },
    { status: init.status ?? 200, headers },
  );
}

export function apiError(
  scope: string,
  req: Request,
  message: string,
  status = 400,
  init: ApiInit = {},
): Response {
  return Response.json(
    { ok: false, error: message },
    { status, headers: { ...corsHeaders(req), ...init.headers } },
  );
}

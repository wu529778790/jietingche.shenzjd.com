/**
 * UA 判定收口：防采集拦截（proxy）与访问日志分类（visit_log）共用一套规则。
 *
 * 边界很窄——只认「明确是采集器 / 裸脚本库」的 UA，不做行为推测：
 * 搜索引擎、社交预览、浏览器永远放行；被拦的是 ahrefs/semrush 这类 SEO 工具和
 * python-requests/scrapy/puppeteer 这类零成本脚本。
 *
 * 刻意不拦 curl/wget 与空 UA：
 *   - 发版脚本的健康检查就是从宿主机 curl 127.0.0.1 打进来的，拦了 deploy.yml 直接失败；
 *   - 空 UA 可能是 CDN 的回源/预热探测，拦错会被判成源站不可用。
 * 这两类量级交给 api.ts 的 IP 频控。
 */

/** 搜索引擎与社交预览：命中即放行，不参与任何拦截 */
export const ALLOW_UA =
  /googlebot|bingbot|baiduspider|sogou|360spider|yisouspider|bytespider|petalbot|applebot|duckduckbot|yandex|facebookexternalhit|twitterbot|telegrambot|slackbot|discordbot/i;

/** 采集工具与裸脚本库：来就是抄数据 */
const DEFAULT_BLOCK_UA =
  /ahrefsbot|semrushbot|mj12bot|dotbot|blexbot|dataforseo|serpstatbot|zoominfobot|screaming ?frog|sitebulb|netpeak|megaindex|rogerbot|exabot|python-requests|python-urllib|scrapy|aiohttp|httpx|okhttp|go-http-client|libwww-perl|apache-httpclient|node-fetch|undici|phantomjs|headlesschrome|puppeteer|playwright|selenium|postmanruntime|insomnia/i;

/** 其它爬虫（头条/神马/各种小蜘蛛）：不拦，但日志里单独标一类 */
const OTHER_BOT_UA = /bot\b|crawler|spider|slurp|archiver|fetcher|scanner|monitor|uptime/i;

let matcher: RegExp | null = null;

/** 采集器正则：内置规则 + BLOCK_UA_EXTRA（逗号分隔的正则片段，热修用） */
export function blockMatcher(): RegExp {
  if (matcher) return matcher;
  const extra = (process.env.BLOCK_UA_EXTRA ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  matcher = extra.length
    ? new RegExp(`${DEFAULT_BLOCK_UA.source}|${extra.join("|")}`, "i")
    : DEFAULT_BLOCK_UA;
  return matcher;
}

/** BOT_BLOCK=off 一键关掉拦截（日志照记，方便先观察再收紧） */
export function isBotBlocked(ua: string): boolean {
  if (process.env.BOT_BLOCK === "off") return false;
  if (ALLOW_UA.test(ua)) return false;
  if (!ua.trim()) return false;
  return blockMatcher().test(ua);
}

export type UaClass = "wechat" | "searchbot" | "scraper" | "bot" | "browser" | "unknown";

/** 访问日志用的粗分类，只为看出「人 vs 机器」的构成 */
export function classifyUa(ua: string): UaClass {
  if (!ua.trim()) return "unknown";
  if (ALLOW_UA.test(ua)) return "searchbot";
  if (blockMatcher().test(ua)) return "scraper";
  if (/micromessenger/i.test(ua)) return "wechat";
  if (OTHER_BOT_UA.test(ua)) return "bot";
  if (/mozilla|chrome|safari|firefox|edg\//i.test(ua)) return "browser";
  return "unknown";
}

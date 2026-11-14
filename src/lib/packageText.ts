/**
 * 套餐文案与价格口径的纯函数。
 *
 * 官方选品池的套餐名很脏，形如：
 *   金銮国际商务大厦停车场（<禁停一期地库>夜间套餐1月）
 *   豪威科技大厦停车场（<居住推荐>夜间套餐_1月）
 *   星河cocopark停车场（<居住推荐>夜间套餐1月）
 *   德汇嘉里广场大朗店夜间套餐（1夜）
 * 尖括号里是官方推荐标签（已另存到车场 audience），下划线是拼接残留，
 * 这些都不该出现在访客界面和 SEO 标题里。
 *
 * 这里只放纯函数，脚本、服务端组件、客户端组件都能 import。
 */

const TAG_RE = /[<＜][^>＞]{1,24}[>＞]/g;
const PARK_SUFFIX_RE = /(停车场|停车库|车库|车场)$/;
/** 末尾括号里的纯时长，如「（1夜）」「（1个月）」——这种括号是时长，不是套餐主体 */
const DURATION_ONLY_RE = /^[\d一二三四五六七八九十半]+\s*个?\s*(月|夜|天|日|小时)$/;
/** 套餐名尾部的时长后缀，如「夜间套餐1月」→「夜间套餐」（时长另有 duration_label 展示） */
const TRAILING_DURATION_RE = /\s*\d+\s*个?\s*(月|夜|天|日)$/;

function basicClean(input: string): string {
  return String(input ?? "")
    .replace(TAG_RE, "")
    .replace(/[（(]\s*[）)]/g, "")
    .replace(/[_＿]+/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/^[··\-—、,，\s]+/, "")
    .trim();
}

/** 「星河COCOPark」和「星河cocopark」要能对上：只比字母数字和汉字，忽略大小写与空白 */
function normKey(input: string): string {
  return String(input ?? "").toLowerCase().replace(/[\s\-_·]/g, "");
}

function stripParkPrefix(name: string, parkName: string): string {
  const prefix = String(parkName ?? "").trim();
  if (!prefix) return name;
  const variants = [prefix, prefix.replace(PARK_SUFFIX_RE, "")].filter(Boolean);
  for (const variant of variants) {
    if (name.length < variant.length) continue;
    // 前缀比对忽略大小写与空白，但裁剪按字符数走原串，保留后半段原样
    if (normKey(name.slice(0, variant.length)) !== normKey(variant)) continue;
    const rest = name.slice(variant.length).trim();
    if (rest) return rest;
  }
  return name;
}

/**
 * 官方套餐名 → 用户可见名。
 * 优先取末尾括号里的套餐主体（官方几乎都用「车场名（套餐主体）」的格式），
 * 括号里只是时长时退回括号前的内容；都没有才去车场名前缀。
 * 幂等：清洗过的名字再跑一次结果不变。
 */
export function cleanPackageName(raw: string, parkName = ""): string {
  const original = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (!original) return "";

  let name = basicClean(original);

  const tail = /^(.*?)[（(]([^（）()]*)[）)]\s*$/.exec(name);
  if (tail) {
    const inner = basicClean(tail[2]);
    const before = basicClean(tail[1]);
    if (inner && !DURATION_ONLY_RE.test(inner)) {
      name = inner;
    } else if (before) {
      name = before;
    }
  }

  name = stripParkPrefix(name, parkName);
  // 裁完前缀可能又剩一层括号
  const wrapped = /^[（(](.+)[）)]$/.exec(name);
  if (wrapped) name = basicClean(wrapped[1]);
  name = name.replace(TRAILING_DURATION_RE, "").trim();

  return name || basicClean(original) || original;
}

/**
 * 规则摘要里会叠出「工作日 工作日 18:30-08:30 / 周末 周末 00:00-23:59」，
 * 把每段开头的重复词压成一个。
 */
export function cleanRuleSummary(summary: string): string {
  return String(summary ?? "")
    .split("/")
    .map((part) => {
      const words = part.trim().split(/\s+/).filter(Boolean);
      if (words.length < 3) return words.join(" ");
      let i = 1;
      while (i < words.length && words[i] === words[0]) i += 1;
      return [words[0], ...words.slice(i)].join(" ");
    })
    .filter(Boolean)
    .map((part) =>
      part
        .replace(/^每天 00:00-23:59$/, "全天可停")
        .replace(/^(工作日|周末|节假日) 00:00-23:59$/, "$1全天"),
    )
    .join(" / ");
}

/** 兼容旧调用名：前端组件一直用 tidyRuleSummary */
export const tidyRuleSummary = cleanRuleSummary;

/**
 * 官方套餐名自带车场前缀时裁掉；车场名已经单独展示了。
 * 与 cleanPackageName 的区别：这里只做展示兜底，不改库。
 */
export function shortPackageName(parkName: string, packageName: string): string {
  if (!parkName || !packageName || !packageName.startsWith(parkName)) return packageName;
  const rest = packageName.slice(parkName.length).trim();
  const wrapped = rest.match(/^[（(](.+)[）)]$/);
  if (wrapped) return wrapped[1].trim();
  return rest.replace(/^[·\-—、,，\s]+/, "").trim() || packageName;
}

/** 折合每月价格（分）。日卡/次卡按各自有效天数折算，用于跨卡种比价。 */
export function monthlyPrice(price: number, durationDays: number): number {
  const days = durationDays > 0 ? durationDays : 30;
  return Math.round((price * 30) / days);
}

/** 长租卡：够一个月及以上，排序时优先于日卡/次卡 */
export const LONG_TERM_DAYS = 25;

/**
 * 真正的长租卡种。次卡也会带 duration_days=30（表示 30 天有效期，如「30 天 5 次」），
 * 只看天数会把 5 次卡当成月卡，按折合月价顶到真月卡前面。
 */
export const LONG_TERM_TYPES = ["月卡", "季卡", "半年卡", "年卡"] as const;

export function isLongTerm(typeLabel: string, durationDays: number): boolean {
  return (
    (durationDays || 0) >= LONG_TERM_DAYS &&
    (LONG_TERM_TYPES as readonly string[]).includes(typeLabel)
  );
}

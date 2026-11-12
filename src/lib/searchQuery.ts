/**
 * 搜索词预处理：把「人话」拆成能命中车场的查询计划。
 *
 * 现状是整串 LIKE，三类真实输入全都接不住：
 *   1. 带位置限定 —— 「深圳合一社区」整串 LIKE 命中 0，剥掉城市后命中 1；
 *   2. 带意图词   —— 「科技园停车场」「附近的停车场」，多出来的词把命中拉成 0；
 *   3. 多词并列   —— 「科技园 地铁」，整串 LIKE 不可能命中，拆开各命中一列才有结果。
 *
 * 设计上有一条硬约束：**降级只在原词 0 命中时才用**。
 * 剥城市、猜区县这些「可能猜错」的动作因此永远不会破坏一条本来能命中的查询
 * （例如「深圳湾科技园」不会被剥成「湾科技园」—— 它主查询有结果，走不到降级）。
 */

/** 混在搜索词里的「意图词」：既不是地名也不是车场名，剥掉命中率更高 */
const NOISE_WORDS = [
  "停车月卡",
  "停车场月卡",
  "停车场",
  "停车",
  "包月",
  "月租",
  "月卡",
  "附近的",
  "周边",
  "附近",
].sort((a, b) => b.length - a.length);

const SEPARATORS = /[\s,，、;；/|+·]+/;
/** 一个词至少两个字才有检索意义（「的」「区」这种单字只会放大噪声） */
const MIN_TERM_LEN = 2;
/** 降级候选最多试几个：每多试一个就多扫一遍表，3 个已经覆盖绝大多数写法 */
const MAX_FALLBACKS = 3;

/** 位置词典：由调用方从库里取（城市/区县全名），这里只做纯字符串处理 */
export interface PlaceDict {
  cities: string[];
  districts: string[];
}

/** 一个可执行的查询变体：keyword 用来展示，terms 用来到 SQL 里拼条件 */
export interface QueryVariant {
  keyword: string;
  terms: string[];
}

export interface QueryPlan {
  primary: QueryVariant | null;
  /** 主查询 0 命中时依次尝试的写法 */
  fallbacks: QueryVariant[];
}

/**
 * 剥掉首尾的意图词。
 * 长度保护是必要的：「停车场」整串输入时不能剥成空串。
 */
function stripNoise(input: string): string {
  let text = input.trim();
  let changed = true;
  while (changed && text) {
    changed = false;
    for (const word of NOISE_WORDS) {
      if (text.length <= word.length + 1) continue;
      if (text.startsWith(word)) {
        text = text.slice(word.length).trim();
        changed = true;
      } else if (text.endsWith(word)) {
        text = text.slice(0, -word.length).trim();
        changed = true;
      }
    }
  }
  return text;
}

/** 按空格/标点切词；中文不做分词（切错了比不切更糟） */
function splitTerms(text: string): string[] {
  const parts = text
    .split(SEPARATORS)
    .map((part) => part.trim())
    .filter(Boolean);
  const strong = parts.filter((part) => part.length >= MIN_TERM_LEN);
  return (strong.length ? strong : parts).slice(0, 4);
}

function variantOf(keyword: string): QueryVariant {
  return { keyword, terms: splitTerms(keyword) };
}

/** 城市/区的别名：全名 + 去掉行政后缀的短名（「深圳市」和「深圳」都算） */
function aliasesOf(names: string[]): string[] {
  const out = new Set<string>();
  for (const name of names) {
    const full = name.trim();
    if (full.length < 2) continue;
    out.add(full);
    const short = full.replace(/(?:特别行政区|自治区|自治州|地区|市|省|区|县)$/, "");
    if (short.length >= 2) out.add(short);
  }
  // 长的先匹配：「深圳市」优先于「深圳」，否则会把「深圳市」剥成「市…」
  return [...out].sort((a, b) => b.length - a.length);
}

function stripLeading(text: string, aliases: string[]): string | null {
  for (const alias of aliases) {
    if (!text.startsWith(alias)) continue;
    const rest = text.slice(alias.length).trim();
    // 剩下的部分至少要能检索：剥成「湾」「1」这种就是拆错了
    if (rest.length >= MIN_TERM_LEN) return rest;
  }
  return null;
}

/**
 * 生成查询计划。
 * @param raw 用户原样输入（路由层已截断长度）
 * @param dict 位置词典，空对象表示没有词典（只在纯离线场景）
 */
export function buildQueryPlan(raw: string, dict: PlaceDict): QueryPlan {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { primary: null, fallbacks: [] };

  const cleaned = stripNoise(trimmed) || trimmed;
  const primary = variantOf(cleaned);
  if (!primary.terms.length) return { primary: null, fallbacks: [] };

  const cityAliases = aliasesOf(dict.cities);
  const districtAliases = aliasesOf(dict.districts);

  const candidates: string[] = [];
  const push = (value: string | null) => {
    if (!value) return;
    const next = value.trim();
    if (next.length < MIN_TERM_LEN) return;
    if (next === primary.keyword) return;
    if (candidates.includes(next)) return;
    candidates.push(next);
  };

  // 多词时先降级成「只搜第一个词」：「科技园 地铁」拆开后第一个词通常才是地名
  if (primary.terms.length > 1) push(primary.terms[0]);

  const base = primary.terms[0] ?? primary.keyword;
  // 省/市 → 区，一层层往里剥；每剥一层都把结果作为候选
  const noCity = stripLeading(base, cityAliases);
  if (noCity) {
    push(noCity);
    push(stripLeading(noCity, districtAliases));
  } else {
    push(stripLeading(base, districtAliases));
  }

  return {
    primary,
    fallbacks: candidates.slice(0, MAX_FALLBACKS).map(variantOf),
  };
}

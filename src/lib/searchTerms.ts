/**
 * 搜索联想词表：把车场库里的「地名碎片」抽出来，做成输入候选。
 *
 * 解决的问题：用户脑子里是「海岸城」「壹方城」，而库里只有楼宇名、小区名、路名。
 * 光改 placeholder 只是让他别搜错，联想是让他**搜得对**——敲两个字就能看到
 * 库里真实存在的叫法，点一下直接出结果，不用猜。
 *
 * 词从哪来（按可信度从高到低）：
 *   1. 车场名去掉「停车场/车库」和括号注释（天健科技大厦停车场 → 天健科技大厦）
 *   2. keywords 里空格分隔的词（源数据就是「楼宇名 区 地址 备注」这种拼法）
 *   3. 地址里的道路名（深南大道1006号 → 深南大道）
 *   4. 区名、城市名（现在它们也是搜索字段，能直接搜）
 *
 * 权重 = 有多少个车场含这个词。它同时是「这个词值不值得推荐」的判据：
 * 只出现在一个车场名里的碎片没必要占候选位。
 */

/** 这些词出现在 keywords 里但没有任何检索价值（官方备注字段带出来的） */
const NOISE_TERMS = new Set([
  "停车场",
  "停车",
  "车位",
  "车库",
  "地库",
  "地下",
  "地面",
  "月卡",
  "季卡",
  "年卡",
  "套餐",
  "夜间",
  "白天",
  "全天",
  "临时",
  "暂停",
  "测试",
  "未知",
  "不常开",
  "不开放",
  "物业管理",
  "管理处",
]);

/**
 * 片区词：库里只有「精锭科技园」这种具体楼宇，没有「科技园」这个片区名，
 * 而用户敲的恰恰是片区名。把这几个通用后缀在构建索引时额外记一笔，
 * 「科技园 · 132 个车场」才有可能出现在候选里。
 *
 * 刻意只收三字以上、指向明确的词：广场 / 大厦 / 中心 这类太泛，
 * 单拎出来权重几百却没有任何筛选意义，放进候选只会占位。
 */
const AREA_WORDS = [
  "科技园",
  "工业区",
  "产业园",
  "软件园",
  "创业园",
  "工业园",
  "科技城",
  "科学城",
  "商务区",
  "高新区",
  "保税区",
  "开发区",
  "物流园",
  "大学城",
  "批发市场",
  "建材市场",
  "农贸市场",
  "火车站",
  "汽车站",
  "地铁站",
  "体育馆",
  "会展中心",
];

/** 词长上限：再长就成一整句地址，用户不会这么敲 */
const MAX_TERM_LEN = 14;
const MIN_TERM_LEN = 2;

export interface TermRow {
  name: string;
  keywords: string;
  address: string;
  district: string;
  city: string;
}

export interface TermHit {
  term: string;
  /** 库里有几个车场含这个词 */
  weight: number;
}

/** 括号里的都是补充说明（`（内有充电桩）`、`<禁停一期地库>`），不参与联想 */
function stripBrackets(text: string): string {
  return text.replace(/[（(<【][^）)>】]*[）)>】]/g, " ");
}

/** 车场名去掉通用后缀就是用户真正会说的那个地名 */
function tidyName(name: string): string {
  return stripBrackets(name)
    .replace(/(停车场|停车库|地下车库|车库)$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function splitKeywords(text: string): string[] {
  return stripBrackets(text)
    .split(/[\s,，、;；/|·]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** 地址里的道路名：「深南大道1006号」→「深南大道」 */
function roadsOf(address: string): string[] {
  const text = stripBrackets(address);
  const matched = text.match(/[\u4e00-\u9fa5A-Za-z0-9]{2,10}(?:大道|大街|路|街|巷)/g);
  return matched ?? [];
}

function isTermOk(term: string): boolean {
  if (term.length < MIN_TERM_LEN || term.length > MAX_TERM_LEN) return false;
  if (NOISE_TERMS.has(term)) return false;
  // 纯数字/标点（门牌号、楼层）不是地名
  if (/^[\d\s.,，、\-—_/\\#]+$/.test(term)) return false;
  // 「深南大道1006号」这种门牌不是用户会敲的词
  if (/\d+\s*号/.test(term)) return false;
  // 「深南东路4002」：地址里被截断的门牌尾巴
  if (/\d{2,}$/.test(term)) return false;
  // 「道深南大道辅路」：地址正则从中间截出来的残片
  if (/^(?:道|路|街|巷|号)/.test(term)) return false;
  // 「科技北一街与科技东路」：地址正则把两条路连成一条的产物
  if (/[与、]/.test(term)) return false;
  // 「福田区深南大道」「东省深圳市福田区深南大道」：keywords 里整段地址被当成了一个词
  if (/(?:省|市|区|县|镇|街道).*(?:路|街|大道|巷)/.test(term)) return false;
  // 至少两个字是可读字符，挡掉「A」「1栋」这类
  const readable = term.match(/[\u4e00-\u9fa5A-Za-z]/g)?.length ?? 0;
  return readable >= MIN_TERM_LEN;
}

/** 一行车场里能当搜索词的所有写法（同一行内去重，避免自己给自己刷权重） */
function termsOfRow(row: TermRow): Set<string> {
  const terms = new Set<string>();
  const name = tidyName(row.name);
  if (name) terms.add(name);
  // keywords 里常带着完整车场名（含「停车场」），统一过一遍 tidy，和 name 归并成同一个词
  for (const token of splitKeywords(row.keywords)) terms.add(tidyName(token));
  for (const road of roadsOf(row.address)) terms.add(road);
  if (row.district) terms.add(row.district);
  if (row.city) terms.add(row.city);

  // 片区词：从「精锭科技园」里拆出「科技园」，让用户能按片区名搜
  for (const term of [...terms]) {
    for (const area of AREA_WORDS) {
      if (term.length > area.length && term.endsWith(area)) terms.add(area);
    }
  }
  return terms;
}

/** term → 含它的车场数 */
export function buildTermIndex(rows: TermRow[]): Map<string, number> {
  const index = new Map<string, number>();
  for (const row of rows) {
    for (const term of termsOfRow(row)) {
      if (!isTermOk(term)) continue;
      index.set(term, (index.get(term) ?? 0) + 1);
    }
  }
  return index;
}

/**
 * 值不值得去查候选。
 * 单个汉字就是有效输入（「侨」→ 侨城坊），单个拉丁字母是拼音输入法的中间态，不查。
 */
export function canSuggest(raw: string): boolean {
  const q = (raw ?? "").trim();
  if (!q) return false;
  return q.length >= MIN_TERM_LEN || /[\u4e00-\u9fa5]/.test(q);
}

/**
 * 输入联想：先给「以输入开头」的，再给「中间包含」的，同档按车场数从多到少。
 * 前缀优先是必须的——敲「侨」时「侨城坊」比「华侨城」更接近他想要的。
 */
export function suggestTerms(index: Map<string, number>, raw: string, limit = 6): TermHit[] {
  const q = (raw ?? "").trim().toLowerCase();
  if (!canSuggest(q)) return [];

  const hits: { term: string; weight: number; prefix: number }[] = [];
  for (const [term, weight] of index) {
    const lower = term.toLowerCase();
    // 已经一字不差地打出来了，不用再荐一次占地方
    if (lower === q) continue;
    if (!lower.includes(q)) continue;
    hits.push({ term, weight, prefix: lower.startsWith(q) ? 1 : 0 });
  }

  hits.sort(
    (a, b) => b.prefix - a.prefix || b.weight - a.weight || a.term.localeCompare(b.term, "zh"),
  );
  return hits.slice(0, limit).map(({ term, weight }) => ({ term, weight }));
}

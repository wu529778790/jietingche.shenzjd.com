/**
 * 区县名归一。
 *
 * 官方数据同一个区县有两套写法：带市名的（「上海市嘉定区」）和不带的（「嘉定区」），
 * 两套各自成页就是两个 URL、两个 canonical——实测 57 组，其中「上海市浦东新区」
 * 150 个车场、「浦东新区」另一套，权重被劈成两半。Google 对这类页面给的判定是
 * 「Google 无法识别此网址」（抽样 26 条里有 4 条），纯粹在消耗抓取预算。
 *
 * 另外「中国」「市辖区」这类是把上级行政区当成了区县，属于采集脏值。
 *
 * 归一放在这里而不是各处 SQL：入库、路由、sitemap、内链都是同一份判断，
 * 少一处就会出现「列表显示两个、页面只认一个」的劈叉。
 */

/** 把上级行政区当区县用的占位串，一律视为「没有区县」 */
const PLACEHOLDERS = new Set(["中国", "市辖区", "辖区", "县", "-", "无", "其他"]);

function squeeze(value: string): string {
  return (value ?? "").replace(/\s+/g, "").trim();
}

/**
 * @param city 车场所在市（「深圳市」；少数数据可能不带「市」）
 * @param raw  原始区县串
 * @returns    规范区县名；返回空串表示这条数据没有可用的区县（应归到城市页）
 */
export function normalizeDistrict(city: string, raw: string): string {
  let name = squeeze(raw);
  const cityName = squeeze(city);
  if (!name || PLACEHOLDERS.has(name)) return "";

  // 城市自己就有两种写法（「深圳」/「深圳市」），长的先试，避免削出「市南山区」
  const forms = cityName ? (cityName.endsWith("市") ? [cityName] : [`${cityName}市`, cityName]) : [];
  for (const form of forms) {
    if (name.length > form.length && name.startsWith(form)) {
      name = name.slice(form.length);
      break;
    }
  }

  // 削完只剩市名本身，或者削成了占位串，都按「没有区县」处理
  if (!name || PLACEHOLDERS.has(name) || (cityName && name === cityName)) return "";
  return name;
}

/** 是否是一个需要重定向的旧写法（带重复市名前缀） */
export function isDistrictAlias(city: string, raw: string): boolean {
  const canonical = normalizeDistrict(city, raw);
  return Boolean(canonical) && canonical !== squeeze(raw);
}

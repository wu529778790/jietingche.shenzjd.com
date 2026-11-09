/**
 * canton（官方返回的行政区划串）→ 省 / 市 / 区县
 *
 * 实际出现过的形态：
 *   广东深圳市宝安区 / 广东省深圳市宝安区
 *   北京市(省)北京市朝阳区 / 上海上海市黄浦区
 *   上海上海城区宝山区 / 上海城区嘉定区 / 北京城区通州区 / 重庆城区江北区
 *   新疆维吾尔乌鲁木齐市沙依巴克区 / 广西壮族自治区南宁市青秀区
 *   伊犁哈萨克自治州伊宁市 / 黔南布依族苗族自治州都匀市
 *   垃圾值：市 / 辖区 / 空
 */

const PROVINCES = [
  "黑龙江", "内蒙古", "新疆维吾尔", "广西壮族", "宁夏回族", "广西", "宁夏", "新疆", "西藏",
  "香港", "澳门", "北京", "天津", "上海", "重庆", "河北", "山西", "辽宁", "吉林", "江苏",
  "浙江", "安徽", "福建", "江西", "山东", "河南", "湖北", "湖南", "广东", "海南", "四川",
  "贵州", "云南", "陕西", "甘肃", "青海", "台湾",
];
const MUNICIPALITIES = ["北京", "天津", "上海", "重庆"];
const PROVINCE_ALIAS = { 新疆维吾尔: "新疆", 广西壮族: "广西", 宁夏回族: "宁夏" };
const BARE_PREFECTURE_PROVINCE = {
  伊犁哈萨克自治州: "新疆",
  黔南布依族苗族自治州: "贵州",
  黔东南苗族侗族自治州: "贵州",
  黔西南布依族苗族自治州: "贵州",
  延边朝鲜族自治州: "吉林",
  阿坝藏族羌族自治州: "四川",
  甘孜藏族自治州: "四川",
  凉山彝族自治州: "四川",
  西双版纳傣族自治州: "云南",
};

export function splitCanton(canton) {
  const raw = String(canton || "").replace(/\(省\)/g, "").trim();
  if (!raw || raw === "市" || raw === "辖区") {
    return { province: "", city: "", district: "" };
  }

  const hit = PROVINCES.filter((name) => raw.startsWith(name)).sort((a, b) => b.length - a.length)[0];
  if (!hit) {
    // 少数数据不带省份前缀，只有「XX自治州YY市」
    const bare = raw.match(/^(.*?自治州)(.*)$/);
    if (bare) {
      return {
        province: BARE_PREFECTURE_PROVINCE[bare[1]] || bare[1],
        city: bare[1],
        district: (bare[2] || "").trim(),
      };
    }
    return { province: raw, city: "", district: "" };
  }

  const province = PROVINCE_ALIAS[hit] || (MUNICIPALITIES.includes(hit) ? `${hit}市` : hit);
  let rest = raw.slice(hit.length);

  for (const prefix of ["壮族自治区", "回族自治区", "自治区", "省", "市"]) {
    if (rest.startsWith(prefix)) {
      rest = rest.slice(prefix.length);
      break;
    }
  }
  // 直辖市写法一：XX城区YY区（「城区」前可能是空、省名或市名）
  const cityArea = rest.match(/^.*?城区(.*)$/);
  if (cityArea && MUNICIPALITIES.includes(hit)) {
    return { province, city: province, district: (cityArea[1] || "").trim() };
  }

  // 「市辖区」「辖区」这类占位串
  if (rest.startsWith("市辖区")) rest = rest.slice(3);
  else if (rest.startsWith("辖区")) rest = rest.slice(2);

  // 直辖市剩下的整段就是区县（上海市市辖区浦东新区 → 浦东新区）
  if (MUNICIPALITIES.includes(hit)) {
    return { province, city: province, district: rest };
  }

  if (!rest) return { province, city: "", district: "" };

  // 自治州：州名整体算市一级，剩下的算区县
  const prefecture = rest.match(/^(.*?自治州)(.*)$/);
  if (prefecture) {
    return { province, city: prefecture[1], district: (prefecture[2] || "").trim() };
  }

  const idx = rest.indexOf("市");
  if (idx >= 0) return { province, city: rest.slice(0, idx + 1), district: rest.slice(idx + 1) };

  return { province, city: rest, district: "" };
}

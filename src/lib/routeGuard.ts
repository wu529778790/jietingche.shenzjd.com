/**
 * 落地页路径存在性白名单，只给 proxy 用。
 *
 * 为什么不在页面里 notFound()：`cacheComponents` 下落地页是 PPR，shell 先流出去，
 * 渲染到一半的 notFound() 改不了状态码，线上就变成「200 的 404 页」——
 * 搜索引擎当软 404 处理，等于把一堆空页当正常内容收。在 proxy 里先判掉，
 * 才能给出真正的 404 状态码。
 *
 * 数据整表读进内存（车场 8 千多条 + 城市区 5 百多条，约 200KB），5 分钟重建一次。
 * 单次都是 Set 查找，热路径上没有额外 IO；重建失败一律 fail-open——
 * 宁可放行让页面自己处理，也不能因为一次查询抖动把正常页面全判 404。
 */
import { db, str } from "./db";

const TTL = 5 * 60 * 1000;

interface Snapshot {
  at: number;
  /** park_code 与内部 id 都能造 URL（getParkByCode 两者都认） */
  parks: Set<string>;
  cities: Set<string>;
  /** `${city}|${district}` */
  areas: Set<string>;
}

let snapshot: Snapshot | null = null;
let loading: Promise<Snapshot> | null = null;

/** 库里存的是「深圳市」，但 /city/深圳 也要能进，两种写法都认 */
function candidates(name: string): string[] {
  return name.endsWith("市") ? [name] : [name, `${name}市`];
}

async function build(): Promise<Snapshot> {
  const [parks, areas] = await Promise.all([
    db.execute({ sql: "SELECT id, park_code FROM car_parks" }),
    db.execute({
      sql: "SELECT city, district FROM car_parks WHERE city <> '' GROUP BY city, district",
    }),
  ]);

  const parkCodes = new Set<string>();
  for (const row of parks.rows) {
    const code = str(row.park_code);
    const id = str(row.id);
    if (code) parkCodes.add(code);
    if (id) parkCodes.add(id);
  }

  const cities = new Set<string>();
  const areaKeys = new Set<string>();
  for (const row of areas.rows) {
    const city = str(row.city);
    const district = str(row.district);
    if (!city) continue;
    cities.add(city);
    if (district) areaKeys.add(`${city}|${district}`);
  }

  return { at: Date.now(), parks: parkCodes, cities, areas: areaKeys };
}

async function getSnapshot(): Promise<Snapshot> {
  if (snapshot && Date.now() - snapshot.at < TTL) return snapshot;
  if (!loading) {
    loading = build()
      .then((next) => {
        snapshot = next;
        return next;
      })
      .finally(() => {
        loading = null;
      });
  }
  return loading;
}

export async function isKnownCity(name: string): Promise<boolean> {
  try {
    const snap = await getSnapshot();
    return candidates(name).some((city) => snap.cities.has(city));
  } catch {
    return true;
  }
}

export async function isKnownArea(city: string, district: string): Promise<boolean> {
  try {
    const snap = await getSnapshot();
    return candidates(city).some((item) => snap.areas.has(`${item}|${district}`));
  } catch {
    return true;
  }
}

export async function isKnownPark(code: string): Promise<boolean> {
  try {
    const snap = await getSnapshot();
    return snap.parks.has(code);
  } catch {
    return true;
  }
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * /city/深圳市、/city/深圳市/福田区、/city/深圳市/page/2、/park/p240570581。
 * 分页路径只校验城市——页码越界由页面夹到有效范围，不在这里判 404。
 */
export async function routeExists(pathname: string): Promise<boolean> {
  const segs = pathname.split("/").filter(Boolean).map(safeDecode);
  if (segs[0] === "park") return segs[1] ? isKnownPark(segs[1]) : false;
  if (segs[0] === "city") {
    const city = segs[1];
    if (!city) return false;
    if (segs[2] === "page") return isKnownCity(city);
    if (segs[2]) return isKnownArea(city, segs[2]);
    return isKnownCity(city);
  }
  return true;
}

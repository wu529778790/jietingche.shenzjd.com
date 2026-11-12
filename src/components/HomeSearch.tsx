"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { BrandPin } from "@/components/BrandMark";
import ParkCard from "@/components/ParkCard";
import type { FilterValues } from "@/components/FilterSheet";
import { beacon } from "@/lib/beacon";
import { SORT_OPTIONS, type Package, type ParkWithPackages } from "@/lib/types";

interface FacetItem {
  name: string;
  count: number;
}

interface Facets {
  cities: FacetItem[];
  districts: FacetItem[];
  industries: FacetItem[];
  types: FacetItem[];
  slots: FacetItem[];
}

const PAGE_SIZE = 20;
/**
 * 命中少于这个数就认为「这片区域没覆盖到」，补一段周边。
 *
 * 阈值取 5：一个商圈/小区名正常应该能带出三五个可选车场，
 * 只有一两个说明用户找的具体位置附近我们没收录，列表本身给不出选择。
 */
const NEARBY_TRIGGER_TOTAL = 5;
const EMPTY_FACETS: Facets = { cities: [], districts: [], industries: [], types: [], slots: [] };

/** 「附近还有」这一段的数据：锚点是用户搜到的第一个车场，或者他自己的位置 */
interface NearbyBlock {
  parks: ParkWithPackages[];
  /** 锚点名，标题里要写清「以谁为中心」，否则用户不知道这些距离是从哪儿算的 */
  anchor: string;
  radiusKm: number;
  /** few = 命中太少补周边；none = 一条没命中，用定位兜底 */
  reason: "few" | "none";
}

/**
 * 三个弹层按需加载。
 *
 * 它们都是「点了才渲染」的：位置、筛选、套餐详情。静态导入会白白塞进首屏 bundle——
 * PackageSheet 还牵着 lib/qr（qrcode-generator 整库），可绝大多数人首屏根本不出码。
 * 拆出去以后首屏只留搜索列表，弹层代码在空闲时才预取（见下面的 useEffect）。
 */
const LocationSheet = dynamic(() => import("@/components/LocationSheet"), { ssr: false });
const FilterSheet = dynamic(() => import("@/components/FilterSheet"), { ssr: false });
const PackageSheet = dynamic(() => import("@/components/PackageSheet"), { ssr: false });

/** 定位结果缓存 30 分钟，同一个标签页内反复进来不再弹权限、也不再闪一次“推荐”排序 */
const GEO_CACHE_KEY = "jtc:geo";
const GEO_CACHE_TTL = 30 * 60 * 1000;

type Coords = { lat: number; lng: number };

/**
 * 坐标保留 3 位小数（≈110m 网格）。
 *
 * 只影响「离我多远」的排序精度，但把 /api/search 的 URL 从「每人一个唯一 query」
 * 变成「同片区共用一套 query」——否则 EdgeOne 永远 MISS，每个访客的搜索都要回源。
 */
function roundCoord(value: number): number {
  return Math.round(value * 1000) / 1000;
}
/** 定位结果连同反查到的城市一起缓存，下次进来不用再问一遍 */
type GeoCache = Coords & { city?: string };

function readGeoCache(): GeoCache | null {
  try {
    const raw = sessionStorage.getItem(GEO_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { lat?: unknown; lng?: unknown; at?: unknown; city?: unknown };
    if (typeof parsed.at !== "number" || Date.now() - parsed.at > GEO_CACHE_TTL) return null;
    if (typeof parsed.lat !== "number" || typeof parsed.lng !== "number") return null;
    return {
      lat: parsed.lat,
      lng: parsed.lng,
      city: typeof parsed.city === "string" && parsed.city ? parsed.city : undefined,
    };
  } catch {
    return null;
  }
}

function writeGeoCache(coords: GeoCache): void {
  try {
    sessionStorage.setItem(GEO_CACHE_KEY, JSON.stringify({ ...coords, at: Date.now() }));
  } catch {
    // 隐私模式写不进去就算了
  }
}

export default function HomeSearch() {
  const [keyword, setKeyword] = useState("");
  /**
   * 输入法正在组合（拼音还没上屏）。
   *
   * 中文输入时每敲一个字母都会触发 onChange，值还是半成品（ke / ke'ji / 科…）。
   * 以前这些中间态会各自发一趟搜索、各记一条埋点，报表里全是半成品词。
   * 现在组合期间不请求也不埋点，等候选词上屏（compositionend）再算一次。
   */
  const [imeOpen, setImeOpen] = useState(false);
  const [city, setCity] = useState("");
  const [district, setDistrict] = useState("");
  const [industry, setIndustry] = useState("");
  const [type, setType] = useState("");
  const [slot, setSlot] = useState("");
  const [maxPrice, setMaxPrice] = useState(0);
  const [sort, setSort] = useState<string>("recommend");

  const [coords, setCoords] = useState<Coords | null>(null);
  /**
   * boot = 还没判断（首帧）、locating = 等定位、idle = 有结果、error = 没拿到。
   *
   * 为什么要 boot 这一档：以前首屏先发一趟「没有城市」的请求，用户会看到一堆
   * 外地车场，等定位回来再整个换掉，列表硬跳一下。现在定位没定下来之前只出骨架屏，
   * 一次请求都不发——省一次全国查询，也不会先给错答案。
   */
  const [geoState, setGeoState] = useState<"boot" | "locating" | "idle" | "error">("boot");
  const [geoError, setGeoError] = useState("");
  /** 等待定位期间用户自己动手了（打字/选城市/改筛选），就不再等，立刻出结果 */
  const geoAborted = useRef(false);

  const [facets, setFacets] = useState<Facets>(EMPTY_FACETS);
  /** 切城市后区域还在拉取：位置弹层用骨架屏占位，别让区域块突然空一块 */
  const [districtsLoading, setDistrictsLoading] = useState(false);
  /** 分佣码：弹层里现场生成套餐直达码用 */
  const [shareCode, setShareCode] = useState("");

  const [parks, setParks] = useState<ParkWithPackages[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  /** 自动加载下一页失败时停住，改成手动重试，避免滚到底反复重试 */
  const [loadMoreError, setLoadMoreError] = useState(false);
  /** 后端说还有、但下一页实际返回空时标记到底，防止滚到底无限请求 */
  const [exhausted, setExhausted] = useState(false);
  const [active, setActive] = useState<{ park: ParkWithPackages; pkg: Package } | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [locationOpen, setLocationOpen] = useState(false);
  /** 命中太少时补的一段「附近还有这些车场」，跟着每次新搜索一起清掉 */
  const [nearby, setNearby] = useState<NearbyBlock | null>(null);
  /** 原词一条都没命中、后端换了个写法时才有的值（如「深圳合一社区」→「合一社区」） */
  const [fallbackQuery, setFallbackQuery] = useState("");

  const reqId = useRef(0);
  /** 用户手动选过城市后，定位反查到的城市不要覆盖他的选择 */
  const cityTouched = useRef(false);
  /** 刚拿到定位，下一趟请求用它把旧列表清掉、换成骨架屏，避免列表硬跳 */
  const geoRefresh = useRef(false);
  /** 首屏/换条件那一趟还在路上，此时别让「滚到底」抢先追加下一页 */
  const pendingReset = useRef(false);
  /** 滚到底的哨兵 */
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    fetch("/api/config")
      .then((res) => res.json())
      .then((json) => setShareCode(json?.data?.shareCode ?? ""))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const query = city ? `?city=${encodeURIComponent(city)}` : "";
    fetch(`/api/facets${query}`)
      .then((res) => res.json())
      .then((json) => {
        const next: Facets = {
          cities: json?.data?.cities ?? [],
          districts: json?.data?.districts ?? [],
          industries: json?.data?.industries ?? [],
          types: json?.data?.types ?? [],
          slots: json?.data?.slots ?? [],
        };
        setFacets((prev) => ({
          ...next,
          // 切换城市时只更新区，城市/业态/类型/时段保留首屏那份
          cities: next.cities.length ? next.cities : prev.cities,
          industries: next.industries.length ? next.industries : prev.industries,
          types: next.types.length ? next.types : prev.types,
          slots: next.slots.length ? next.slots : prev.slots,
        }));
      })
      .catch(() => undefined)
      .finally(() => setDistrictsLoading(false));
  }, [city]);

  /**
   * 以「命中的第一个车场」为中心找附近车场。
   *
   * 只用来补结果很少的情况：结果多的时候列表本身已经覆盖这片区域，
   * 再挂一段周边会让人以为下面还有一批更近的。
   */
  const loadNearby = useCallback(
    async (
      target: {
        lat: number;
        lng: number;
        /** 锚点名。结果太少时是「命中的那个车场」，0 结果时是「你附近」 */
        anchor: string;
        reason: "few" | "none";
        /** 已经出现在列表里的车场，别再重复一遍 */
        exclude?: string[];
      },
      id: number,
    ) => {
      const params = new URLSearchParams({
        lat: String(roundCoord(target.lat)),
        lng: String(roundCoord(target.lng)),
        limit: "8",
        // 只带前 10 个，URL 太长会让 CDN 无法复用
        exclude: (target.exclude ?? []).slice(0, 10).join(","),
      });
      try {
        const res = await fetch(`/api/nearby?${params.toString()}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (reqId.current !== id) return;
        const nearbyParks: ParkWithPackages[] = json?.data ?? [];
        setNearby(
          nearbyParks.length
            ? {
                parks: nearbyParks,
                anchor: target.anchor,
                radiusKm: Number(json?.radiusKm) || 3,
                reason: target.reason,
              }
            : null,
        );
      } catch {
        if (reqId.current === id) setNearby(null);
      }
    },
    [],
  );

  const fetchList = useCallback(
    async (targetPage: number, append: boolean) => {
      const id = reqId.current + 1;
      reqId.current = id;
      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
        pendingReset.current = true;
        setLoadMoreError(false);
        setExhausted(false);
        // 定位刚回来：先把旧列表清掉走骨架屏，不然首屏数据会硬跳一下
        if (geoRefresh.current) {
          geoRefresh.current = false;
          setParks([]);
        }
      }
      try {
        const params = new URLSearchParams();
        if (keyword.trim()) params.set("q", keyword.trim());
        if (city) params.set("city", city);
        if (district) params.set("district", district);
        if (industry) params.set("industry", industry);
        if (type) params.set("type", type);
        if (slot) params.set("slot", slot);
        if (maxPrice > 0) params.set("maxPrice", String(maxPrice));
        params.set("sort", sort);
        // 坐标和排序无关：推荐/价格最低也要显示「离我多远」，只是不参与排序
        if (coords) {
          params.set("lat", String(coords.lat));
          params.set("lng", String(coords.lng));
        }
        params.set("page", String(targetPage));
        params.set("pageSize", String(PAGE_SIZE));
        const res = await fetch(`/api/search?${params.toString()}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        // 被更新的请求取代了，不算失败，也别覆盖列表
        if (reqId.current !== id) return true;
        const list: ParkWithPackages[] = json?.data ?? [];
        if (append && list.length === 0) setExhausted(true);
        setParks((prev) => (append ? [...prev, ...list] : list));
        setTotal(json?.total ?? list.length);
        setPage(targetPage);
        if (!append) {
          const hits = json?.total ?? list.length;
          setFallbackQuery(typeof json?.fallbackQuery === "string" ? json.fallbackQuery : "");
          const anchorPark = list.find((park) => park.lat && park.lng);
          if (anchorPark && hits <= NEARBY_TRIGGER_TOTAL) {
            // 命中太少：用户找的那个地方附近我们没收录，拿第一个车场当锚点补一段周边
            void loadNearby(
              {
                lat: anchorPark.lat,
                lng: anchorPark.lng,
                anchor: anchorPark.name,
                reason: "few",
                exclude: list.map((park) => park.id),
              },
              id,
            );
          } else if (!list.length && coords && keyword.trim()) {
            // 一条没命中（「海岸城」「壹方城」这类商圈名库里没有）：用他本人的位置兜底。
            // 搜这个地名的人大概率就在它附近，附近能办月卡的车场就是他要的答案。
            // 只在有关键词时做：纯筛选筛空了是条件太严，给「你附近的车场」等于答非所问。
            void loadNearby(
              { lat: coords.lat, lng: coords.lng, anchor: "你所在的位置", reason: "none" },
              id,
            );
          } else {
            setNearby(null);
          }
        }
        return true;
      } catch {
        return false;
      } finally {
        if (reqId.current === id) {
          setLoading(false);
          setLoadingMore(false);
          if (!append) pendingReset.current = false;
        }
      }
    },
    [keyword, city, district, industry, type, slot, maxPrice, sort, coords, loadNearby],
  );

  /**
   * 定位没定下来之前不出列表：骨架屏顶着，一次请求都不发。
   * 用户自己动手了（skipGeo 会把状态挪出 boot/locating）就立刻放行。
   */
  const geoWaiting = geoState === "boot" || geoState === "locating";

  useEffect(() => {
    // 拼音还在组合：等上屏再发，否则一趟输入会打出五六个半成品请求
    if (geoWaiting || imeOpen) return;
    const timer = setTimeout(() => {
      fetchList(1, false);
    }, 300);
    return () => clearTimeout(timer);
  }, [fetchList, geoWaiting, imeOpen]);

  /** 当前结果数（给埋点用；直接挂进依赖会让每次结果变化都重发一次上报） */
  const totalRef = useRef(0);
  useEffect(() => {
    totalRef.current = total;
  }, [total]);

  /**
   * 搜索埋点只认「用户真正想搜的词」：输入停下来 1.2 秒、结果也回来了才记一条，
   * 同一次访问里同一个词只记一次。以前挂在 fetchList 里，等于每个中间态各记一笔。
   */
  const lastBeaconQ = useRef("");
  useEffect(() => {
    const q = keyword.trim();
    if (!q || imeOpen || geoWaiting || loading) return;
    if (lastBeaconQ.current === q) return;
    const timer = setTimeout(() => {
      lastBeaconQ.current = q;
      beacon("search", { q, n: totalRef.current });
    }, 1200);
    return () => clearTimeout(timer);
  }, [keyword, imeOpen, geoWaiting, loading]);

  const hasMore = !exhausted && parks.length > 0 && parks.length < total;

  // 滚到底自动续下一页：哨兵进视口就发请求，成功后再往下探一格，直到填满或到底
  useEffect(() => {
    if (!hasMore || loadMoreError) return;
    const el = loadMoreRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries[0].isIntersecting) return;
        if (loading || loadingMore || pendingReset.current) return;
        void fetchList(page + 1, true).then((ok) => {
          if (!ok) setLoadMoreError(true);
        });
      },
      { rootMargin: "240px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, loadMoreError, loading, loadingMore, page, fetchList]);

  /** 定位成功后再反查城市：默认把结果锁在所在城市，不然「价格最低」会按全国排 */
  const resolveCity = useCallback(async (coords: Coords) => {
    try {
      const res = await fetch(`/api/locate?lat=${coords.lat}&lng=${coords.lng}`);
      const json = (await res.json()) as { data?: { city?: string } };
      const hit = json?.data?.city ?? "";
      if (hit) writeGeoCache({ ...coords, city: hit });
      return hit;
    } catch {
      // 反查失败就保持「全国」，不挡主流程
      return "";
    }
  }, []);

  /** 用户自己动手了：不再等定位，立刻放行列表请求（定位回调也会被丢掉） */
  const skipGeo = useCallback(() => {
    if (geoAborted.current) return;
    geoAborted.current = true;
    setGeoState((prev) => (prev === "boot" || prev === "locating" ? "idle" : prev));
  }, []);

  const locate = useCallback(
    (force = false) => {
      // 用户已经自己动手了（跳过了定位），这一趟自动定位就别再跑，免得又把列表卡住
      if (!force && geoAborted.current) return;
      // 刚定位过就直接复用，既不弹权限也不让列表抖一下；force 只用来跳过缓存
      const cached = force ? null : readGeoCache();
      if (cached) {
        setCoords({ lat: roundCoord(cached.lat), lng: roundCoord(cached.lng) });
        if (cached.city && !cityTouched.current) {
          setCity(cached.city);
          setDistrict("");
        }
        setGeoState("idle");
        return;
      }
      if (typeof navigator === "undefined" || !navigator.geolocation) {
        setGeoState("error");
        setGeoError("当前浏览器不支持定位，直接选城市吧");
        return;
      }
      // 重新定位（用户点重试）：上一轮已经放弃过，这里要重新允许回调生效
      geoAborted.current = false;
      setGeoState("locating");
      setGeoError("");
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          if (geoAborted.current) return;
          const next = {
            lat: roundCoord(pos.coords.latitude),
            lng: roundCoord(pos.coords.longitude),
          };
          writeGeoCache(next);
          // 先反查城市再一次性写回坐标，避免「坐标变一次、城市变一次」连跳两次
          const hit = await resolveCity(next);
          if (geoAborted.current) return;
          geoRefresh.current = true;
          if (hit && !cityTouched.current) {
            setCity(hit);
            setDistrict("");
          }
          setCoords(next);
          setGeoState("idle");
        },
        (err) => {
          if (geoAborted.current) return;
          setGeoState("error");
          setGeoError(
            err.code === err.PERMISSION_DENIED
              ? "定位权限被拒绝了，下面先按全国排；点「位置」选个城市更准"
              : "没拿到你的位置，点这里重试或手动选城市",
          );
        },
        { timeout: 10000, maximumAge: 300000 },
      );
    },
    [resolveCity],
  );

  /**
   * 空闲时把三个弹层预取进来：首屏不抢带宽，用户点「位置 / 筛选 / 办理」时
   * 代码已经躺在浏览器缓存里，不会先闪一下空白再弹出来。
   * 2.5 秒是估的——首屏请求基本都在这个时间之内完成，再晚就失去预热的意义。
   */
  useEffect(() => {
    const warm = () => {
      void import("@/components/LocationSheet");
      void import("@/components/FilterSheet");
      void import("@/components/PackageSheet");
    };
    const timer = setTimeout(warm, 2500);
    return () => clearTimeout(timer);
  }, []);

  // 进来先问定位：等它定下来（或用户自己动手）才出第一版列表，避免先给全国再换成附近
  useEffect(() => {
    // 放到下一个 tick，让首屏先渲染出来，权限弹窗不至于卡住白屏
    const kick = setTimeout(locate, 0);
    return () => clearTimeout(kick);
  }, [locate]);

  /** 筛选面板里控制的那几项，用来回填面板和算「筛选」上的角标 */
  const filterValues: FilterValues = { industry, type, slot, maxPrice };
  const filterCount =
    (industry ? 1 : 0) + (type ? 1 : 0) + (slot ? 1 : 0) + (maxPrice > 0 ? 1 : 0);

  /** 「位置」弹层里选城市：切城市要顺手清掉区域，不然会筛出空结果 */
  function chooseCity(name: string) {
    skipGeo();
    cityTouched.current = true;
    if (name !== city) setDistrictsLoading(true);
    setCity(name);
    setDistrict("");
  }

  /** 只选区不换城市：同样算用户自己动手，别再等定位 */
  function chooseDistrict(name: string) {
    skipGeo();
    setDistrict(name);
  }

  /** 面板里点了「确定」才写回这些条件 */
  function applyFilters(next: FilterValues) {
    skipGeo();
    setIndustry(next.industry);
    setType(next.type);
    setSlot(next.slot);
    setMaxPrice(next.maxPrice);
  }

  /**
   * 0 结果页的出路一：清掉关键词，按当前位置重新出列表。
   * 库里没有商圈名，但「他人在哪儿」这件事我们是知道的，这也是唯一不依赖外部
   * 地理编码就能把「海岸城」这类输入救回来的办法。
   */
  function searchNearMe() {
    skipGeo();
    setKeyword("");
    setDistrict("");
    locate(true);
  }

  /** 出路二：清掉关键词，看当前选择的城市（没选就是全国推荐位） */
  function showWholeCity() {
    skipGeo();
    setKeyword("");
    setDistrict("");
  }

  function resetAll() {
    skipGeo();
    setKeyword("");
    cityTouched.current = false;
    setCity("");
    setDistrict("");
    setIndustry("");
    setType("");
    setSlot("");
    setMaxPrice(0);
    setSort("recommend");
  }

  return (
    <div className="space-y-3">
      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#1b6bff] to-[#0d3fb0] px-4 pb-4 pt-4 text-white">
        {/* 品牌不占独立一行——首屏高度要给搜索结果，锁在一行里最省 */}
        <div className="flex items-center gap-1.5">
          <BrandPin className="h-5 w-5 shrink-0" />
          <span className="text-[15px] font-semibold leading-none tracking-[0.18em]">泊月</span>
          <span className="ml-0.5 rounded-full bg-white/15 px-1.5 py-0.5 text-[10px] leading-none text-white/85">
            停车月卡 · 附近谁家最省
          </span>
        </div>
        <h1 className="mt-2.5 text-[19px] font-semibold leading-tight">附近哪家能办停车月卡</h1>
        <div className="mt-1 text-xs text-white/80">
          谁家最省、多少钱一目了然，扫码直接在官方小程序办
        </div>
        <div className="mt-3">
          <input
            value={keyword}
            onChange={(e) => {
              skipGeo();
              setKeyword(e.target.value);
            }}
            // 拼音组合期间只更新输入框，不发请求也不埋点（见 imeOpen 注释）
            onCompositionStart={() => setImeOpen(true)}
            onCompositionEnd={(e) => {
              skipGeo();
              setKeyword(e.currentTarget.value);
              setImeOpen(false);
            }}
            placeholder="搜车场名、楼宇或小区名，如：科技园 / 侨城坊"
            autoComplete="off"
            className="w-full rounded-xl border border-white/40 bg-white px-3.5 py-3 text-sm text-foreground placeholder:text-muted focus:outline-none"
          />
        </div>
        {geoState === "error" ? (
          <div className="mt-2 flex items-center gap-2 text-[11px] text-white/70">
            <span>{geoError}</span>
            <button
              onClick={() => locate(true)}
              className="rounded-md bg-white/15 px-2 py-1 font-medium text-white transition-colors hover:bg-white/25"
            >
              重试定位
            </button>
          </div>
        ) : null}
      </section>

      {/* 官方式筛选条：位置 / 筛选入口 / 排序都挤在一行，条件进面板里选 */}
      <section className="card no-scrollbar sticky top-0 z-20 flex items-center gap-1 overflow-x-auto px-2 py-2 shadow-[0_1px_8px_rgba(16,20,28,0.06)]">
        <button
          type="button"
          onClick={() => setLocationOpen(true)}
          className={`filter-pill shrink-0 ${city || district ? "is-active" : ""}`}
        >
          {city ? city.replace(/市$/, "") : "位置"}
          {district ? ` · ${district}` : ""}
        </button>

        <button
          type="button"
          onClick={() => setFilterOpen(true)}
          className={`filter-pill ${filterCount ? "is-active" : ""}`}
        >
          筛选
          {filterCount ? (
            <span className="rounded-full bg-brand px-1 text-[10px] leading-4 text-white">
              {filterCount}
            </span>
          ) : null}
        </button>

        {SORT_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            disabled={option.value === "distance" && !coords}
            onClick={() => {
              skipGeo();
              setSort(option.value);
            }}
            className={`filter-pill ${sort === option.value ? "is-active" : ""} disabled:cursor-not-allowed disabled:opacity-40`}
          >
            {option.label}
          </button>
        ))}

        {city || district || keyword || filterCount > 0 ? (
          <button type="button" className="filter-pill shrink-0" onClick={resetAll}>
            清空
          </button>
        ) : null}
      </section>

      {/* 首屏加载用骨架屏顶着，不出「搜索中」这种字 */}
      {loading && parks.length === 0 ? (
        <div className="space-y-3" aria-hidden="true">
          {[0, 1, 2, 3].map((item) => (
            <div key={item} className="card animate-pulse p-3">
              <div className="h-4 w-1/2 rounded bg-black/[0.07]" />
              <div className="mt-2 h-3 w-3/4 rounded bg-black/[0.05]" />
              <div className="mt-3 flex gap-1.5">
                <div className="h-10 w-20 rounded-lg bg-black/[0.05]" />
                <div className="h-10 w-20 rounded-lg bg-black/[0.05]" />
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {/* 一条都没找到时不能只写「没找到」：库里根本没有商圈名，光让用户「换个词」等于让他猜 */}
      {!loading && parks.length === 0 && !nearby ? (
        <div className="card p-6 text-center">
          <div className="text-sm font-medium">没找到匹配的车场</div>
          <div className="mt-1.5 text-xs leading-relaxed text-muted">
            {keyword.trim() ? (
              <>
                站里收录的是具体车场、楼宇和小区名，
                <br />
                商圈名这类叫法大多查不到。换个楼宇 / 小区 / 路名试试，或者直接按位置看。
              </>
            ) : (
              <>当前筛选条件下没有车场，放宽业态 / 时段 / 价格试试。</>
            )}
          </div>
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            {keyword.trim() ? (
              <button
                onClick={searchNearMe}
                className="rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white"
              >
                按我的位置找附近
              </button>
            ) : (
              <button
                onClick={resetAll}
                className="rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white"
              >
                清空筛选
              </button>
            )}
            {keyword.trim() ? (
              <button
                onClick={showWholeCity}
                className="rounded-lg border border-border px-3 py-1.5 text-xs"
              >
                看{city ? city.replace(/市$/, "") : "全部"}车场
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* 原词没命中、后端换了写法时要说清，否则用户会以为自己搜错了 */}
      {!loading && fallbackQuery ? (
        <div className="card px-3 py-2 text-[11px] leading-relaxed text-muted">
          「{keyword.trim()}」没有直接匹配的车场，下面是「{fallbackQuery}」的结果
        </div>
      ) : null}

      {/* 筛选/翻页时列表整体淡一点，明确「正在换结果」，但不打断浏览 */}
      <div className={loading && parks.length > 0 ? "space-y-3 opacity-60" : "space-y-3"}>
        {parks.map((park) => (
          <ParkCard key={park.id} park={park} onPick={(picked, pkg) => setActive({ park: picked, pkg })} />
        ))}
      </div>

      {hasMore ? (
        <div ref={loadMoreRef} className="py-3 text-center text-xs text-muted">
          {loadMoreError ? (
            <button
              className="text-brand"
              onClick={() => {
                setLoadMoreError(false);
                void fetchList(page + 1, true);
              }}
            >
              加载失败，点这里重试
            </button>
          ) : loadingMore ? (
            "正在加载更多…"
          ) : (
            "继续下滑加载更多"
          )}
        </div>
      ) : parks.length > 0 ? (
        <div className="py-3 text-center text-[11px] text-muted">没有更多了</div>
      ) : null}

      {/* 命中太少补周边；一条没命中就用定位兜底——搜「海岸城」的人多半就在它附近。
          放在列表底部而不是中间：主结果是用户要找的那个车场，周边是备选，不能抢在它前面 */}
      {nearby ? (
        <section className="space-y-2 pt-1" aria-labelledby="nearby-title">
          <div className="px-1">
            <h2 id="nearby-title" className="text-sm font-semibold leading-snug">
              {nearby.reason === "none"
                ? `「${keyword.trim()}」没查到，你附近有 ${nearby.parks.length} 个能办月卡的`
                : `附近还有 ${nearby.parks.length} 个能办月卡的`}
            </h2>
            <div className="mt-0.5 text-[11px] text-muted">
              {nearby.reason === "none"
                ? `按你的位置排 · ${nearby.radiusKm}km 内`
                : `以「${nearby.anchor}」为中心 · ${nearby.radiusKm}km 内`}
            </div>
          </div>
          <div className="space-y-3">
            {nearby.parks.map((park) => (
              <ParkCard
                key={park.id}
                park={park}
                onPick={(picked, pkg) => setActive({ park: picked, pkg })}
              />
            ))}
          </div>
        </section>
      ) : null}

      {locationOpen ? (
        <LocationSheet
          city={city}
          cities={facets.cities.map((item) => item.name)}
          district={district}
          districts={facets.districts.map((item) => item.name)}
          districtsLoading={districtsLoading}
          onPickCity={chooseCity}
          onPickDistrict={chooseDistrict}
          onClose={() => setLocationOpen(false)}
        />
      ) : null}

      {filterOpen ? (
        <FilterSheet
          value={filterValues}
          onClose={() => setFilterOpen(false)}
          onApply={applyFilters}
        />
      ) : null}

      {active ? (
        <PackageSheet
          park={active.park}
          pkg={active.pkg}
          shareCode={shareCode}
          onClose={() => setActive(null)}
        />
      ) : null}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import FilterSheet, { type FilterValues } from "@/components/FilterSheet";
import PackageSheet from "@/components/PackageSheet";
import {
  PRICE_STEPS,
  SORT_OPTIONS,
  formatDistance,
  yuan,
  type Package,
  type ParkWithPackages,
} from "@/lib/types";

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
const EMPTY_FACETS: Facets = { cities: [], districts: [], industries: [], types: [], slots: [] };

/** 定位结果缓存 30 分钟，同一个标签页内反复进来不再弹权限、也不再闪一次“推荐”排序 */
const GEO_CACHE_KEY = "jtc:geo";
const GEO_CACHE_TTL = 30 * 60 * 1000;

type Coords = { lat: number; lng: number };
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

export default function HomePage() {
  const [keyword, setKeyword] = useState("");
  const [city, setCity] = useState("");
  const [district, setDistrict] = useState("");
  const [industry, setIndustry] = useState("");
  const [type, setType] = useState("");
  const [slot, setSlot] = useState("");
  const [maxPrice, setMaxPrice] = useState(0);
  const [sort, setSort] = useState<string>("recommend");

  const [coords, setCoords] = useState<Coords | null>(null);
  const [geoState, setGeoState] = useState<"idle" | "locating" | "error">("idle");
  const [geoError, setGeoError] = useState("");
  /** 定位有结论（成功/失败/超时兜底）后才发首批搜索，避免列表先按“推荐”排一遍再跳成“按距离” */
  const [geoReady, setGeoReady] = useState(false);

  const [facets, setFacets] = useState<Facets>(EMPTY_FACETS);
  const [promoQrPath, setPromoQrPath] = useState("");

  const [parks, setParks] = useState<ParkWithPackages[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [active, setActive] = useState<{ park: ParkWithPackages; pkg: Package } | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);

  const reqId = useRef(0);
  /** 用户手动选过排序后，定位结果回来就不要偷偷改回“按距离” */
  const sortTouched = useRef(false);
  /** 用户手动选过城市后，定位反查到的城市不要覆盖他的选择 */
  const cityTouched = useRef(false);

  useEffect(() => {
    fetch("/api/config")
      .then((res) => res.json())
      .then((json) => setPromoQrPath(json?.data?.promoQrPath ?? ""))
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
      .catch(() => undefined);
  }, [city]);

  const fetchList = useCallback(
    async (targetPage: number, append: boolean) => {
      const id = reqId.current + 1;
      reqId.current = id;
      if (append) setLoadingMore(true);
      else setLoading(true);
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
        const json = await res.json();
        if (reqId.current !== id) return;
        const list: ParkWithPackages[] = json?.data ?? [];
        setParks((prev) => (append ? [...prev, ...list] : list));
        setTotal(json?.total ?? list.length);
        setPage(targetPage);
      } finally {
        if (reqId.current === id) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [keyword, city, district, industry, type, slot, maxPrice, sort, coords],
  );

  useEffect(() => {
    if (!geoReady) return;
    const timer = setTimeout(() => {
      fetchList(1, false);
    }, 250);
    return () => clearTimeout(timer);
  }, [fetchList, geoReady]);

  /** 定位成功后再反查城市：默认把结果锁在所在城市，不然「价格最低」会按全国排 */
  const resolveCity = useCallback(async (coords: Coords) => {
    try {
      const res = await fetch(`/api/locate?lat=${coords.lat}&lng=${coords.lng}`);
      const json = (await res.json()) as { data?: { city?: string } };
      const hit = json?.data?.city ?? "";
      if (!hit) return;
      writeGeoCache({ ...coords, city: hit });
      if (cityTouched.current) return;
      setCity(hit);
      setDistrict("");
    } catch {
      // 反查失败就保持「全国」，不挡主流程
    }
  }, []);

  const locate = useCallback(
    (forceSort = false) => {
      // 刚定位过就直接复用，既不弹权限也不让列表抖一下
      const cached = forceSort ? null : readGeoCache();
      if (cached) {
        setCoords({ lat: cached.lat, lng: cached.lng });
        if (!sortTouched.current) setSort("distance");
        if (cached.city && !cityTouched.current) {
          setCity(cached.city);
          setDistrict("");
        }
        setGeoReady(true);
        return;
      }
      if (typeof navigator === "undefined" || !navigator.geolocation) {
        setGeoState("error");
        setGeoError("当前浏览器不支持定位，直接选城市吧");
        setGeoReady(true);
        return;
      }
      setGeoState("locating");
      setGeoError("");
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const next = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          setCoords(next);
          writeGeoCache(next);
          if (forceSort || !sortTouched.current) setSort("distance");
          setGeoState("idle");
          setGeoReady(true);
          void resolveCity(next);
        },
        (err) => {
          setGeoState("error");
          setGeoError(
            err.code === err.PERMISSION_DENIED
              ? "定位权限被拒绝了，手动选城市吧"
              : "没拿到你的位置，点这里重试或手动选城市",
          );
          setGeoReady(true);
        },
        { timeout: 10000, maximumAge: 300000 },
      );
    },
    [resolveCity],
  );

  // 进来就按当前位置找：有缓存直接生效，没有就静默请求一次浏览器定位
  useEffect(() => {
    // 放到下一个 tick 再请求，让首屏先渲染出来，权限弹窗不至于卡住白屏
    const kick = setTimeout(locate, 0);
    // 最多等 1.2 秒：用户忽略权限弹窗时首页不能一直空着
    const fallback = setTimeout(() => setGeoReady(true), 1200);
    return () => {
      clearTimeout(kick);
      clearTimeout(fallback);
    };
  }, [locate]);

  const activeFilters = useMemo(() => {
    return [
      city,
      district,
      industry,
      type,
      slot,
      maxPrice > 0 ? PRICE_STEPS.find((step) => step.value === maxPrice)?.label ?? "" : "",
    ].filter(Boolean);
  }, [city, district, industry, type, slot, maxPrice]);

  /** 筛选面板里控制的那几项，用来回填面板和算「筛选」上的角标 */
  const filterValues: FilterValues = { district, industry, type, slot, maxPrice };
  const filterCount =
    (district ? 1 : 0) +
    (industry ? 1 : 0) +
    (type ? 1 : 0) +
    (slot ? 1 : 0) +
    (maxPrice > 0 ? 1 : 0);

  /** 切城市要顺手清掉区域，不然会筛出空结果；手动选过就不再被定位结果覆盖 */
  function chooseCity(name: string) {
    cityTouched.current = true;
    setCity(name);
    setDistrict("");
  }

  /** 面板里点了「确定」才写回这些条件 */
  function applyFilters(next: FilterValues) {
    setDistrict(next.district);
    setIndustry(next.industry);
    setType(next.type);
    setSlot(next.slot);
    setMaxPrice(next.maxPrice);
  }

  function resetAll() {
    setKeyword("");
    cityTouched.current = false;
    setCity("");
    setDistrict("");
    setIndustry("");
    setType("");
    setSlot("");
    setMaxPrice(0);
    sortTouched.current = false;
    setSort(coords ? "distance" : "recommend");
  }

  return (
    <div className="space-y-3">
      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#1b6bff] to-[#0d3fb0] px-4 pb-4 pt-5 text-white">
        <div className="text-[19px] font-semibold leading-tight">找停车月卡，比临停便宜一半</div>
        <div className="mt-1 text-xs text-white/80">
          根据你的位置和需求挑车场，选好套餐扫码就能办
        </div>
        <div className="mt-3">
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜车场名、商圈、地铁站，如：科技园 / 万象城"
            autoComplete="off"
            className="w-full rounded-xl border border-white/40 bg-white px-3.5 py-3 text-sm text-foreground placeholder:text-muted focus:outline-none"
          />
        </div>
        {geoState === "locating" ? (
          <div className="mt-2 text-[11px] text-white/70">正在获取你的位置…</div>
        ) : geoState === "error" ? (
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

      {/* 官方式筛选条：城市 / 筛选入口 / 排序都挤在一行，条件进面板里选 */}
      <section className="card no-scrollbar sticky top-0 z-20 flex items-center gap-1 overflow-x-auto px-2 py-2 shadow-[0_1px_8px_rgba(16,20,28,0.06)]">
        <div className="relative flex shrink-0 items-center">
          <select
            aria-label="选择城市"
            value={city}
            onChange={(e) => chooseCity(e.target.value)}
            className="filter-pill pr-6"
          >
            <option value="">全国</option>
            {facets.cities.map((item) => (
              <option key={item.name} value={item.name}>
                {item.name.replace(/市$/, "")}
              </option>
            ))}
          </select>
          <svg
            viewBox="0 0 12 12"
            aria-hidden="true"
            className="pointer-events-none absolute right-1.5 h-2.5 w-2.5 text-muted"
          >
            <path
              d="M2.5 4.5 6 8l3.5-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>

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
              sortTouched.current = true;
              setSort(option.value);
            }}
            className={`filter-pill ${sort === option.value ? "is-active" : ""} disabled:cursor-not-allowed disabled:opacity-40`}
          >
            {option.label}
          </button>
        ))}
      </section>

      <div className="flex items-center justify-between px-1 text-xs text-muted">
        <span>
          {loading ? "搜索中…" : `共 ${total} 个车场`}
          {activeFilters.length ? ` · ${activeFilters.join(" / ")}` : ""}
        </span>
        {activeFilters.length || keyword ? (
          <button className="text-brand" onClick={resetAll}>
            清空
          </button>
        ) : null}
      </div>

      {!loading && parks.length === 0 ? (
        <div className="card p-8 text-center text-sm text-muted">
          没找到符合条件的车场
          <div className="mt-1 text-xs">换个关键词，或放宽业态 / 时段 / 价格试试</div>
        </div>
      ) : null}

      {parks.map((park) => (
        <article key={park.id} className="card p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold">{park.name}</h2>
              <div className="mt-0.5 truncate text-xs text-muted">
                {[park.district, park.area].filter(Boolean).join(" · ")}
                {park.address ? ` · ${park.address}` : ""}
              </div>
              {park.audience ? (
                <div className="mt-0.5 text-[11px] text-muted">适合：{park.audience}</div>
              ) : null}
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              {park.industry ? (
                <span className="rounded-md bg-black/[0.04] px-1.5 py-0.5 text-[11px] text-muted">
                  {park.industry}
                </span>
              ) : null}
              {typeof park.distance === "number" && park.distance > 0 ? (
                <span className="rounded-md bg-brand/10 px-1.5 py-0.5 text-[11px] text-brand">
                  {formatDistance(park.distance)}
                </span>
              ) : null}
            </div>
          </div>

          <div className="mt-2 flex flex-wrap gap-1.5">
            {park.packages.length === 0 ? (
              <span className="text-xs text-muted">暂无在售套餐</span>
            ) : null}
            {park.packages.slice(0, 6).map((pkg) => (
              <button
                key={pkg.id}
                onClick={() => setActive({ park, pkg })}
                className="rounded-lg border border-border px-2.5 py-1.5 text-left transition-colors hover:border-brand/50 hover:bg-brand/[0.03]"
              >
                <div className="text-[11px] text-muted">
                  {pkg.typeLabel || pkg.name}
                  {pkg.period ? <span className="ml-1">{pkg.period}</span> : null}
                </div>
                <div className="mt-0.5 flex items-baseline gap-1">
                  <span className="text-[13px] font-semibold text-price">
                    {pkg.price > 0 ? `¥${yuan(pkg.price)}` : "见码"}
                  </span>
                  {pkg.originPrice > pkg.price ? (
                    <span className="text-[10px] text-muted line-through">¥{yuan(pkg.originPrice)}</span>
                  ) : null}
                </div>
              </button>
            ))}
            {park.packages.length > 6 ? (
              <span className="self-center text-[11px] text-muted">
                还有 {park.packages.length - 6} 个套餐
              </span>
            ) : null}
          </div>
        </article>
      ))}

      {parks.length > 0 && parks.length < total ? (
        <button
          className="btn-ghost w-full"
          onClick={() => fetchList(page + 1, true)}
          disabled={loadingMore}
        >
          {loadingMore ? "加载中…" : `加载更多（还有 ${total - parks.length} 个）`}
        </button>
      ) : null}

      {filterOpen ? (
        <FilterSheet
          value={filterValues}
          city={city}
          districts={facets.districts.map((item) => item.name)}
          onClose={() => setFilterOpen(false)}
          onApply={applyFilters}
        />
      ) : null}

      {active ? (
        <PackageSheet
          park={active.park}
          pkg={active.pkg}
          promoQrPath={promoQrPath}
          onClose={() => setActive(null)}
        />
      ) : null}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PackageSheet from "@/components/PackageSheet";
import {
  INDUSTRIES,
  PACKAGE_TYPES,
  PRICE_STEPS,
  SORT_OPTIONS,
  TIME_SLOTS,
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

export default function HomePage() {
  const [keyword, setKeyword] = useState("");
  const [city, setCity] = useState("");
  const [district, setDistrict] = useState("");
  const [industry, setIndustry] = useState("");
  const [type, setType] = useState("");
  const [slot, setSlot] = useState("");
  const [maxPrice, setMaxPrice] = useState(0);
  const [sort, setSort] = useState<string>("recommend");

  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [geoState, setGeoState] = useState<"idle" | "locating" | "error">("idle");

  const [facets, setFacets] = useState<Facets>(EMPTY_FACETS);
  const [promoQrPath, setPromoQrPath] = useState("");

  const [parks, setParks] = useState<ParkWithPackages[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [active, setActive] = useState<{ park: ParkWithPackages; pkg: Package } | null>(null);

  const reqId = useRef(0);

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
        if (coords && sort === "distance") {
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
    const timer = setTimeout(() => {
      fetchList(1, false);
    }, 250);
    return () => clearTimeout(timer);
  }, [fetchList]);

  function locate() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGeoState("error");
      return;
    }
    setGeoState("locating");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setSort("distance");
        setGeoState("idle");
      },
      () => setGeoState("error"),
      { timeout: 10000, maximumAge: 300000 },
    );
  }

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

  function resetAll() {
    setKeyword("");
    setCity("");
    setDistrict("");
    setIndustry("");
    setType("");
    setSlot("");
    setMaxPrice(0);
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
        <div className="mt-2 flex items-center gap-2">
          <button
            onClick={locate}
            className="rounded-lg bg-white/15 px-3 py-1.5 text-xs font-medium text-white backdrop-blur transition-colors hover:bg-white/25"
          >
            {geoState === "locating"
              ? "定位中…"
              : coords
                ? "已按我的位置排序"
                : "用我的位置找"}
          </button>
          {geoState === "error" ? (
            <span className="text-[11px] text-white/70">拿不到定位，手动选城市吧</span>
          ) : null}
        </div>
      </section>

      <section className="card space-y-2 p-3">
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => setIndustry("")}
            className={`rounded-lg border px-2.5 py-1 text-xs transition-colors ${
              industry === ""
                ? "border-brand bg-brand/10 text-brand"
                : "border-border text-muted hover:bg-black/[0.03]"
            }`}
          >
            全部业态
          </button>
          {INDUSTRIES.map((item) => {
            const hit = facets.industries.find((facet) => facet.name === item);
            if (facets.industries.length && !hit) return null;
            return (
              <button
                key={item}
                onClick={() => setIndustry(industry === item ? "" : item)}
                className={`rounded-lg border px-2.5 py-1 text-xs transition-colors ${
                  industry === item
                    ? "border-brand bg-brand/10 text-brand"
                    : "border-border text-muted hover:bg-black/[0.03]"
                }`}
              >
                {item}
                {hit ? <span className="ml-1 opacity-60">{hit.count}</span> : null}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap gap-1.5">
          {PACKAGE_TYPES.map((item) => {
            const hit = facets.types.find((facet) => facet.name === item);
            if (facets.types.length && !hit) return null;
            return (
              <button
                key={item}
                onClick={() => setType(type === item ? "" : item)}
                className={`rounded-lg border px-2.5 py-1 text-xs transition-colors ${
                  type === item
                    ? "border-brand bg-brand/10 text-brand"
                    : "border-border text-muted hover:bg-black/[0.03]"
                }`}
              >
                {item}
                {hit ? <span className="ml-1 opacity-60">{hit.count}</span> : null}
              </button>
            );
          })}
          <span className="mx-0.5 w-px self-stretch bg-border" />
          {TIME_SLOTS.map((item) => {
            const hit = facets.slots.find((facet) => facet.name === item);
            return (
              <button
                key={item}
                onClick={() => setSlot(slot === item ? "" : item)}
                className={`rounded-lg border px-2.5 py-1 text-xs transition-colors ${
                  slot === item
                    ? "border-brand bg-brand/10 text-brand"
                    : "border-border text-muted hover:bg-black/[0.03]"
                }`}
              >
                {item}
                {hit ? <span className="ml-1 opacity-60">{hit.count}</span> : null}
              </button>
            );
          })}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <select
            className="field"
            value={city}
            onChange={(e) => {
              setCity(e.target.value);
              setDistrict("");
            }}
          >
            <option value="">全部城市</option>
            {facets.cities.map((item) => (
              <option key={item.name} value={item.name}>
                {item.name.replace(/市$/, "")}（{item.count}）
              </option>
            ))}
          </select>
          <select
            className="field"
            value={district}
            onChange={(e) => setDistrict(e.target.value)}
            disabled={!city}
          >
            <option value="">{city ? "全部区域" : "先选城市"}</option>
            {facets.districts.map((item) => (
              <option key={item.name} value={item.name}>
                {item.name}（{item.count}）
              </option>
            ))}
          </select>
          <select
            className="field"
            value={maxPrice}
            onChange={(e) => setMaxPrice(Number(e.target.value))}
          >
            {PRICE_STEPS.map((step) => (
              <option key={step.value} value={step.value}>
                {step.value === 0 ? "价格不限" : step.label}
              </option>
            ))}
          </select>
          <select className="field" value={sort} onChange={(e) => setSort(e.target.value)}>
            {SORT_OPTIONS.map((option) => (
              <option
                key={option.value}
                value={option.value}
                disabled={option.value === "distance" && !coords}
              >
                {option.label}
                {option.value === "distance" && !coords ? "（需定位）" : ""}
              </option>
            ))}
          </select>
        </div>
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
            {park.packages.slice(0, 8).map((pkg) => (
              <button
                key={pkg.id}
                onClick={() => setActive({ park, pkg })}
                className="rounded-xl border border-brand/30 bg-brand/5 px-2.5 py-1.5 text-left transition-colors hover:bg-brand/10"
              >
                <div className="text-xs font-medium text-brand">
                  {pkg.typeLabel || pkg.name}
                  {pkg.period ? <span className="ml-1 font-normal opacity-70">{pkg.period}</span> : null}
                </div>
                <div className="text-[11px] text-foreground">
                  {pkg.price > 0 ? `¥${yuan(pkg.price)}` : "价格见码"}
                  {pkg.originPrice > pkg.price ? (
                    <span className="ml-1 text-muted line-through">¥{yuan(pkg.originPrice)}</span>
                  ) : null}
                </div>
              </button>
            ))}
            {park.packages.length > 8 ? (
              <span className="self-center text-[11px] text-muted">
                还有 {park.packages.length - 8} 个套餐
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

      {active ? (
        <PackageSheet
          park={active.park}
          pkg={active.pkg}
          promoQrPath={promoQrPath}
          mode="public"
          onClose={() => setActive(null)}
        />
      ) : null}
    </div>
  );
}

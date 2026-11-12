"use client";

import {
  formatDistance,
  monthlyPrice,
  shortPackageName,
  yuan,
  type Package,
  type ParkWithPackages,
} from "@/lib/types";

interface Props {
  park: ParkWithPackages;
  /** 点某个套餐：打开出码弹层 */
  onPick: (park: ParkWithPackages, pkg: Package) => void;
}

/**
 * 车场卡片：搜索结果和「附近还有」共用同一张，两处的信息密度和点击行为必须一致
 * ——用户看到两张长得不一样的卡，会以为其中一张是广告。
 */
export default function ParkCard({ park, onPick }: Props) {
  return (
    <article className="card p-3">
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
            onClick={() => onPick(park, pkg)}
            className="rounded-lg border border-border px-2.5 py-1.5 text-left transition-colors hover:border-brand/50 hover:bg-brand/[0.03]"
          >
            <div className="text-[11px] text-muted">
              {pkg.typeLabel || shortPackageName(park.name, pkg.name)}
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
            {/* 季卡/年卡总价高，露出折合月价才比得动月卡 */}
            {pkg.price > 0 && pkg.durationDays >= 60 ? (
              <div className="text-[10px] text-muted">
                折合 ¥{yuan(monthlyPrice(pkg.price, pkg.durationDays))}/月
              </div>
            ) : null}
          </button>
        ))}
        {park.packages.length > 6 ? (
          <span className="self-center text-[11px] text-muted">
            还有 {park.packages.length - 6} 个套餐
          </span>
        ) : null}
      </div>
    </article>
  );
}

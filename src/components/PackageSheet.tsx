"use client";

import { formatDistance, yuan, type Package, type ParkWithPackages } from "@/lib/types";

interface Props {
  park: ParkWithPackages;
  pkg: Package;
  onClose: () => void;
  /** 套餐没配专属码时的兜底推广码 */
  promoQrPath?: string;
}

function navUrl(park: ParkWithPackages) {
  if (!park.lat || !park.lng) return "";
  const name = encodeURIComponent(`${park.name}停车场`);
  return `https://uri.amap.com/marker?position=${park.lng},${park.lat}&name=${name}&src=web&coordinate=gaode`;
}

export default function PackageSheet({ park, pkg, onClose, promoQrPath = "" }: Props) {
  const qr = pkg.qrPath || promoQrPath;
  const facts = [
    pkg.typeLabel,
    pkg.period,
    pkg.durationLabel,
    pkg.durationDays && !pkg.durationLabel ? `${pkg.durationDays} 天` : "",
  ].filter(Boolean);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
      onClick={onClose}
    >
      <div
        className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-card p-4 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-base font-semibold">{park.name}</div>
            <div className="mt-0.5 text-xs text-muted">
              {pkg.name}
              {pkg.period ? ` · ${pkg.period}` : ""}
              {pkg.price > 0 ? ` · ¥${yuan(pkg.price)}` : ""}
            </div>
            {park.distance ? (
              <div className="mt-0.5 text-[11px] text-brand">
                距你 {formatDistance(park.distance)}
              </div>
            ) : null}
          </div>
          <button className="btn-ghost shrink-0 px-2 py-1 text-xs" onClick={onClose}>
            关闭
          </button>
        </div>

        {qr ? (
          <>
            <div className="mb-2 rounded-xl border border-border bg-white p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={qr}
                alt={`${park.name}套餐二维码`}
                className="mx-auto block max-h-72 w-auto"
              />
            </div>
            <div className="mb-3 text-center text-xs text-muted">
              长按识别二维码 → 选「{pkg.name}」下单，办完当天就能用
            </div>
          </>
        ) : (
          <div className="mb-3 rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted">
            这个套餐的二维码还没配好，先联系推广员
          </div>
        )}

        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
          {pkg.price > 0 ? (
            <span className="text-lg font-semibold text-brand">¥{yuan(pkg.price)}</span>
          ) : null}
          {pkg.originPrice > pkg.price ? (
            <span className="text-muted line-through">¥{yuan(pkg.originPrice)}</span>
          ) : null}
          {facts.map((fact) => (
            <span key={fact} className="rounded-md bg-brand/10 px-1.5 py-0.5 text-brand">
              {fact}
            </span>
          ))}
        </div>

        {pkg.ruleSummary ? (
          <div className="mb-3 rounded-lg bg-black/[0.03] p-2 text-xs leading-relaxed text-muted">
            {pkg.ruleSummary}
          </div>
        ) : null}

        {park.address ? (
          <div className="mb-3 flex items-start gap-2 text-xs text-muted">
            <span className="min-w-0 flex-1">{park.address}</span>
            {navUrl(park) ? (
              <a
                className="btn-ghost shrink-0 px-2 py-1 text-xs"
                href={navUrl(park)}
                target="_blank"
                rel="noreferrer"
              >
                导航
              </a>
            ) : null}
          </div>
        ) : null}

        <div className="text-center text-[11px] text-muted">
          价格与规则以官方页面为准，下单前请确认出场时间限制
        </div>
      </div>
    </div>
  );
}

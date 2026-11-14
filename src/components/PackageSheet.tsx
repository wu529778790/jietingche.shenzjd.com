"use client";

import { useEffect, useMemo } from "react";
import { packageQrDataUrl } from "@/lib/qr";
import QrActions from "@/components/QrActions";
import { beacon } from "@/lib/beacon";
import {
  formatDistance,
  monthlyPrice,
  shortPackageName,
  tidyRuleSummary,
  yuan,
  type Package,
  type ParkWithPackages,
} from "@/lib/types";

interface Props {
  park: ParkWithPackages;
  pkg: Package;
  onClose: () => void;
  /** 分佣码，用来拼套餐直达链接并在前端现场出码 */
  shareCode?: string;
}

function navUrl(park: ParkWithPackages) {
  if (!park.lat || !park.lng) return "";
  const name = encodeURIComponent(`${park.name}停车场`);
  return `https://uri.amap.com/marker?position=${park.lng},${park.lat}&name=${name}&src=web&coordinate=gaode`;
}

export default function PackageSheet({ park, pkg, onClose, shareCode = "" }: Props) {
  // 码全是前端现场生成的：套餐直达码 → 缺编码时退到搜索页
  const qr = useMemo(
    () => packageQrDataUrl(park.parkCode, pkg.sourcePackageId, shareCode),
    [park.parkCode, pkg.sourcePackageId, shareCode],
  );

  /** 官方套餐名带车场前缀，标题已经写了车场，这里只留套餐本身 */
  const pkgLabel = useMemo(() => shortPackageName(park.name, pkg.name), [park.name, pkg.name]);

  // 「生成二维码」的埋点就在这里：弹层一打开码就已经出好了，这是页面上唯一能测到的起点
  const track = useMemo(
    () => ({ park: park.parkCode, pkg: pkg.sourcePackageId }),
    [park.parkCode, pkg.sourcePackageId],
  );
  useEffect(() => {
    beacon("sheet_open", track);
  }, [track]);

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
          <div className="min-w-0 flex-1">
            <div className="truncate text-base font-semibold">{park.name}</div>
            {/* 地址紧跟车场名：用户看到名字时就得知道是哪个位置，压在底部会没人看 */}
            {park.address ? (
              <div className="mt-1 text-xs leading-relaxed text-muted">{park.address}</div>
            ) : null}
            {park.distance ? (
              <div className="mt-0.5 text-[11px] text-brand">
                距你 {formatDistance(park.distance)}
              </div>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-col gap-1">
            {navUrl(park) ? (
              <a
                className="btn-ghost px-2 py-1 text-center text-xs"
                href={navUrl(park)}
                target="_blank"
                rel="noreferrer"
              >
                导航
              </a>
            ) : null}
            <button className="btn-ghost px-2 py-1 text-center text-xs" onClick={onClose}>
              关闭
            </button>
          </div>
        </div>

        {/* 先给价格和规格，再给码：用户先判断值不值，再决定扫不扫 */}
        <div className="mb-3 flex flex-wrap items-baseline gap-2 text-xs">
          {pkg.price > 0 ? (
            <span className="text-xl font-semibold text-brand">¥{yuan(pkg.price)}</span>
          ) : null}
          {pkg.originPrice > pkg.price ? (
            <span className="text-muted line-through">¥{yuan(pkg.originPrice)}</span>
          ) : null}
          {pkg.price > 0 && pkg.durationDays >= 60 ? (
            <span className="text-muted">
              折合 ¥{yuan(monthlyPrice(pkg.price, pkg.durationDays))}/月
            </span>
          ) : null}
          {facts.map((fact) => (
            <span key={fact} className="rounded-md bg-brand/10 px-1.5 py-0.5 text-brand">
              {fact}
            </span>
          ))}
        </div>
        {/* 可停时段是购买决策参数不是页脚细则：紧跟标签/价格，让「夜间是几点」一眼可答 */}
        {pkg.ruleSummary ? (
          <div className="-mt-1 mb-3 text-xs leading-relaxed text-muted">
            {tidyRuleSummary(pkg.ruleSummary)}
          </div>
        ) : null}

        {/*
          只能出码：实测这个链接在微信里点不开（微信只会跳小程序），
          唯一能到下单页的入口是「扫一扫 / 长按识别」。
        */}
        {qr ? (
          <>
            <div className="mb-2 rounded-xl border border-border bg-white p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={qr}
                alt={`${park.name}套餐二维码`}
                className="mx-auto block max-h-56 w-auto"
              />
            </div>
            <div className="mb-3">
              <QrActions qr={qr} filename={`${park.name}-${pkgLabel}二维码`} compact track={track} />
            </div>
          </>
        ) : (
          <div className="mb-3 rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted">
            链接生成失败，刷新页面再试，或直接在小程序里搜「{park.name}」
          </div>
        )}

        <div className="text-center text-[11px] text-muted">
          价格与规则以官方页面为准，下单前请确认出场时间限制
        </div>
      </div>
    </div>
  );
}

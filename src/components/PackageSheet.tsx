"use client";

import { useMemo, useState } from "react";
import {
  CHANNELS,
  formatDistance,
  yuan,
  type Package,
  type ParkWithPackages,
} from "@/lib/types";

interface Props {
  park: ParkWithPackages;
  pkg: Package;
  onClose: () => void;
  /** 套餐没配专属码时的兜底推广码 */
  promoQrPath?: string;
  /** public = 给访客看（只留扫码买），internal = 推广员工作台 */
  mode?: "public" | "internal";
}

function buildScript(park: ParkWithPackages, pkg: Package) {
  const price = pkg.price > 0 ? `¥${yuan(pkg.price)}` : "价格见码";
  const period = pkg.period ? `（${pkg.period}）` : "";
  const place = park.address ? `\n位置：${park.address}` : "";
  return `${park.name}｜${pkg.name} ${price}${period}${place}\n扫这个码直接选到这个套餐，办完就能用。有问题随时问我。`;
}

function navUrl(park: ParkWithPackages) {
  if (!park.lat || !park.lng) return "";
  const name = encodeURIComponent(`${park.name}停车场`);
  return `https://uri.amap.com/marker?position=${park.lng},${park.lat}&name=${name}&src=web&coordinate=gaode`;
}

export default function PackageSheet({
  park,
  pkg,
  onClose,
  promoQrPath = "",
  mode = "internal",
}: Props) {
  const isPublic = mode === "public";
  const qr = pkg.qrPath || promoQrPath;
  const defaultScript = useMemo(() => buildScript(park, pkg), [park, pkg]);
  const [script, setScript] = useState(defaultScript);
  const [channel, setChannel] = useState<string>("微信群");
  const [detail, setDetail] = useState("");
  const [tip, setTip] = useState("");
  const [saving, setSaving] = useState(false);

  async function copyScript() {
    try {
      await navigator.clipboard.writeText(script);
      setTip("话术已复制");
    } catch {
      setTip("复制失败，请手动选中复制");
    }
  }

  async function copyImage() {
    try {
      const res = await fetch(qr);
      const blob = await res.blob();
      const item = new ClipboardItem({ [blob.type || "image/png"]: blob });
      await navigator.clipboard.write([item]);
      setTip("码图已复制，可直接粘贴发送");
    } catch {
      setTip("当前浏览器不支持复制图片，请长按图片保存");
    }
  }

  async function saveLog() {
    setSaving(true);
    try {
      await fetch("/api/logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parkId: park.id,
          packageId: pkg.id,
          channel,
          channelDetail: detail,
          content: script,
        }),
      });
      setTip("已记到台账");
    } finally {
      setSaving(false);
    }
  }

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
              {!isPublic && pkg.commission > 0 ? ` · 佣金 ¥${yuan(pkg.commission)}` : ""}
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
            {isPublic ? "这个套餐的二维码还没配好，先联系推广员" : "这个套餐还没上传专属码，去车场库补一张"}
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

        {isPublic ? (
          <div className="text-center text-[11px] text-muted">
            价格与规则以官方页面为准，下单前请确认出场时间限制
          </div>
        ) : (
          <>
            <div className="mb-2 flex gap-2">
              <button className="btn-primary flex-1" onClick={copyScript}>
                复制话术
              </button>
              {qr ? (
                <button className="btn-ghost flex-1" onClick={copyImage}>
                  复制码图
                </button>
              ) : null}
              {qr ? (
                <a className="btn-ghost" href={qr} download={`${park.name}-${pkg.name}.png`}>
                  保存
                </a>
              ) : null}
            </div>

            <div className="mb-2">
              <label className="label">话术（可改）</label>
              <textarea
                className="field h-24 resize-none"
                value={script}
                onChange={(e) => setScript(e.target.value)}
              />
            </div>

            <div className="mb-3 grid grid-cols-2 gap-2">
              <div>
                <label className="label">发给谁</label>
                <select className="field" value={channel} onChange={(e) => setChannel(e.target.value)}>
                  {CHANNELS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">群名 / 对方</label>
                <input
                  className="field"
                  value={detail}
                  onChange={(e) => setDetail(e.target.value)}
                  placeholder="如：XX 业主群"
                />
              </div>
            </div>

            <button className="btn-ghost w-full" onClick={saveLog} disabled={saving}>
              {saving ? "记录中…" : "记到台账"}
            </button>
          </>
        )}

        {tip ? <div className="mt-2 text-center text-xs text-brand">{tip}</div> : null}
      </div>
    </div>
  );
}

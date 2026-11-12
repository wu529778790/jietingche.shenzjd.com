"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { adminFetch } from "@/lib/adminClient";
import { INDUSTRIES, PERIODS, yuan, type ParkWithPackages } from "@/lib/types";

const EMPTY_PARK = {
  name: "",
  city: "",
  district: "",
  area: "",
  address: "",
  keywords: "",
  industry: "写字楼",
  audience: "",
  note: "",
};

const EMPTY_PKG = {
  name: "",
  period: "全天",
  price: "",
  commission: "",
  durationDays: "30",
  note: "",
};

const PAGE_SIZE = 10;

export default function ParksPage() {
  const [parks, setParks] = useState<ParkWithPackages[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY_PARK });
  const [pkgFormParkId, setPkgFormParkId] = useState<string | null>(null);
  const [pkgForm, setPkgForm] = useState({ ...EMPTY_PKG });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(PAGE_SIZE),
      });
      if (keyword.trim()) params.set("q", keyword.trim());
      if (onlyMissing) params.set("noCode", "1");
      const res = await adminFetch(`/api/parks?${params.toString()}`);
      const json = await res.json();
      setParks(json.data ?? []);
      setTotal(json.total ?? 0);
    } finally {
      setLoading(false);
    }
  }, [page, keyword, onlyMissing]);

  useEffect(() => {
    const timer = setTimeout(load, 250);
    return () => clearTimeout(timer);
  }, [load]);

  function startNew() {
    setEditingId("new");
    setForm({ ...EMPTY_PARK });
  }

  function startEdit(park: ParkWithPackages) {
    setEditingId(park.id);
    setForm({
      name: park.name,
      city: park.city,
      district: park.district,
      area: park.area,
      address: park.address,
      keywords: park.keywords,
      industry: park.industry || "写字楼",
      audience: park.audience,
      note: park.note,
    });
  }

  async function savePark() {
    if (!form.name.trim()) return;
    if (editingId === "new") {
      await adminFetch("/api/parks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
    } else if (editingId) {
      await adminFetch(`/api/parks/${editingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
    }
    setEditingId(null);
    await load();
  }

  async function removePark(id: string) {
    if (!confirm("删除后该车场下的套餐和码也会一起删掉，确定？")) return;
    await adminFetch(`/api/parks/${id}`, { method: "DELETE" });
    await load();
  }

  async function addPackage(parkId: string) {
    if (!pkgForm.name.trim()) return;
    await adminFetch("/api/packages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        parkId,
        name: pkgForm.name,
        period: pkgForm.period,
        durationDays: Number(pkgForm.durationDays) || 30,
        price: Math.round(Number(pkgForm.price || 0) * 100),
        commission: Math.round(Number(pkgForm.commission || 0) * 100),
        note: pkgForm.note,
      }),
    });
    setPkgFormParkId(null);
    setPkgForm({ ...EMPTY_PKG });
    await load();
  }

  async function removePackage(id: string) {
    if (!confirm("删除这个套餐？")) return;
    await adminFetch(`/api/packages/${id}`, { method: "DELETE" });
    await load();
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold">车场库</div>
          <div className="text-xs text-muted">
            码全部由前台现场生成，不用传图；车场缺官方编码时会退到搜索页码
          </div>
        </div>
        <button className="btn-primary" onClick={startNew}>
          新增车场
        </button>
      </div>

      <div className="card space-y-2 p-3">
        <input
          className="field"
          value={keyword}
          onChange={(e) => {
            setKeyword(e.target.value);
            setPage(1);
          }}
          placeholder="搜车场名 / 地址 / 商圈，如：科技园"
        />
        <div className="flex items-center justify-between text-xs text-muted">
          <label className="flex cursor-pointer items-center gap-1.5">
            <input
              type="checkbox"
              checked={onlyMissing}
              onChange={(e) => {
                setOnlyMissing(e.target.checked);
                setPage(1);
              }}
            />
            只看缺直达码
          </label>
          <span>共 {total} 个车场</span>
        </div>
      </div>

      {editingId ? (
        <div className="card space-y-2 p-3">
          <div className="text-sm font-medium">
            {editingId === "new" ? "新增车场" : "编辑车场"}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="col-span-2">
              <label className="label">车场名称 *</label>
              <input
                className="field"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="如：科技园 A 座停车场"
              />
            </div>
            <div>
              <label className="label">城市</label>
              <input
                className="field"
                value={form.city}
                onChange={(e) => setForm({ ...form, city: e.target.value })}
                placeholder="深圳"
              />
            </div>
            <div>
              <label className="label">区</label>
              <input
                className="field"
                value={form.district}
                onChange={(e) => setForm({ ...form, district: e.target.value })}
                placeholder="南山区"
              />
            </div>
            <div>
              <label className="label">商圈 / 片区</label>
              <input
                className="field"
                value={form.area}
                onChange={(e) => setForm({ ...form, area: e.target.value })}
                placeholder="科技园"
              />
            </div>
            <div>
              <label className="label">业态</label>
              <select
                className="field"
                value={form.industry}
                onChange={(e) => setForm({ ...form, industry: e.target.value })}
              >
                {INDUSTRIES.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-span-2">
              <label className="label">地址 / 地标</label>
              <input
                className="field"
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                placeholder="如：科苑路 15 号，地铁 1 号线 A 口 300 米"
              />
            </div>
            <div className="col-span-2">
              <label className="label">搜索关键词（逗号分隔，方便群友用不同叫法搜到）</label>
              <input
                className="field"
                value={form.keywords}
                onChange={(e) => setForm({ ...form, keywords: e.target.value })}
                placeholder="如：腾讯大厦,科兴,科技园地铁站"
              />
            </div>
            <div>
              <label className="label">适合人群</label>
              <input
                className="field"
                value={form.audience}
                onChange={(e) => setForm({ ...form, audience: e.target.value })}
                placeholder="如：上班族、周边住户"
              />
            </div>
            <div>
              <label className="label">备注</label>
              <input
                className="field"
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
                placeholder="如：夜间 18:00 后可停"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button className="btn-primary flex-1" onClick={savePark}>
              保存
            </button>
            <button className="btn-ghost" onClick={() => setEditingId(null)}>
              取消
            </button>
          </div>
        </div>
      ) : null}

      {loading ? <div className="card p-6 text-center text-sm text-muted">加载中…</div> : null}

      {!loading && parks.length === 0 ? (
        <div className="card p-6 text-center text-sm text-muted">
          {keyword || onlyMissing ? "没搜到符合条件的车场，换个关键词试试" : "车场库还是空的"}
          <Link href="/" className="ml-1 text-brand">
            去前台看看
          </Link>
        </div>
      ) : null}

      {parks.map((park) => (
        <div key={park.id} className="card p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{park.name}</div>
              <div className="mt-0.5 truncate text-xs text-muted">
                {[park.city, park.district, park.area, park.address].filter(Boolean).join(" · ")}
              </div>
              {park.keywords ? (
                <div className="mt-0.5 truncate text-[11px] text-muted">
                  关键词：{park.keywords}
                </div>
              ) : null}
            </div>
            <div className="flex shrink-0 gap-1">
              <button className="btn-ghost px-2 py-1 text-xs" onClick={() => startEdit(park)}>
                编辑
              </button>
              <button
                className="btn-ghost px-2 py-1 text-xs text-red-500"
                onClick={() => removePark(park.id)}
              >
                删除
              </button>
            </div>
          </div>

          <div className="mt-2 space-y-1.5">
            {park.packages.map((pkg) => (
              <div
                key={pkg.id}
                className="flex items-center gap-2 rounded-lg border border-border px-2 py-1.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium">
                    {pkg.name}
                    {pkg.period ? ` · ${pkg.period}` : ""}
                  </div>
                  <div className="text-[11px] text-muted">
                    {pkg.price > 0 ? `¥${yuan(pkg.price)}` : "未填价格"}
                    {pkg.commission > 0 ? ` · 佣金 ¥${yuan(pkg.commission)}` : ""}
                    {pkg.sourcePackageId ? "" : " · 缺官方套餐编码"}
                  </div>
                </div>
                <button
                  className="btn-ghost px-2 py-1 text-xs text-red-500"
                  onClick={() => removePackage(pkg.id)}
                >
                  删
                </button>
              </div>
            ))}

            {pkgFormParkId === park.id ? (
              <div className="rounded-lg border border-brand/40 bg-brand/5 p-2">
                <div className="grid grid-cols-2 gap-2">
                  <div className="col-span-2">
                    <input
                      className="field"
                      placeholder="套餐名，如：夜间月卡"
                      value={pkgForm.name}
                      onChange={(e) => setPkgForm({ ...pkgForm, name: e.target.value })}
                    />
                  </div>
                  <select
                    className="field"
                    value={pkgForm.period}
                    onChange={(e) => setPkgForm({ ...pkgForm, period: e.target.value })}
                  >
                    {PERIODS.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                  <input
                    className="field"
                    placeholder="周期天数（30）"
                    value={pkgForm.durationDays}
                    onChange={(e) => setPkgForm({ ...pkgForm, durationDays: e.target.value })}
                  />
                  <input
                    className="field"
                    placeholder="售价（元）"
                    value={pkgForm.price}
                    onChange={(e) => setPkgForm({ ...pkgForm, price: e.target.value })}
                  />
                  <input
                    className="field"
                    placeholder="佣金（元）"
                    value={pkgForm.commission}
                    onChange={(e) => setPkgForm({ ...pkgForm, commission: e.target.value })}
                  />
                </div>
                <div className="mt-2 flex gap-2">
                  <button className="btn-primary flex-1 py-1 text-xs" onClick={() => addPackage(park.id)}>
                    保存套餐
                  </button>
                  <button className="btn-ghost py-1 text-xs" onClick={() => setPkgFormParkId(null)}>
                    取消
                  </button>
                </div>
              </div>
            ) : (
              <button
                className="w-full rounded-lg border border-dashed border-border py-1.5 text-xs text-muted hover:bg-black/[0.02]"
                onClick={() => {
                  setPkgFormParkId(park.id);
                  setPkgForm({ ...EMPTY_PKG });
                }}
              >
                + 加套餐
              </button>
            )}
          </div>
        </div>
      ))}

      {total > PAGE_SIZE ? (
        <div className="flex items-center justify-between text-xs">
          <button
            className="btn-ghost px-2 py-1"
            onClick={() => setPage((prev) => Math.max(1, prev - 1))}
            disabled={page <= 1 || loading}
          >
            上一页
          </button>
          <span className="text-muted">
            第 {page} / {Math.max(1, Math.ceil(total / PAGE_SIZE))} 页
          </span>
          <button
            className="btn-ghost px-2 py-1"
            onClick={() => setPage((prev) => prev + 1)}
            disabled={page >= Math.ceil(total / PAGE_SIZE) || loading}
          >
            下一页
          </button>
        </div>
      ) : null}
    </div>
  );
}

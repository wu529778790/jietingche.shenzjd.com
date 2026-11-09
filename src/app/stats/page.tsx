"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { yuan } from "@/lib/types";

interface StatRow {
  park: { id: string; name: string; district: string; area: string };
  views: number;
  orders: number;
  commission: number;
  conversion: number;
}

interface PackageOption {
  id: string;
  name: string;
  parkId: string;
  parkName: string;
  price: number;
  period: string;
  typeLabel: string;
}

function today() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function StatsPage() {
  const [rows, setRows] = useState<StatRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [options, setOptions] = useState<PackageOption[]>([]);
  const [pkgQuery, setPkgQuery] = useState("");
  const [form, setForm] = useState({
    packageId: "",
    // 日期留到挂载后再填，避免预渲染阶段读到 unstable 的当前时间
    statDate: "",
    views: "",
    orders: "",
    commission: "",
  });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/stats");
      const json = await res.json();
      setRows(json.data?.parks ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setForm((prev) => (prev.statDate ? prev : { ...prev, statDate: today() }));
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ limit: "30" });
      if (pkgQuery.trim()) params.set("q", pkgQuery.trim());
      fetch(`/api/packages?${params.toString()}`)
        .then((res) => res.json())
        .then((json) => setOptions(json.data ?? []))
        .catch(() => undefined);
    }, 250);
    return () => clearTimeout(timer);
  }, [pkgQuery]);

  const selected = useMemo(
    () => options.find((item) => item.id === form.packageId) ?? null,
    [options, form.packageId],
  );

  async function submit() {
    if (!form.packageId) return;
    setSaving(true);
    try {
      await fetch("/api/stats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parkId: selected?.parkId ?? "",
          packageId: form.packageId,
          statDate: form.statDate,
          views: Number(form.views || 0),
          orders: Number(form.orders || 0),
          commission: Math.round(Number(form.commission || 0) * 100),
        }),
      });
      setForm({ ...form, views: "", orders: "", commission: "" });
      await load();
    } finally {
      setSaving(false);
    }
  }

  const totalOrders = rows.reduce((sum, row) => sum + row.orders, 0);
  const totalCommission = rows.reduce((sum, row) => sum + row.commission, 0);
  const totalViews = rows.reduce((sum, row) => sum + row.views, 0);

  return (
    <div className="space-y-3">
      <div>
        <div className="text-sm font-semibold">对账</div>
        <div className="text-xs text-muted">
          把分享中心里的「浏览 / 下单」按套餐抄进来，就能看出哪个车场最好卖
        </div>
      </div>

      <div className="card p-3">
        <div className="mb-2 text-sm font-medium">录一条数据</div>
        <div className="grid grid-cols-2 gap-2">
          <div className="col-span-2">
            <label className="label">找套餐</label>
            <input
              className="field mb-2"
              value={pkgQuery}
              onChange={(e) => setPkgQuery(e.target.value)}
              placeholder="搜车场或套餐名，如：万象城 夜间"
            />
            <select
              className="field"
              value={form.packageId}
              onChange={(e) => setForm({ ...form, packageId: e.target.value })}
            >
              <option value="">{options.length ? "选择套餐" : "没有匹配的套餐"}</option>
              {options.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.parkName} · {item.name}
                  {item.price > 0 ? `（¥${yuan(item.price)}）` : ""}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">日期</label>
            <input
              type="date"
              className="field"
              value={form.statDate}
              onChange={(e) => setForm({ ...form, statDate: e.target.value })}
            />
          </div>
          <div>
            <label className="label">浏览人数</label>
            <input
              className="field"
              value={form.views}
              onChange={(e) => setForm({ ...form, views: e.target.value })}
              placeholder="0"
            />
          </div>
          <div>
            <label className="label">下单数</label>
            <input
              className="field"
              value={form.orders}
              onChange={(e) => setForm({ ...form, orders: e.target.value })}
              placeholder="0"
            />
          </div>
          <div>
            <label className="label">佣金（元）</label>
            <input
              className="field"
              value={form.commission}
              onChange={(e) => setForm({ ...form, commission: e.target.value })}
              placeholder="0"
            />
          </div>
        </div>
        <button className="btn-primary mt-2 w-full" onClick={submit} disabled={saving}>
          {saving ? "保存中…" : "保存"}
        </button>
      </div>

      <div className="card overflow-hidden">
        <div className="grid grid-cols-3 divide-x divide-border border-b border-border">
          <div className="p-3 text-center">
            <div className="text-lg font-semibold">{totalViews}</div>
            <div className="text-[11px] text-muted">总浏览</div>
          </div>
          <div className="p-3 text-center">
            <div className="text-lg font-semibold">{totalOrders}</div>
            <div className="text-[11px] text-muted">总下单</div>
          </div>
          <div className="p-3 text-center">
            <div className="text-lg font-semibold">¥{yuan(totalCommission)}</div>
            <div className="text-[11px] text-muted">已结佣金</div>
          </div>
        </div>

        {loading ? (
          <div className="p-6 text-center text-sm text-muted">加载中…</div>
        ) : rows.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted">还没有数据</div>
        ) : (
          <div className="divide-y divide-border">
            {rows.map((row) => (
              <div key={row.park.id} className="flex items-center gap-2 p-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{row.park.name}</div>
                  <div className="text-[11px] text-muted">
                    {[row.park.district, row.park.area].filter(Boolean).join(" · ")}
                  </div>
                </div>
                <div className="text-right text-xs">
                  <div>
                    浏览 {row.views} · 下单 {row.orders}
                  </div>
                  <div className="text-muted">
                    转化 {(row.conversion * 100).toFixed(0)}% · ¥{yuan(row.commission)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

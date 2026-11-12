"use client";

import { useCallback, useEffect, useState } from "react";
import { adminFetch } from "@/lib/adminClient";
import type { TrafficReport } from "@/lib/analytics";

const RANGES = [1, 7, 30, 90];

const UA_LABEL: Record<string, string> = {
  browser: "浏览器",
  wechat: "微信",
  searchbot: "搜索引擎",
  scraper: "采集器（已拦）",
  bot: "其它爬虫",
  unknown: "未知/脚本",
};

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function ratio(part: number, total: number): string {
  if (!total) return "—";
  return `${((part / total) * 100).toFixed(1)}%`;
}

export default function TrafficPage() {
  const [days, setDays] = useState(7);
  const [data, setData] = useState<TrafficReport | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (range: number) => {
    try {
      const res = await adminFetch(`/api/analytics?days=${range}`);
      const json = await res.json();
      setData(json?.data ?? null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(days);
  }, [days, load]);

  // 「今天」由服务端给（北京时间），前端自己算 Date.now() 会被构建期判成不稳定值
  const today = data?.daily.find((row) => row.day === data.today);
  const sum = data?.daily.reduce(
    (acc, row) => ({
      pv: acc.pv + row.pv,
      uv: acc.uv + row.uv,
      parkPv: acc.parkPv + row.parkPv,
      sheet: acc.sheet + row.sheet,
      save: acc.save + row.save,
      search: acc.search + row.search,
      blocked: acc.blocked + row.blocked,
    }),
    { pv: 0, uv: 0, parkPv: 0, sheet: 0, save: 0, search: 0, blocked: 0 },
  );

  return (
    <div className="space-y-3">
      <div className="card p-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-sm font-medium">流量与事件</div>
            <div className="mt-0.5 text-[11px] leading-relaxed text-muted">
              页面请求记在服务端（爬虫也算），二维码事件来自前端埋点；
              扫码之后的动作发生在捷停车官方小程序，这里看不到。
            </div>
          </div>
          <div className="flex shrink-0 gap-1">
            {RANGES.map((range) => (
              <button
                key={range}
                type="button"
                onClick={() => {
                  if (range === days) return;
                  setLoading(true);
                  setDays(range);
                }}
                className={`rounded-lg px-2 py-1 text-xs transition-colors ${
                  days === range ? "bg-brand/10 font-medium text-brand" : "text-muted hover:bg-black/5"
                }`}
              >
                {range === 1 ? "今天" : `${range} 天`}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading && !data ? (
        <div className="card p-6 text-center text-sm text-muted">加载中…</div>
      ) : !data || !sum ? (
        <div className="card p-6 text-center text-sm text-muted">还没有日志</div>
      ) : (
        <>
          <div className="card overflow-hidden">
            <div className="grid grid-cols-3 divide-x divide-border border-b border-border">
              <div className="p-3 text-center">
                <div className="text-lg font-semibold">{today?.pv ?? 0}</div>
                <div className="text-[11px] text-muted">今日页面请求</div>
              </div>
              <div className="p-3 text-center">
                <div className="text-lg font-semibold">{today?.uv ?? 0}</div>
                <div className="text-[11px] text-muted">今日独立来源</div>
              </div>
              <div className="p-3 text-center">
                <div className="text-lg font-semibold">{sum.blocked}</div>
                <div className="text-[11px] text-muted">
                  {days === 1 ? "今日" : `${days} 天`}拦下的采集
                </div>
              </div>
            </div>
            <div className="grid grid-cols-3 divide-x divide-border">
              <div className="p-3 text-center">
                <div className="text-lg font-semibold">{sum.sheet}</div>
                <div className="text-[11px] text-muted">点开套餐码</div>
              </div>
              <div className="p-3 text-center">
                <div className="text-lg font-semibold">{sum.save}</div>
                <div className="text-[11px] text-muted">保存二维码图</div>
              </div>
              <div className="p-3 text-center">
                <div className="text-lg font-semibold">{sum.search}</div>
                <div className="text-[11px] text-muted">有效搜索</div>
              </div>
            </div>
          </div>

          <div className="card p-3">
            <div className="mb-1 text-sm font-medium">二维码链路</div>
            <div className="text-[11px] leading-relaxed text-muted">
              车场页打开即出码，所以「车场页曝光」就是码被展示的次数；
              微信内长按识别、iOS 存相册都点不到按钮，真实拿码人数一定大于「保存」这一列。
            </div>
            <div className="mt-2 space-y-1.5 text-xs">
              <div className="flex items-center justify-between">
                <span>车场页曝光（已出码）</span>
                <span className="font-medium">{sum.parkPv}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>首页点开套餐码弹层</span>
                <span className="font-medium">
                  {sum.sheet}
                  <span className="ml-1 text-[11px] text-muted">
                    {ratio(sum.sheet, sum.pv)}
                  </span>
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>点了「保存/下载二维码」</span>
                <span className="font-medium">
                  {sum.save}
                  <span className="ml-1 text-[11px] text-muted">
                    {ratio(sum.save, sum.parkPv + sum.sheet)}
                  </span>
                </span>
              </div>
              <div className="flex items-center justify-between text-muted">
                <span>扫码 / 进入官方小程序</span>
                <span className="text-[11px]">拿不到（跳第三方）</span>
              </div>
            </div>
          </div>

          <div className="card overflow-hidden">
            <div className="border-b border-border px-3 py-2 text-sm font-medium">
              请求来源构成（{days === 1 ? "今天" : `${days} 天`}）
            </div>
            <div className="divide-y divide-border">
              {data.ua.map((row) => (
                <div key={row.cls} className="flex items-center gap-2 px-3 py-2 text-xs">
                  <div className="min-w-0 flex-1 truncate">{UA_LABEL[row.cls] ?? row.cls}</div>
                  <div className="text-muted">{row.uv} 个来源</div>
                  <div className="w-16 text-right font-medium">{row.hits}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="card overflow-hidden">
            <div className="border-b border-border px-3 py-2 text-sm font-medium">
              请求最多的来源（怀疑在爬就看这里）
            </div>
            <div className="divide-y divide-border">
              {data.sources.map((row) => (
                <div key={row.ipHash} className="px-3 py-2 text-xs">
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">
                        {row.prefix || "未知网段"}
                        {row.direct > 0 ? (
                          <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] text-amber-700">
                            直连 {row.direct}
                          </span>
                        ) : null}
                      </div>
                      <div className="truncate text-[11px] text-muted">
                        {UA_LABEL[row.uaClass] ?? row.uaClass} · {row.sample || "无 UA"}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-medium">{row.hits}</div>
                      <div className="text-[10px] text-muted">{fmtTime(row.lastTs)}</div>
                    </div>
                  </div>
                </div>
              ))}
              {data.sources.length === 0 ? (
                <div className="px-3 py-4 text-center text-xs text-muted">还没有数据</div>
              ) : null}
            </div>
            {data.directHits > 0 ? (
              <div className="border-t border-border px-3 py-2 text-[11px] text-amber-700">
                其中 {data.directHits} / {data.totalHits} 次请求没带 EdgeOne 特征头
                ——要么是本机健康检查，要么有人绕过 CDN 直连了源站。
              </div>
            ) : null}
          </div>

          <div className="card overflow-hidden">
            <div className="border-b border-border px-3 py-2 text-sm font-medium">热门页面</div>
            <div className="divide-y divide-border">
              {data.pages.slice(0, 15).map((row) => (
                <div key={row.path} className="flex items-center gap-2 px-3 py-1.5 text-xs">
                  {/* 显示中文名，原始路径（含 URL 编码）挂在 title 上，排查时悬浮可见 */}
                  <div className="min-w-0 flex-1 truncate" title={row.path}>
                    {row.label}
                  </div>
                  <div className="shrink-0 text-muted">{row.uv} 来源</div>
                  <div className="w-12 shrink-0 text-right font-medium">{row.pv}</div>
                </div>
              ))}
              {data.pages.length === 0 ? (
                <div className="px-3 py-4 text-center text-xs text-muted">还没有数据</div>
              ) : null}
            </div>
          </div>

          <div className="card overflow-hidden">
            <div className="border-b border-border px-3 py-2 text-sm font-medium">搜索词</div>
            <div className="divide-y divide-border">
              {data.queries.map((row) => (
                <div key={row.q} className="flex items-center gap-2 px-3 py-1.5 text-xs">
                  <div className="min-w-0 flex-1 truncate">{row.q}</div>
                  <div className="w-12 shrink-0 text-right font-medium">{row.n}</div>
                </div>
              ))}
              {data.queries.length === 0 ? (
                <div className="px-3 py-4 text-center text-xs text-muted">还没有搜索</div>
              ) : null}
            </div>
          </div>

          <div className="card overflow-hidden">
            <div className="border-b border-border px-3 py-2 text-sm font-medium">每日趋势</div>
            <div className="grid grid-cols-6 gap-1 border-b border-border px-3 py-1.5 text-[10px] text-muted">
              <div>日期</div>
              <div className="text-right">PV</div>
              <div className="text-right">UV</div>
              <div className="text-right">出码</div>
              <div className="text-right">点码</div>
              <div className="text-right">拦截</div>
            </div>
            <div className="divide-y divide-border">
              {[...data.daily].reverse().map((row) => (
                <div key={row.day} className="grid grid-cols-6 gap-1 px-3 py-1.5 text-xs">
                  <div className="text-muted">{row.day.slice(5)}</div>
                  <div className="text-right font-medium">{row.pv}</div>
                  <div className="text-right">{row.uv}</div>
                  <div className="text-right">{row.parkPv}</div>
                  <div className="text-right">{row.sheet}</div>
                  <div className="text-right text-amber-700">{row.blocked || ""}</div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

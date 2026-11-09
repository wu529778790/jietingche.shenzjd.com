"use client";

import { useCallback, useEffect, useState } from "react";
import { adminFetch } from "@/lib/adminClient";
import type { OutreachLogRow } from "@/lib/adminTypes";

function formatTime(ts: number) {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function LogsPage() {
  const [logs, setLogs] = useState<OutreachLogRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await adminFetch("/api/logs");
      const json = await res.json();
      setLogs(json.data ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function remove(id: string) {
    await adminFetch(`/api/logs/${id}`, { method: "DELETE" });
    await load();
  }

  return (
    <div className="space-y-3">
      <div>
        <div className="text-sm font-semibold">投放台账</div>
        <div className="text-xs text-muted">每次发码都留一条，回头才能看出哪个渠道出单</div>
      </div>

      {loading ? <div className="card p-6 text-center text-sm text-muted">加载中…</div> : null}

      {!loading && logs.length === 0 ? (
        <div className="card p-6 text-center text-sm text-muted">
          还没有记录，去车场库发一次码就会自动记上
        </div>
      ) : null}

      {logs.map((log) => (
        <div key={log.id} className="card p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">
                {log.parkName || "（车场已删）"}
                {log.packageName ? (
                  <span className="ml-1 text-xs font-normal text-muted">{log.packageName}</span>
                ) : null}
              </div>
              <div className="mt-0.5 text-xs text-muted">
                {formatTime(log.createdAt)} · {log.channel || "未填渠道"}
                {log.channelDetail ? ` · ${log.channelDetail}` : ""}
              </div>
            </div>
            <button
              className="btn-ghost shrink-0 px-2 py-1 text-xs text-red-500"
              onClick={() => remove(log.id)}
            >
              删
            </button>
          </div>
          {log.content ? (
            <div className="mt-2 line-clamp-2 rounded-lg bg-black/[0.02] p-2 text-xs text-muted">
              {log.content}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

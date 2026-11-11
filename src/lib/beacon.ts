"use client";

/**
 * 前端埋点（极简）。
 *
 * sendBeacon 优先：不占连接、不阻塞交互，页面正要跳走/关闭时也能发出去；
 * 老浏览器降级 fetch + keepalive。任何失败都静默——埋点绝不能影响用户操作。
 *
 * 只发事件名和业务 id，不发任何用户标识：服务端自己按 IP 哈希算 UV。
 */
export type BeaconEvent = "sheet_open" | "qr_save" | "search";

export interface BeaconPayload {
  /** 业务对象：车场官方编码 */
  park?: string;
  /** 套餐的官方 source_package_id */
  pkg?: string;
  /** 搜索词 */
  q?: string;
  /** 结果数等计数 */
  n?: number;
}

export function beacon(event: BeaconEvent, payload: BeaconPayload = {}): void {
  if (typeof window === "undefined") return;
  const body = JSON.stringify({ e: event, path: window.location.pathname, ...payload });
  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/log", new Blob([body], { type: "application/json" }));
      return;
    }
  } catch {
    /* 走下面的 fetch */
  }
  void fetch("/api/log", {
    method: "POST",
    body,
    keepalive: true,
    headers: { "content-type": "application/json" },
  }).catch(() => {});
}

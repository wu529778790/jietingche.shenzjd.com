"use client";

import { useEffect } from "react";

/**
 * 注册 Service Worker（public/sw.js），让站点能被「添加到主屏幕」并支持断网兜底。
 *
 * 只在生产构建里注册：开发环境开着 SW，Turbopack 的 HMR 资源会被缓存住，
 * 改一行代码要手动清缓存才能看到效果，得不偿失。
 *
 * 注册放到 load 之后：手机上 SW 脚本也要排队下载，别和首屏抢带宽。
 * 注册完顺手 update() 一次，配合 sw.js 的 skipWaiting，发版后下次打开就是新版。
 */
export default function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    const register = () => {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .then((registration) => {
          void registration.update();
        })
        .catch(() => {
          // 注册失败不影响正常浏览（隐私模式、禁用 SW 的浏览器都会失败）
        });
    };

    if (document.readyState === "complete") {
      register();
      return;
    }

    window.addEventListener("load", register, { once: true });
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}

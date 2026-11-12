import type { Metadata } from "next";
import { BrandPin } from "@/components/BrandMark";
import { SITE_NAME } from "@/lib/seo";

/**
 * 离线兜底页，由 Service Worker 预缓存（见 public/sw.js）。
 *
 * 样式全部写成内联——断网时 globals.css 大概率没在缓存里，
 * 类名一个都不会生效；只有行内样式能保证这页仍然可读。
 */
export const metadata: Metadata = {
  title: "当前没有网络",
  robots: { index: false, follow: false },
};

export default function OfflinePage() {
  return (
    <div
      style={{
        minHeight: "60vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        padding: "40px 24px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 24 }}>
        <BrandPin style={{ width: 22, height: 22 }} pinColor="#1b6bff" letterColor="#ffffff" />
        <span
          style={{
            fontSize: 15,
            fontWeight: 600,
            letterSpacing: "0.18em",
            color: "#10141c",
          }}
        >
          {SITE_NAME}
        </span>
      </div>

      <div style={{ fontSize: 19, fontWeight: 600, color: "#10141c" }}>当前没有网络</div>
      <div
        style={{
          marginTop: 10,
          fontSize: 13,
          lineHeight: 1.7,
          color: "#6b7280",
          maxWidth: 320,
        }}
      >
        连上网络后刷新一下，就能继续找附近能包月的停车场。
      </div>

      {/* 刻意用裸 <a> 而不是 next/link：离线时 Link 的客户端跳转会去拉 RSC 然后报错，
          裸 <a> 是整页导航，正好落进 SW 的 navigate 分支，网络没恢复也能吃到缓存的首页 */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a
        href="/"
        style={{
          marginTop: 22,
          display: "inline-block",
          padding: "9px 18px",
          borderRadius: 10,
          background: "#1b6bff",
          color: "#ffffff",
          fontSize: 13,
          fontWeight: 600,
          textDecoration: "none",
        }}
      >
        重新加载
      </a>
    </div>
  );
}

import type { MetadataRoute } from "next";
import { SITE_NAME, SITE_TAGLINE } from "@/lib/seo";

/**
 * PWA 清单。Next 会自动在 <head> 里注入 <link rel="manifest">，不用手写。
 *
 * 图标三张：192 / 512 是 any（浏览器按需自己遮罩），maskable-512 的针缩到 52%
 * 塞进安全区，安卓自适应图标/任务栏圆形裁切时才不会被切掉。
 * 出图源文件见 scripts/brand/og-card.html。
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${SITE_NAME} · ${SITE_TAGLINE}`,
    short_name: SITE_NAME,
    description: "按位置挑最近、最省的停车场月卡，扫码直接在捷停车官方小程序办理。",
    lang: "zh-CN",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f5f6f8",
    theme_color: "#1b6bff",
    categories: ["navigation", "travel"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icons/maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}

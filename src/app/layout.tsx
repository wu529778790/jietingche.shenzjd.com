import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { OG_IMAGE, SITE_NAME, SITE_TAGLINE, SITE_URL } from "@/lib/seo";
import "./globals.css";

const TITLE_DEFAULT = `${SITE_NAME} · ${SITE_TAGLINE}，车场月卡秒查`;
const DESCRIPTION =
  "按月价对比 7816 个车场的月卡、季卡、夜间套餐，按位置和需求筛，选好套餐扫码直接在捷停车官方小程序办理。";

export const metadata: Metadata = {
  // 所有相对 canonical / og:url 都以线上域名为准，避免构建期解析成 localhost
  metadataBase: new URL(SITE_URL),
  title: {
    default: TITLE_DEFAULT,
    template: `%s｜${SITE_NAME}`,
  },
  description: DESCRIPTION,
  keywords: [
    "停车月卡",
    "停车场月租",
    "夜间停车套餐",
    "停车优惠",
    "月卡多少钱",
    "停车场包月",
  ],
  applicationName: SITE_NAME,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    locale: "zh_CN",
    title: TITLE_DEFAULT,
    description: DESCRIPTION,
    url: SITE_URL,
    images: [
      {
        url: OG_IMAGE,
        width: 1200,
        height: 630,
        alt: `${SITE_NAME} · ${SITE_TAGLINE}`,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE_DEFAULT,
    description: DESCRIPTION,
    images: [OG_IMAGE],
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  // 和图标、页头同一个品牌蓝，安卓 Chrome 地址栏跟着变
  themeColor: "#1b6bff",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <main className="mx-auto w-full max-w-3xl flex-1 px-3 py-4">{children}</main>
      </body>
    </html>
  );
}

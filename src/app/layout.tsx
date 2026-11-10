import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { SITE_NAME, SITE_URL } from "@/lib/seo";
import "./globals.css";

export const metadata: Metadata = {
  // 所有相对 canonical / og:url 都以线上域名为准，避免构建期解析成 localhost
  metadataBase: new URL(SITE_URL),
  title: {
    default: "找停车优惠 · 车场月卡秒查",
    template: `%s｜${SITE_NAME}`,
  },
  description:
    "按位置和需求找停车场月卡、季卡、夜间套餐，按折合月价对比，选好套餐扫码直接在捷停车官方小程序办理。",
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
    title: "找停车优惠 · 车场月卡秒查",
    description:
      "按位置和需求找停车场月卡、季卡、夜间套餐，按折合月价对比，扫码直接在官方小程序办理。",
    url: SITE_URL,
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
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

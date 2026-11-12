import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cacheLife } from "next/cache";
import CityLanding from "@/components/seo/CityLanding";
import { loadCity } from "@/lib/citySeo";
import { listCityStats, listParksByArea } from "@/lib/seoRepo";
import {
  LANDING_CACHE_LIFE,
  LANDING_PAGE_SIZE,
  SITE_NAME,
  absoluteUrl,
  cityPath,
  cityShort,
  monthlyText,
} from "@/lib/seo";

interface PageProps {
  params: Promise<{ city: string }>;
}

/**
 * 落地页数据用 use cache 缓存（套餐/列表 5 分钟新鲜度可接受），渲染仍是阻塞式
 * （instant=false，SEO 要全量 HTML）。缓存头不在页面层解决：阻塞式路由恒发
 * no-store（见 nextjs blocking-prerender-dynamic），拿不到 s-maxage，
 * 由 proxy.ts 统一给 /city、/park 下发可被 EdgeOne 缓存的 Cache-Control。
 * 背景：出口带宽 4-5Mbps，每请求回源 326KB 是 2026-11 性能排查出的瓶颈。
 */
export const instant = false;

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  "use cache";
  cacheLife(LANDING_CACHE_LIFE);
  const { city } = await params;
  const data = await loadCity(city);
  if (!data) return { title: "城市暂无数据", robots: { index: false } };

  const short = cityShort(data.city);
  // 标题里塞价格锚点：SERP 上「1509 个车场最低 ¥25/月」比「价格与车场」更容易被点
  const title = data.minMonthly
    ? `${short}停车月卡多少钱？${data.parkCount} 个车场最低 ${monthlyText(data.minMonthly)}/月`
    : `${short}停车月卡价格｜${data.parkCount} 个车场可查`;
  const description =
    `${short}有 ${data.parkCount} 个停车场能办月卡，共 ${data.packageCount} 个在售套餐，` +
    `最低 ${monthlyText(data.minMonthly)}/月起，覆盖${data.districts
      .slice(0, 4)
      .map((item) => item.name)
      .join("、")}等区域。按位置挑最近最省的那个，扫码在捷停车官方小程序办理。`;

  return {
    title,
    description,
    alternates: { canonical: cityPath(data.city) },
    openGraph: {
      type: "website",
      title: `${title}｜${SITE_NAME}`,
      description,
      url: absoluteUrl(cityPath(data.city)),
    },
  };
}

export default async function CityPage({ params }: PageProps) {
  "use cache";
  cacheLife(LANDING_CACHE_LIFE);
  const { city } = await params;
  const data = await loadCity(city);
  if (!data) notFound();

  const [parks, otherCities] = await Promise.all([
    listParksByArea(data.city, "", LANDING_PAGE_SIZE),
    listCityStats(80),
  ]);

  const siblings = otherCities.filter((item) => item.city !== data.city).slice(0, 12);

  return <CityLanding data={data} parks={parks} page={1} siblings={siblings} />;
}

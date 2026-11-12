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
  cityPagePath,
  cityPath,
  cityShort,
} from "@/lib/seo";

interface PageProps {
  params: Promise<{ city: string; page: string }>;
}

/**
 * 城市页的车场分页。
 *
 * 为什么要有：深圳 1500 多个车场，第 1 页只列 40 个，后面 1400 多个车场页
 * 全靠 sitemap 发现，拿不到站内权重。分页把「城市 → 车场」这条链补全。
 *
 * 为什么 noindex：这些页和第 1 页共用标题和导语，只是列表窗口不同，
 * 让它们进索引等于给自己造几千个近似页。noindex + follow 保证
 * 爬虫照样顺着链接走到每个车场页，但不占索引配额、不稀释页面质量。
 *
 * 路径分页而不是 ?page=N：query 分页在 Next 16 的 cacheComponents 下要读
 * searchParams，会把这页推出缓存边界，而路径参数天然是可缓存的。
 *
 * 页码越界一律夹到有效范围，不抛 notFound：PPR 下 shell 先吐出去，
 * 渲染到一半的 notFound() 改不了状态码，只会得到一个「200 的 404 页」，
 * 那比多渲染一页更糟。第 1 页的 canonical 指回城市页，重复内容也就化解了。
 */
export const instant = false;

function clampPage(raw: string, totalPages: number): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) return 1;
  return Math.min(value, totalPages);
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  "use cache";
  cacheLife(LANDING_CACHE_LIFE);
  const { city, page } = await params;
  const data = await loadCity(city);
  if (!data) return { title: "城市暂无数据", robots: { index: false, follow: true } };

  const totalPages = Math.max(1, Math.ceil(data.parkCount / LANDING_PAGE_SIZE));
  const pageNum = clampPage(page, totalPages);
  const short = cityShort(data.city);
  const url = absoluteUrl(pageNum <= 1 ? cityPath(data.city) : cityPagePath(data.city, pageNum));

  return {
    title: `${short}停车月卡车场（第 ${pageNum} 页）`,
    description: `${short}按折合月价排序的第 ${pageNum} 页车场列表，共 ${data.parkCount} 个能办月卡的停车场。`,
    alternates: { canonical: url },
    robots: { index: false, follow: true },
    openGraph: {
      type: "website",
      title: `${short}停车月卡车场（第 ${pageNum} 页）｜${SITE_NAME}`,
      url,
    },
  };
}

export default async function CityPageN({ params }: PageProps) {
  "use cache";
  cacheLife(LANDING_CACHE_LIFE);
  const { city, page } = await params;

  const data = await loadCity(city);
  if (!data) notFound();

  const totalPages = Math.max(1, Math.ceil(data.parkCount / LANDING_PAGE_SIZE));
  const pageNum = clampPage(page, totalPages);

  const [parks, otherCities] = await Promise.all([
    listParksByArea(data.city, "", LANDING_PAGE_SIZE, (pageNum - 1) * LANDING_PAGE_SIZE),
    listCityStats(80),
  ]);

  const siblings = otherCities.filter((item) => item.city !== data.city).slice(0, 12);

  return <CityLanding data={data} parks={parks} page={pageNum} siblings={siblings} />;
}

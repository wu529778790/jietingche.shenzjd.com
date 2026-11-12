import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { cacheLife } from "next/cache";
import { cache } from "react";
import Breadcrumb from "@/components/seo/Breadcrumb";
import AreaGrid from "@/components/seo/AreaGrid";
import ParkList from "@/components/seo/ParkList";
import { getDistrictSeo, listParksByArea } from "@/lib/seoRepo";
import {
  absoluteUrl,
  breadcrumbJsonLd,
  cityPath,
  cityShort,
  districtPath,
  LANDING_CACHE_LIFE,
  LANDING_PAGE_SIZE,
  monthlyText,
  parksJsonLd,
  SITE_NAME,
} from "@/lib/seo";

interface PageProps {
  params: Promise<{ city: string; district: string }>;
}

/** 同城市页：数据 use cache + proxy 统一下发缓存头（见城市页注释） */
export const instant = false;

const loadDistrict = cache(async (cityRaw: string, districtRaw: string) => {
  const cityCandidates = [decodeURIComponent(cityRaw)];
  if (!cityCandidates[0].endsWith("市")) cityCandidates.push(`${cityCandidates[0]}市`);

  for (const city of cityCandidates) {
    const data = await getDistrictSeo(city, decodeURIComponent(districtRaw));
    if (data.parkCount > 0) {
      const parks = await listParksByArea(data.city, data.district, LANDING_PAGE_SIZE);
      return { ...data, parks };
    }
  }
  return null;
});

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  "use cache";
  cacheLife(LANDING_CACHE_LIFE);
  const { city, district } = await params;
  const data = await loadDistrict(city, district);
  if (!data) return { title: "区域暂无数据", robots: { index: false } };

  const area = `${cityShort(data.city)}${data.district}`;
  const title = data.minMonthly
    ? `${area}停车月卡多少钱？${data.parkCount} 个车场最低 ${monthlyText(data.minMonthly)}/月`
    : `${area}停车月卡价格｜${data.parkCount} 个车场`;
  const description =
    `${area}有 ${data.parkCount} 个停车场能办月卡，共 ${data.packageCount} 个在售套餐，` +
    `最低 ${monthlyText(data.minMonthly)}/月起，夜间/全天可选。按折合月价排序，扫码在捷停车官方小程序办理。`;

  return {
    title,
    description,
    alternates: { canonical: districtPath(data.city, data.district) },
    openGraph: {
      type: "website",
      title: `${title}｜${SITE_NAME}`,
      description,
      url: absoluteUrl(districtPath(data.city, data.district)),
    },
  };
}

export default async function DistrictPage({ params }: PageProps) {
  "use cache";
  cacheLife(LANDING_CACHE_LIFE);
  const { city, district } = await params;
  const data = await loadDistrict(city, district);
  if (!data) notFound();

  const short = cityShort(data.city);
  const area = `${short}${data.district}`;
  const crumbs = [
    { name: SITE_NAME, path: "/" },
    { name: `${short}停车月卡`, path: cityPath(data.city) },
    { name: data.district, path: districtPath(data.city, data.district) },
  ];

  return (
    <article className="space-y-3">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify([
            breadcrumbJsonLd(crumbs),
            parksJsonLd(data.parks.slice(0, 10), data.city),
          ]).replace(/</g, "\\u003c"),
        }}
      />

      <Breadcrumb items={crumbs} />

      <header className="card p-4">
        <h1 className="text-lg font-semibold leading-snug">{area}停车月卡多少钱</h1>
        <p className="mt-1.5 text-sm leading-relaxed">
          {area}目前有 <b>{data.parkCount}</b> 个停车场、<b>{data.packageCount}</b>{" "}
          个在售停车套餐，月卡最低{" "}
          <b className="text-price">{monthlyText(data.minMonthly)}/月</b>。
          列表按折合月价从低到高排，夜间和全天套餐分开标注，扫码即可办理。
        </p>
        <p className="mt-2 text-[11px] leading-relaxed text-muted">
          价格来自捷停车官方选品池，会随官方调整；本站不代收费用，付款在官方页面完成。
        </p>
      </header>

      <section className="card overflow-hidden" aria-labelledby="parks-title">
        <h2 id="parks-title" className="border-b border-border px-3 py-2.5 text-sm font-semibold">
          {area}可办月卡的车场
        </h2>
        <ParkList parks={data.parks} />
        <div className="border-t border-border px-3 py-2 text-[11px] text-muted">
          共 {data.parkCount} 个车场，按折合月价排序，默认展示前 {data.parks.length} 个。
        </div>
      </section>

      <section className="card p-4" aria-labelledby="tips-title">
        <h2 id="tips-title" className="text-sm font-semibold">
          在{area}选月卡，先看这三点
        </h2>
        <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-muted">
          <li>· 先量一下从车场步行到目的地的时间，比多省 20 块更值。</li>
          <li>· 只在晚上停车就选夜间套餐，规则里的时间段一定要看清。</li>
          <li>· 季卡/年卡折合月价更低，但要确认能否转租和退款。</li>
        </ul>
      </section>

      {data.districts.length ? (
        <section className="card p-4" aria-labelledby="siblings-title">
          <h2 id="siblings-title" className="text-sm font-semibold">
            {short}其他区域
          </h2>
          <div className="mt-2">
            <AreaGrid
              items={data.districts.slice(0, 20).map((item) => ({
                name: item.name,
                href: districtPath(data.city, item.name),
                count: item.parkCount,
              }))}
            />
          </div>
        </section>
      ) : null}

      <div className="pb-2 text-center text-[11px] text-muted">
        <Link href={cityPath(data.city)} className="hover:text-brand">
          看{short}全部车场
        </Link>
        <span className="mx-1.5">·</span>
        <Link href="/" className="hover:text-brand">
          回到首页按位置搜索
        </Link>
      </div>
    </article>
  );
}

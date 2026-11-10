import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { cacheLife } from "next/cache";
import { cache } from "react";
import Breadcrumb from "@/components/seo/Breadcrumb";
import AreaGrid from "@/components/seo/AreaGrid";
import ParkList from "@/components/seo/ParkList";
import {
  getCitySeo,
  listCityStats,
  listParksByArea,
  type CitySeo,
} from "@/lib/seoRepo";
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

/** 兼容「/city/深圳」这种不带「市」的写法；generateMetadata 与页面共用一次查询 */
const loadCity = cache(async (raw: string): Promise<CitySeo | null> => {
  const name = decodeURIComponent(raw);
  const direct = await getCitySeo(name);
  if (direct.parkCount > 0) return direct;
  if (!name.endsWith("市")) {
    const withSuffix = await getCitySeo(`${name}市`);
    if (withSuffix.parkCount > 0) return withSuffix;
  }
  return null;
});

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  "use cache";
  cacheLife(LANDING_CACHE_LIFE);
  const { city } = await params;
  const data = await loadCity(city);
  if (!data) return { title: "城市暂无数据", robots: { index: false } };

  const short = cityShort(data.city);
  const title = `${short}停车月卡价格｜${data.parkCount} 个车场可查`;
  const description =
    `${short}共有 ${data.parkCount} 个停车场、${data.packageCount} 个在售停车套餐，` +
    `月卡最低 ${monthlyText(data.minMonthly)}/月起，覆盖${data.districts
      .slice(0, 4)
      .map((item) => item.name)
      .join("、")}等区域，按距离和价格挑，扫码直接办理。`;

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
  const short = cityShort(data.city);

  const crumbs = [
    { name: SITE_NAME, path: "/" },
    { name: `${short}停车月卡`, path: cityPath(data.city) },
  ];

  const siblings = otherCities.filter((item) => item.city !== data.city).slice(0, 12);

  return (
    <article className="space-y-3">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify([
            breadcrumbJsonLd(crumbs),
            parksJsonLd(parks.slice(0, 10), data.city),
          ]).replace(
            /</g,
            "\\u003c",
          ),
        }}
      />

      <Breadcrumb items={crumbs} />

      <header className="card p-4">
        <h1 className="text-lg font-semibold leading-snug">{short}停车月卡价格与车场</h1>
        <p className="mt-1.5 text-sm leading-relaxed">
          目前收录{short} <b>{data.parkCount}</b> 个停车场、<b>{data.packageCount}</b>{" "}
          个在售停车套餐，月卡最低{" "}
          <b className="text-price">{monthlyText(data.minMonthly)}/月</b>。
          支持夜间、白天、全天三种时段，按折合月价从低到高排，扫码即可在官方小程序办理。
        </p>
        <p className="mt-2 text-[11px] leading-relaxed text-muted">
          数据来自捷停车官方选品池，价格和库存会随官方调整；本站不代收费用，下单与合同均在官方页面完成。
        </p>
      </header>

      {data.districts.length ? (
        <section className="card p-4" aria-labelledby="districts-title">
          <h2 id="districts-title" className="text-sm font-semibold">
            按区域找
          </h2>
          <div className="mt-2">
            <AreaGrid
              items={data.districts.map((item) => ({
                name: item.name,
                href: districtPath(data.city, item.name),
                count: item.parkCount,
              }))}
            />
          </div>
        </section>
      ) : null}

      <section className="card overflow-hidden" aria-labelledby="parks-title">
        <h2 id="parks-title" className="border-b border-border px-3 py-2.5 text-sm font-semibold">
          {short}月卡价格最低的车场
        </h2>
        <ParkList parks={parks} />
        {parks.length ? (
          <div className="border-t border-border px-3 py-2 text-[11px] text-muted">
            已按折合月价排序，默认显示前 {parks.length} 个；用首页搜索可以按区域、业态、时段继续筛。
          </div>
        ) : (
          <div className="px-3 py-6 text-center text-xs text-muted">该城市暂时没有在售套餐</div>
        )}
      </section>

      <section className="card p-4" aria-labelledby="guide-title">
        <h2 id="guide-title" className="text-sm font-semibold">
          {short}停车怎么买更划算
        </h2>
        <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-muted">
          <li>· 每天通勤停全天：选全天月卡，月均一般在 {monthlyText(data.minMonthly)} 元起。</li>
          <li>· 只有下班后用车：选夜间套餐，通常比全天月卡便宜三到五成。</li>
          <li>· 确定要停半年以上：季卡 / 年卡折合月价更低，但要确认能否转租、退款。</li>
          <li>· 先按区域缩范围，再对比同区域 2-3 个车场的折合月价，别只看总价。</li>
        </ul>
      </section>

      <section className="card p-4" aria-labelledby="faq-title">
        <h2 id="faq-title" className="text-sm font-semibold">
          常见问题
        </h2>
        <dl className="mt-2 space-y-2.5 text-xs leading-relaxed">
          <div>
            <dt className="font-medium">{short}停车月卡一般多少钱？</dt>
            <dd className="mt-0.5 text-muted">
              本站收录的{short}套餐里，最低 {monthlyText(data.minMonthly)}/月，
              多数车场在 150-400 元/月之间，商圈和写字楼会更高，夜间套餐更低。
            </dd>
          </div>
          <div>
            <dt className="font-medium">月卡和临停哪个划算？</dt>
            <dd className="mt-0.5 text-muted">
              如果每天都停、单次临停超过 10 元，月卡基本更便宜；
              一周只停一两次，按次付费更合适。
            </dd>
          </div>
          <div>
            <dt className="font-medium">怎么确认车场还有位？</dt>
            <dd className="mt-0.5 text-muted">
              月卡名额由车场动态控制，下单页会显示是否可售；
              本站展示的是官方当前在售的套餐，已售罄的不会出现在列表里。
            </dd>
          </div>
        </dl>
      </section>

      {siblings.length ? (
        <section className="card p-4" aria-labelledby="cities-title">
          <h2 id="cities-title" className="text-sm font-semibold">
            其他城市
          </h2>
          <div className="mt-2">
            <AreaGrid
              items={siblings.map((item) => ({
                name: cityShort(item.city),
                href: cityPath(item.city),
                count: item.parkCount,
              }))}
            />
          </div>
        </section>
      ) : null}

      <div className="pb-2 text-center text-[11px] text-muted">
        <Link href="/" className="hover:text-brand">
          回到首页按位置搜索
        </Link>
      </div>
    </article>
  );
}

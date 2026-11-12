import Link from "next/link";
import AreaGrid from "@/components/seo/AreaGrid";
import Breadcrumb from "@/components/seo/Breadcrumb";
import ParkList from "@/components/seo/ParkList";
import type { CityStat, CitySeo, ParkSummary } from "@/lib/seoRepo";
import {
  LANDING_PAGE_SIZE,
  SITE_NAME,
  breadcrumbJsonLd,
  cityPagePath,
  cityPath,
  cityShort,
  districtPath,
  faqJsonLd,
  monthlyText,
  parksJsonLd,
} from "@/lib/seo";

interface Props {
  data: CitySeo;
  parks: ParkSummary[];
  /** 从 1 开始 */
  page: number;
  siblings: CityStat[];
}

/**
 * 城市落地页的正文。分页路由（/city/[city]/page/[n]）与首页路由共用这一份，
 * 避免两处各写一套、改文案时漏改一半。
 *
 * FAQ 同时喂给页面和 FAQPage 结构化数据——两份数据必须是同一个数组，
 * 否则文案一改结构化数据就成了旧的，Google 会判不一致。
 */
export default function CityLanding({ data, parks, page, siblings }: Props) {
  const short = cityShort(data.city);
  const totalPages = Math.max(1, Math.ceil(data.parkCount / LANDING_PAGE_SIZE));

  const crumbs = [
    { name: SITE_NAME, path: "/" },
    { name: `${short}停车月卡`, path: cityPath(data.city) },
    ...(page > 1 ? [{ name: `第 ${page} 页`, path: cityPagePath(data.city, page) }] : []),
  ];

  const faq = [
    {
      q: `${short}停车月卡一般多少钱？`,
      a: `本站收录的${short}套餐里，最低 ${monthlyText(data.minMonthly)}/月起；多数车场的全天月卡在 150-400 元/月，商圈和写字楼会更高，夜间套餐明显更低。`,
    },
    {
      q: "月卡和临停哪个更划算？",
      a: "每天都停、单次临停超过 10 元的话，月卡基本更省；一周只停一两次，按次付费更合适。",
    },
    {
      q: "怎么确认车场还有月卡名额？",
      a: "月卡名额由车场动态控制，官方下单页会显示当前是否可售；本站只展示在售的套餐，已售罄的不会出现在列表里。",
    },
  ];

  return (
    <article className="space-y-3">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify([
            breadcrumbJsonLd(crumbs),
            parksJsonLd(parks.slice(0, 10), data.city, (page - 1) * LANDING_PAGE_SIZE + 1),
            faqJsonLd(faq),
          ]).replace(/</g, "\\u003c"),
        }}
      />

      <Breadcrumb items={crumbs} />

      <header className="card p-4">
        <h1 className="text-lg font-semibold leading-snug">
          {short}停车月卡多少钱？{data.parkCount} 个车场的价格
        </h1>
        <p className="mt-1.5 text-sm leading-relaxed">
          {short}目前收录 <b>{data.parkCount}</b> 个能办月卡的停车场、<b>{data.packageCount}</b>{" "}
          个在售套餐，月卡最低 <b className="text-price">{monthlyText(data.minMonthly)}/月</b>。
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
          {page > 1 ? `${short}月卡车场（第 ${page} 页）` : `${short}月卡价格最低的车场`}
        </h2>
        <ParkList parks={parks} />
        {parks.length ? (
          <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2 text-[11px] text-muted">
            <span>
              共 {data.parkCount} 个，第 {page}/{totalPages} 页，按折合月价排序
            </span>
            <span className="flex shrink-0 items-center gap-2">
              {page > 1 ? (
                <Link href={cityPagePath(data.city, page - 1)} className="text-brand">
                  上一页
                </Link>
              ) : null}
              {page < totalPages ? (
                <Link href={cityPagePath(data.city, page + 1)} className="text-brand">
                  下一页
                </Link>
              ) : null}
            </span>
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
          {faq.map((item) => (
            <div key={item.q}>
              <dt className="font-medium">{item.q}</dt>
              <dd className="mt-0.5 text-muted">{item.a}</dd>
            </div>
          ))}
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

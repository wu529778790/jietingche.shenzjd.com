import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { cache } from "react";
import Breadcrumb from "@/components/seo/Breadcrumb";
import AreaGrid from "@/components/seo/AreaGrid";
import {
  getParkByCode,
  listNearbyParks,
  listParkPackages,
} from "@/lib/seoRepo";
import { getPublicConfig } from "@/lib/repo";
import { packageQrDataUrl } from "@/lib/qr";
import {
  absoluteUrl,
  breadcrumbJsonLd,
  cityPath,
  cityShort,
  districtPath,
  monthlyText,
  parkPath,
  SITE_NAME,
} from "@/lib/seo";
import { monthlyPrice, tidyRuleSummary, yuan } from "@/lib/types";

interface PageProps {
  params: Promise<{ code: string }>;
}

/** 车场页按请求渲染：套餐和价格随时会变，不适合构建期预渲染 */
export const instant = false;

/** 同一次请求里 generateMetadata 和页面共用一份数据，别把库查两遍 */
const loadParkPage = cache(async (code: string) => {
  const park = await getParkByCode(code);
  if (!park) return null;
  const [packages, nearby, config] = await Promise.all([
    listParkPackages(park.id),
    listNearbyParks(park.city, park.district, park.id, 8),
    getPublicConfig(),
  ]);
  return { park, packages, nearby, shareCode: config.shareCode };
});

function cheapestMonthly(packages: { price: number; durationDays: number }[]): number {
  const list = packages.filter((pkg) => pkg.price > 0);
  if (!list.length) return 0;
  return Math.min(...list.map((pkg) => monthlyPrice(pkg.price, pkg.durationDays)));
}

/** 车场名大多已经带「停车场」，别再拼成「XX停车场停车月卡」 */
function parkLabel(name: string): string {
  return /(停车场|停车库|车库|车场)$/.test(name) ? name : `${name}停车场`;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { code } = await params;
  const data = await loadParkPage(decodeURIComponent(code));
  if (!data) return { title: "车场不存在", robots: { index: false } };

  const { park, packages } = data;
  const area = `${cityShort(park.city)}${park.district}`;
  const label = parkLabel(park.name);
  const lowest = cheapestMonthly(packages);
  const title = `${label}月卡价格（${area}）`;
  const description = packages.length
    ? `${label}现有 ${packages.length} 个在售停车套餐，月卡最低 ${monthlyText(lowest)}/月起，夜间、白天、全天可选，扫码直接办理。地址：${park.address || area}。`
    : `${label}位于${area}，暂无在售停车套餐，可查看同区域其他车场的月卡价格。`;

  return {
    title,
    description,
    alternates: { canonical: parkPath(park.parkCode) },
    robots: packages.length ? { index: true, follow: true } : { index: false },
    openGraph: {
      type: "website",
      title: `${title}｜${SITE_NAME}`,
      description,
      url: absoluteUrl(parkPath(park.parkCode)),
    },
  };
}

export default async function ParkPage({ params }: PageProps) {
  const { code } = await params;
  const data = await loadParkPage(decodeURIComponent(code));
  if (!data) notFound();

  const { park, packages, nearby, shareCode } = data;
  const lowest = cheapestMonthly(packages);
  const cheapest = packages[0];
  const qr = cheapest
    ? packageQrDataUrl(park.parkCode, cheapest.sourcePackageId, shareCode)
    : "";

  const crumbs = [
    { name: SITE_NAME, path: "/" },
    { name: `${cityShort(park.city)}停车月卡`, path: cityPath(park.city) },
    ...(park.district
      ? [{ name: park.district, path: districtPath(park.city, park.district) }]
      : []),
    { name: park.name },
  ];

  const facilityLd = {
    "@context": "https://schema.org",
    "@type": "ParkingFacility",
    name: parkLabel(park.name),
    url: absoluteUrl(parkPath(park.parkCode)),
    address: {
      "@type": "PostalAddress",
      streetAddress: park.address,
      addressLocality: park.city,
      addressRegion: park.province || park.city,
      addressCountry: "CN",
    },
    ...(park.lat && park.lng
      ? { geo: { "@type": "GeoCoordinates", latitude: park.lat, longitude: park.lng } }
      : {}),
    makesOffer: packages.slice(0, 8).map((pkg) => ({
      "@type": "Offer",
      name: [pkg.typeLabel, pkg.period, pkg.durationLabel].filter(Boolean).join(" "),
      price: (pkg.price / 100).toFixed(2),
      priceCurrency: "CNY",
      availability: "https://schema.org/InStock",
      url: absoluteUrl(parkPath(park.parkCode)),
    })),
  };

  return (
    <article className="space-y-3">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify([breadcrumbJsonLd(crumbs), facilityLd]).replace(/</g, "\\u003c"),
        }}
      />

      <Breadcrumb items={crumbs} />

      <header className="card p-4">
        <h1 className="text-lg font-semibold leading-snug">
          {parkLabel(park.name)}月卡
        </h1>
        <p className="mt-1 text-xs text-muted">
          {[park.city, park.district, park.area].filter(Boolean).join(" · ")}
          {park.address ? ` · ${park.address}` : ""}
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
          {park.industry ? (
            <span className="rounded-md bg-black/[0.04] px-1.5 py-0.5 text-muted">
              {park.industry}
            </span>
          ) : null}
          {park.audience ? (
            <span className="rounded-md bg-brand/10 px-1.5 py-0.5 text-brand">
              适合：{park.audience}
            </span>
          ) : null}
        </div>
        <p className="mt-3 text-sm leading-relaxed">
          {packages.length ? (
            <>
              现有 <b>{packages.length}</b> 个在售票停车套餐，月卡最低{" "}
              <b className="text-price">{monthlyText(lowest)}/月</b>
              ，支持夜间、白天、全天三种时段，扫码即可在官方小程序办理。
            </>
          ) : (
            <>该车场暂无在售票套餐，可先看同区域其他车场。</>
          )}
        </p>
      </header>

      {packages.length ? (
        <section className="card overflow-hidden" aria-labelledby="packages-title">
          <h2 id="packages-title" className="border-b border-border px-3 py-2.5 text-sm font-semibold">
            在售套餐与价格
          </h2>
          <ul className="divide-y divide-border">
            {packages.map((pkg, index) => {
              const monthly = monthlyPrice(pkg.price, pkg.durationDays);
              const rule = tidyRuleSummary(pkg.ruleSummary);
              return (
                <li key={pkg.id} className="px-3 py-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-sm font-medium">
                          {pkg.typeLabel || pkg.name}
                        </span>
                        {pkg.period ? (
                          <span className="rounded bg-black/[0.05] px-1 py-0.5 text-[10px] text-muted">
                            {pkg.period}
                          </span>
                        ) : null}
                        {pkg.durationLabel ? (
                          <span className="text-[11px] text-muted">{pkg.durationLabel}</span>
                        ) : null}
                        {index === 0 ? (
                          <span className="rounded bg-price/10 px-1 py-0.5 text-[10px] text-price">
                            最划算
                          </span>
                        ) : null}
                      </div>
                      {rule ? (
                        <div className="mt-1 text-[11px] leading-relaxed text-muted">{rule}</div>
                      ) : null}
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-sm font-semibold text-price">
                        ¥{yuan(pkg.price)}
                      </div>
                      {pkg.originPrice > pkg.price ? (
                        <div className="text-[10px] text-muted line-through">
                          ¥{yuan(pkg.originPrice)}
                        </div>
                      ) : null}
                      {pkg.durationDays >= 60 ? (
                        <div className="text-[10px] text-muted">
                          折合 ¥{yuan(monthly)}/月
                        </div>
                      ) : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {qr ? (
        <section className="card p-4 text-center" aria-labelledby="qr-title">
          <h2 id="qr-title" className="text-sm font-semibold">
            扫码办理
          </h2>
          <p className="mt-1 text-[11px] text-muted">
            {[cheapest?.typeLabel, cheapest?.period].filter(Boolean).join(" · ")}
            {cheapest && cheapest.price > 0 ? ` · ¥${yuan(cheapest.price)}` : ""}
            ，支付后当天生效
          </p>

          {/* 链接在微信里点不开（只会跳小程序），只能出码让人扫/长按识别 */}
          <div className="mx-auto mt-3 w-fit rounded-xl border border-border bg-white p-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={qr}
              alt={`${park.name}停车月卡办理二维码`}
              className="block h-52 w-52"
              width={208}
              height={208}
            />
          </div>

          <p className="mt-2 text-xs text-muted">微信「扫一扫」办理；在微信里打开本页可直接长按识别</p>
          <p className="mt-1 text-[11px] leading-relaxed text-muted">
            手机浏览器打开的话：截图保存，再到微信「扫一扫 → 相册」里选这张图。
          </p>

          <p className="mt-3 text-[11px] leading-relaxed text-muted">
            本站不代收费用，付款在捷停车官方页面完成；
            价格与规则以官方页面为准，下单前请确认出入场时间限制。
          </p>
        </section>
      ) : null}

      <section className="card p-4" aria-labelledby="how-title">
        <h2 id="how-title" className="text-sm font-semibold">
          怎么办理
        </h2>
        <ol className="mt-2 space-y-1.5 text-xs leading-relaxed text-muted">
          <li>1. 用微信扫描上方二维码，进入捷停车官方办理页。</li>
          <li>2. 选择需要购买的套餐（月卡 / 季卡 / 年卡，夜间或全天）。</li>
          <li>3. 支付完成后自动生效，出场时按车牌自动识别，无需再取卡。</li>
        </ol>
        <p className="mt-2 text-[11px] leading-relaxed text-muted">
          如果你是{park.audience || "周边住户或上班族"}，长期在这附近停车，
          月卡通常比临停便宜一半以上；只在下班后用车的话，夜间套餐更省钱。
        </p>
      </section>

      <section className="card p-4" aria-labelledby="faq-title">
        <h2 id="faq-title" className="text-sm font-semibold">
          常见问题
        </h2>
        <dl className="mt-2 space-y-2.5 text-xs leading-relaxed">
          <div>
            <dt className="font-medium">{park.name}月卡多少钱？</dt>
            <dd className="mt-0.5 text-muted">
              {packages.length
                ? `当前最低 ${monthlyText(lowest)}/月，共 ${packages.length} 个套餐在售，价格会随官方调整，以下单页显示为准。`
                : "该车场暂无在售套餐，可以先看同区域其他车场。"}
            </dd>
          </div>
          <div>
            <dt className="font-medium">夜间套餐白天能停吗？</dt>
            <dd className="mt-0.5 text-muted">
              夜间套餐通常只覆盖工作日晚间到次日早晨（如 18:30-08:30）以及周末全天，
              白天进出可能按临停另计。要以套餐规则里写的时间段为准。
            </dd>
          </div>
          <div>
            <dt className="font-medium">扫码后在哪里付款？多久生效？</dt>
            <dd className="mt-0.5 text-muted">
              付款和合同都在捷停车官方小程序里完成，本站不经手资金。
              一般支付后当天生效，个别车场需要物业审核。
            </dd>
          </div>
          <div>
            <dt className="font-medium">可以退款或者换车吗？</dt>
            <dd className="mt-0.5 text-muted">
              退款与换车规则由车场和官方平台约定，本站无法代办；
              下单前建议在官方页面确认对应套餐的退改说明。
            </dd>
          </div>
        </dl>
      </section>

      {nearby.length ? (
        <section className="card p-4" aria-labelledby="nearby-title">
          <h2 id="nearby-title" className="text-sm font-semibold">
            附近还有这些车场
          </h2>
          <ul className="mt-2 space-y-1.5 text-xs">
            {nearby.map((item) => (
              <li key={item.id}>
                <Link href={parkPath(item.parkCode)} className="hover:text-brand">
                  {item.name}
                  {item.minMonthly > 0 ? (
                    <span className="ml-1 text-muted">
                      月均 ¥{Math.round(item.minMonthly / 100)}
                    </span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="card p-4" aria-labelledby="area-title">
        <h2 id="area-title" className="text-sm font-semibold">
          换个地方找
        </h2>
        <div className="mt-2">
          <AreaGrid
            items={[
              { name: `${cityShort(park.city)}全部车场`, href: cityPath(park.city) },
              ...(park.district
                ? [{ name: `${park.district}车场`, href: districtPath(park.city, park.district) }]
                : []),
              { name: "回到首页搜索", href: "/" },
            ]}
          />
        </div>
      </section>
    </article>
  );
}

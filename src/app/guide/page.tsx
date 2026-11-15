import type { Metadata } from "next";
import { cacheLife } from "next/cache";
import Link from "next/link";
import Breadcrumb from "@/components/seo/Breadcrumb";
import { listCityStats } from "@/lib/seoRepo";
import {
  LANDING_CACHE_LIFE,
  SITE_NAME,
  absoluteUrl,
  breadcrumbJsonLd,
  cityPath,
  cityShort,
  faqJsonLd,
} from "@/lib/seo";

/**
 * 办理指南页：承接「微信怎么查停车月卡」「停车月卡怎么办理」这类方法型搜索，
 * 也是站外内容（小红书攻略笔记等）的教方法锚点——笔记教「微信搜一搜搜车场名」，
 * 用户在微信里搜到/打开本页，再从本页进入城市页出凭证，链路全程微信生态内。
 */
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  "use cache";
  cacheLife(LANDING_CACHE_LIFE);
  const title = "微信怎么查附近停车月卡？搜一搜 3 步搞定";
  const description =
    "在微信里用搜一搜查附近停车月卡比价的完整步骤：搜「城市 + 停车月卡」→ 打开比价页 → 保存办理凭证。" +
    "覆盖 130 个城市 7800+ 车场，全程无需下载任何 App。";
  return {
    title,
    description,
    alternates: { canonical: "/guide" },
    openGraph: {
      type: "website",
      title: `${title}｜${SITE_NAME}`,
      description,
      url: absoluteUrl("/guide"),
    },
  };
}

interface CityStatLite {
  city: string;
  parkCount: number;
}

export default async function GuidePage() {
  const cities: CityStatLite[] = (await listCityStats(12)).map((item) => ({
    city: item.city,
    parkCount: item.parkCount,
  }));

  const crumbs = [
    { name: SITE_NAME, path: "/" },
    { name: "办理指南", path: "/guide" },
  ];

  const faq = [
    {
      q: "微信里能查停车月卡比价吗？",
      a: "能。在微信顶部点「搜一搜」，搜「你所在的城市 + 停车月卡」（如「深圳停车月卡」），点开本站的比价页，就能看到各车场的月卡、季卡、夜间包月价格与使用时段，全程在微信内完成。",
    },
    {
      q: "保存的「办理凭证」是什么？",
      a: "选好套餐后点「保存办理凭证到相册」，相册里会存入该套餐对应的办理凭证图。之后在停车场官方小程序中从相册选取这张图，即可按官方价格完成办理；价格与规则以官方页面为准。",
    },
    {
      q: "需要下载额外的 App 吗？",
      a: "不需要。查比价全程在微信内完成；办理环节使用的是停车场官方的小程序，也是微信内就能打开的应用。",
    },
    {
      q: "比价数据准不准？",
      a: "数据每日更新，覆盖 130 个城市 7800+ 车场的在售套餐；页面页脚标注了数据更新日期。价格与使用规则以停车场官方页面为准，本站仅做信息展示与比价参考。",
    },
  ];

  return (
    <article className="mx-auto max-w-2xl space-y-3 p-4">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify([breadcrumbJsonLd(crumbs), faqJsonLd(faq)]).replace(/</g, "\\u003c"),
        }}
      />
      <Breadcrumb items={crumbs} />

      <h1 className="text-lg font-semibold leading-snug">微信怎么查附近停车月卡？搜一搜 3 步搞定</h1>
      <p className="text-sm leading-relaxed text-muted">
        想知道自己附近哪些停车场能办月卡、多少钱，不用下载任何 App——微信自带的「搜一搜」就能完成。
        下面是完整步骤，全程两分钟。
      </p>

      {/* 三步法：每步一张卡，步骤号大字醒目 */}
      <div className="space-y-3">
        {[
          {
            step: "1",
            title: "在微信里打开「搜一搜」",
            desc: "微信首页顶部搜索框就是搜一搜；也可以在聊天列表下拉后直接输入。",
          },
          {
            step: "2",
            title: "搜「你所在的城市 + 停车月卡」",
            desc: "例如搜「深圳停车月卡」「广州停车月卡」，在网页结果里点开泊月的比价页——页面里能看到各车场的月卡、季卡、夜间包月价格和可停时段，还能按距离、区域、价格筛选。",
          },
          {
            step: "3",
            title: "选好套餐，保存办理凭证",
            desc: "点开想要的套餐，点「保存办理凭证到相册」；之后在停车场官方小程序中从相册选取这张凭证，按官方价格完成办理。",
          },
        ].map((item) => (
          <div key={item.step} className="card p-3">
            <div className="flex items-start gap-2.5">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand text-sm font-semibold text-white">
                {item.step}
              </span>
              <div className="min-w-0">
                <h2 className="text-sm font-semibold">{item.title}</h2>
                <p className="mt-1 text-xs leading-relaxed text-muted">{item.desc}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      <section className="card p-3">
        <h2 className="text-sm font-semibold">热门城市直达</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          点开对应城市的比价页，页面同样可以保存到微信收藏，下次直接打开。
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {cities.map((item) => (
            <Link
              key={item.city}
              href={cityPath(item.city)}
              className="rounded-lg border border-border px-2.5 py-1.5 text-xs transition-colors hover:border-brand/50"
            >
              {cityShort(item.city)} · {item.parkCount} 场
            </Link>
          ))}
        </div>
      </section>

      <section className="card p-3">
        <h2 className="text-sm font-semibold">常见问题</h2>
        <div className="mt-2 space-y-3">
          {faq.map((item) => (
            <div key={item.q}>
              <h3 className="text-xs font-semibold">{item.q}</h3>
              <p className="mt-1 text-xs leading-relaxed text-muted">{item.a}</p>
            </div>
          ))}
        </div>
      </section>

      <p className="text-center text-[11px] leading-relaxed text-muted">
        本页为信息查询与比价指南，不提供交易功能；价格与使用规则以停车场官方页面为准。
      </p>
    </article>
  );
}

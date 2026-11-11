import Link from "next/link";
import { connection } from "next/server";
import { listCheapestParks, listCityStats, listTopDistricts } from "@/lib/seoRepo";
import { cityPath, cityShort, districtPath, parkPath, SITE_NAME } from "@/lib/seo";

/**
 * 首页的站内入口（服务端渲染）。
 *
 * 首页的搜索列表是客户端无限滚动加载的，爬虫拿不到；这里补一组真实的 SSR 链接，
 * 让「首页 → 城市 → 区域 → 车场」这条路径对搜索引擎是通的。
 *
 * 位置：由 page 通过 HomeSearch 的 nav 插槽放在「筛选条下面、结果列表上面」。
 * 千万别放回列表底下——结果是无限滚动，7816 个车场永远「还有更多」，
 * 真人永远滑不到那块内链，等于白做。
 *
 * 长度：城市 chips 常显（主要入口，两三行），区域和「最便宜车场」用 <details>
 * 默认收起——链接仍在初始 HTML 里，爬虫照读，首屏又不会被内链撑爆。
 *
 * connection() 把这块钉在「请求到来时」渲染，禁止构建期预渲染。
 * 病根：构建镜像时 .dockerignore 排掉了 data/，构建期读不到业务库，这里会拿到
 * 空城市列表直接 return null；一旦被预渲染成静态页，首页就带着空壳 +
 * s-maxage=31536000 在 CDN 上待一整年，站内链接全断、爬虫也进不来。
 * 注意不能用 `export const dynamic`：与 nextConfig.cacheComponents 冲突，构建直接失败。
 */
export default async function HomeLinks() {
  await connection();

  // 库不可用（挂卷没挂上、文件损坏）时宁可少这块内链，也别让首页整体 500
  const [cities, districts, cheapest] = await Promise.all([
    listCityStats(12),
    listTopDistricts(12),
    listCheapestParks(10),
  ]).catch(() => [[], [], []]);

  if (!cities.length) return null;

  return (
    <section className="space-y-2" aria-labelledby="site-links-title">
      <h2 id="site-links-title" className="px-1 text-sm font-semibold">
        按城市找停车月卡
      </h2>

      <div className="card p-3">
        {/* 手机上一行横向滑（12 个城市换行要吃掉半屏首屏），桌面正常换行；链接都在 DOM 里，爬虫照读 */}
        <div className="no-scrollbar flex gap-1.5 overflow-x-auto sm:flex-wrap sm:overflow-visible">
          {cities.map((city) => (
            <Link
              key={city.city}
              href={cityPath(city.city)}
              className="shrink-0 rounded-lg border border-border px-2 py-1 text-xs transition-colors hover:border-brand/50 hover:text-brand"
            >
              {cityShort(city.city)}月卡
              <span className="ml-1 text-[10px] text-muted">{city.parkCount}</span>
            </Link>
          ))}
        </div>
      </div>

      {districts.length ? (
        <details className="card p-3">
          <summary className="flex cursor-pointer list-none items-center justify-between text-xs font-medium text-muted">
            <span>
              热门区域 <span className="text-[11px]">（{districts.length}）</span>
            </span>
            <span className="text-[11px] text-muted/70">展开</span>
          </summary>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {districts.map((item) => (
              <Link
                key={`${item.city}-${item.district}`}
                href={districtPath(item.city, item.district)}
                className="rounded-lg bg-black/[0.03] px-2 py-1 text-xs text-muted transition-colors hover:text-brand"
              >
                {cityShort(item.city)}
                {item.district}
              </Link>
            ))}
          </div>
        </details>
      ) : null}

      {cheapest.length ? (
        <details className="card p-3">
          <summary className="flex cursor-pointer list-none items-center justify-between text-xs font-medium text-muted">
            <span>
              月卡最便宜的车场 <span className="text-[11px]">（{cheapest.length}）</span>
            </span>
            <span className="text-[11px] text-muted/70">展开</span>
          </summary>
          <ul className="mt-2 space-y-1">
            {cheapest.map((park) => (
              <li key={park.id} className="text-xs">
                <Link href={parkPath(park.parkCode)} className="hover:text-brand">
                  {park.name}
                </Link>
                <span className="ml-1 text-muted">
                  {cityShort(park.city)}
                  {park.district}
                  {park.minMonthly > 0 ? ` · 月均 ¥${Math.round(park.minMonthly / 100)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <p className="px-1 text-[11px] leading-relaxed text-muted">
        {SITE_NAME}收录了全国主要城市的停车场月卡、季卡与夜间套餐，按位置和价格筛选后扫码即可在捷停车官方小程序办理。
        价格与规则以官方页面为准，本站不代收费用。
      </p>
    </section>
  );
}

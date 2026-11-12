import { Suspense } from "react";
import HomeSearch from "@/components/HomeSearch";
import HomeLinks from "@/components/seo/HomeLinks";

/**
 * 首页 = 客户端搜索交互（HomeSearch）+ 服务端渲染的站内入口（HomeLinks）。
 * 前者负责定位/筛选/出码，后者给搜索引擎一条能爬下去的路径。
 *
 * HomeLinks 刻意留在搜索结果列表**底部**：结果列表是无限滚动（7816 个车场永远
 * 「还有更多」），真人永远滑不到这里，等于不存在——城市有「位置」弹层、最便宜有
 * 「每月最省」排序，这两块入口在交互上是重复的，不该占首屏。
 * 但爬虫读的是初始 HTML，这 37 个站内链接必须留着：首页是权重最高的一页，
 * 没有它们，首页 → 城市 → 区域 → 车场 的链路就只剩 sitemap 一条了。
 *
 * 预渲染问题见 HomeLinks：它靠 connection() 把自己钉在运行时渲染。
 * 这里不要写 dynamic="force-dynamic"——与 nextConfig.cacheComponents 冲突，构建会直接失败。
 */
export default function HomePage() {
  return (
    <div className="space-y-3">
      <HomeSearch />
      <Suspense fallback={null}>
        <HomeLinks />
      </Suspense>
    </div>
  );
}

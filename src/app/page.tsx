import { Suspense } from "react";
import HomeSearch from "@/components/HomeSearch";
import HomeLinks from "@/components/seo/HomeLinks";

/**
 * 首页 = 客户端搜索交互（HomeSearch）+ 服务端渲染的站内入口（HomeLinks）。
 * 前者负责定位/筛选/出码，后者给搜索引擎一条能爬下去的路径。
 *
 * HomeLinks 通过 slot 塞进搜索框下面、结果列表上面。
 * 为什么不在列表下面：结果是无限滚动加载，用户（和任何真人）永远滑不到底，
 * 底部那块内链等于白做——原来 7816 个车场每次都「还有更多」，没人见过页脚。
 *
 * 预渲染问题见 HomeLinks：它靠 connection() 把自己钉在运行时渲染。
 * 这里不要写 dynamic="force-dynamic"——与 nextConfig.cacheComponents 冲突，构建会直接失败。
 */
export default function HomePage() {
  return (
    <HomeSearch
      nav={
        <Suspense fallback={null}>
          <HomeLinks />
        </Suspense>
      }
    />
  );
}

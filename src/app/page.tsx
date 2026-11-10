import { Suspense } from "react";
import HomeSearch from "@/components/HomeSearch";
import HomeLinks from "@/components/seo/HomeLinks";

/**
 * 首页 = 客户端搜索交互（HomeSearch）+ 服务端渲染的站内入口（HomeLinks）。
 * 前者负责定位/筛选/出码，后者给搜索引擎一条能爬下去的路径。
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

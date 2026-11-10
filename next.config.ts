import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* 自托管部署用：产出 .next/standalone，镜像里只带 runtime 需要的东西 */
  output: "standalone",
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  /**
   * 对外接口固定走 /api/v1/*，内部实现随便改路径，端上不用跟着动。
   * proxy 会把 /api/v1/xxx 归一成 /api/xxx 再判白名单。
   */
  async rewrites() {
    return [{ source: "/api/v1/:path*", destination: "/api/:path*" }];
  },
};

export default nextConfig;

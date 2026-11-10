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
};

export default nextConfig;

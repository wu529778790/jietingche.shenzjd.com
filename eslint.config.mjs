import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // 小程序解包样本（.gitignore 里也是忽略的，只在本机存在）：
    // 里面是压缩过的第三方 bundle，扫出 190 条解析错误，把本地 `npm run lint` 淹掉，
    // 和 CI（没这份目录）跑出来的结果对不上，查 CI 失败时特别误导
    "reference/**",
    // 两个 H5 构建产物目录（同样 gitignored，CI 上不存在）：
    // 产物里是拼好的 data.js / shared.js，扫出来全是噪音警告
    "minitool/dist/**",
    "platforms/toy/dist/**",
  ]),
  {
    // 小工具要跑在旧版 WebView 里，保留 catch (e) 这种老写法，别为「未使用」去改语法
    files: ["minitool/src/**/*.js"],
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { caughtErrors: "none" }],
      "no-unused-vars": ["warn", { caughtErrors: "none" }],
    },
  },
]);

export default eslintConfig;

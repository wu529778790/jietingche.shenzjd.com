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

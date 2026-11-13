/**
 * 生成分享图 public/og.png（1200×630）。
 *
 *   node scripts/brand/render-og.mjs
 *
 * 从 scripts/brand/og-card.html 里抽出 <style> 和 #og 区块，拼一个只含该区块的临时页面，
 * 再用本机 Playwright 缓存里的 Chromium 无头截图（不需要装 playwright 依赖）。
 * 换机器没缓存时，改用浏览器打开 og-card.html 对 #og 元素右键「Capture node screenshot」。
 */
import { execFile } from "node:child_process";
import { readFile, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import { homedir } from "node:os";
import path from "node:path";

const run = promisify(execFile);

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  path.join(
    homedir(),
    "Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
  ),
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
].filter(Boolean);

const chrome = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!chrome) throw new Error("找不到 Chromium，设置 CHROME_PATH 环境变量指向可执行文件");

const html = await readFile("scripts/brand/og-card.html", "utf8");
const css = html.match(/<style>([\s\S]*?)<\/style>/)?.[1];
const start = html.indexOf('<div id="og">');
const end = html.lastIndexOf("</div>");
if (!css || start < 0 || end < 0) throw new Error("没能从 og-card.html 里取出样式和 #og 区块");
const ogBlock = html.slice(start, end + "</div>".length);

const tmp = path.resolve("scripts/brand/.tmp-og.html");
await writeFile(
  tmp,
  `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><style>${css}
  html, body { margin: 0; padding: 0; background: #fff; }</style></head>
  <body>${ogBlock}</body></html>`,
  "utf8"
);

try {
  await run(chrome, [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--force-device-scale-factor=1",
    "--window-size=1200,630",
    `--screenshot=${path.resolve("public/og.png")}`,
    `file://${tmp}`,
  ]);
} finally {
  await rm(tmp, { force: true });
}
console.log("public/og.png  1200x630");

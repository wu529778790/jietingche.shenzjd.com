/**
 * 生成小红书小工具提交封面（三比例）：
 *
 *   node scripts/brand/render-cover.mjs
 *   → reference/brand/covers/cover-1x1.png   （800×800   @2x → 1600×1600）
 *   → reference/brand/covers/cover-3x4.png   （900×1200  @2x → 1800×2400）
 *   → reference/brand/covers/cover-16x9.png  （1200×675  @2x → 2400×1350）
 *
 * 与 render-og.mjs 同一套取图方式：本机 Playwright 缓存里的 Chromium 无头截图，
 * 不额外装依赖。换机器没缓存时，用浏览器打开 minitool-cover.html，
 * 对目标块右键「Capture node screenshot」。
 */
import { execFile } from "node:child_process";
import { readFile, writeFile, rm, mkdir } from "node:fs/promises";
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

const SRC_HTML = "scripts/brand/minitool-cover.html";
const OUT_DIR = "reference/brand/covers";

/** 设计尺寸（CSS px），出图统一 @2x */
const VARIANTS = [
  { id: "cover-1x1", file: "cover-1x1.png", width: 800, height: 800 },
  { id: "cover-3x4", file: "cover-3x4.png", width: 900, height: 1200 },
  { id: "cover-16x9", file: "cover-16x9.png", width: 1200, height: 675 },
];

const html = await readFile(SRC_HTML, "utf8");
const css = html.match(/<style>([\s\S]*?)<\/style>/)?.[1];
if (!css) throw new Error("没能从 minitool-cover.html 里取出 <style>");

await mkdir(OUT_DIR, { recursive: true });

for (const v of VARIANTS) {
  const marker = `<!-- #${v.id}:start -->`;
  const start = html.indexOf(marker);
  const end = html.indexOf(`<!-- #${v.id}:end -->`);
  if (start < 0 || end < 0) throw new Error(`找不到 ${v.id} 区块`);
  const block = html.slice(start + marker.length, end).trim();

  const tmp = path.resolve(`scripts/brand/.tmp-${v.id}.html`);
  await writeFile(
    tmp,
    `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><style>${css}
    html, body { margin: 0; padding: 0; background: #fff; }
    .cover { margin: 0 !important; }</style></head><body>${block}</body></html>`,
    "utf8"
  );

  try {
    await run(chrome, [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--force-device-scale-factor=2",
      `--window-size=${v.width},${v.height}`,
      `--screenshot=${path.resolve(OUT_DIR, v.file)}`,
      `file://${tmp}`,
    ]);
  } finally {
    await rm(tmp, { force: true });
  }
  console.log(`${OUT_DIR}/${v.file}  ${v.width * 2}x${v.height * 2}`);
}

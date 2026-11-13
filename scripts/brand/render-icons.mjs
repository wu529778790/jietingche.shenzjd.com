/**
 * 生成 PWA / iOS 图标（纯 SVG 渲染，不需要浏览器）。
 *
 *   node scripts/brand/render-icons.mjs
 *
 * 图形从 src/components/BrandMark.tsx 里现取（品牌图形的源数据，
 * 与 src/app/icon.svg 保持同一份路径数据），尺寸沿用 scripts/brand/og-card.html
 * 里定下的比例：192→127px、512→338px、maskable→266px（安全区 52%）、apple→118px。
 * 改完图形后先跑本脚本，再跑 render-og.mjs 出分享图。
 */
import sharp from "sharp";
import { readFile } from "node:fs/promises";

const SRC = "src/components/BrandMark.tsx";

const src = await readFile(SRC, "utf8");
const pinD = src.match(/d="(M64 [^"]+)"/)?.[1];
const letterD = src.match(/d="(M5[0-9] [^"]+)"/)?.[1];
if (!pinD || !letterD) throw new Error(`没能从 ${SRC} 里取到图形路径`);

const tileSvg = (size, pinSize) => {
  const off = (size - pinSize) / 2;
  const scale = pinSize / 128;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="c" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#1b6bff"/>
      <stop offset="1" stop-color="#0d3fb0"/>
    </linearGradient>
  </defs>
  <rect width="${size}" height="${size}" fill="url(#c)"/>
  <g transform="translate(${off} ${off}) scale(${scale})">
    <path fill="#ffffff" d="${pinD}"/>
    <path d="${letterD}" fill="none" stroke="#0d3fb0" stroke-width="12"
      stroke-linecap="round" stroke-linejoin="round"/>
  </g>
</svg>`;
};

const targets = [
  ["public/icons/icon-192.png", 192, 127],
  ["public/icons/icon-512.png", 512, 338],
  ["public/icons/maskable-512.png", 512, 266],
  ["src/app/apple-icon.png", 180, 118],
];

for (const [out, size, pinSize] of targets) {
  await sharp(Buffer.from(tileSvg(size, pinSize)))
    .png({ compressionLevel: 9 })
    .toFile(out);
  console.log(`${out}  ${size}x${size}  pin=${pinSize}`);
}

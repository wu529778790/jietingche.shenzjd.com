import type { CSSProperties } from "react";

/**
 * 品牌图形的唯一源是 src/app/icon.svg（蓝底圆角 + 白定位针 + 深蓝 P）。
 * 页面上直接内联 SVG，省一次请求，也方便在小尺寸下按容器调对比色；
 * 主色和图标里的渐变保持一致（#1b6bff → #0d3fb0）。
 */

/** 只有定位针，没有底板——铺在品牌蓝渐变上时用这个 */
export function BrandPin({
  className,
  style,
  pinColor = "#ffffff",
  letterColor = "#0d3fb0",
}: {
  className?: string;
  /** 没有 Tailwind 的场合（比如离线页，样式全内联）用这个给尺寸 */
  style?: CSSProperties;
  pinColor?: string;
  letterColor?: string;
}) {
  return (
    <svg
      viewBox="0 0 128 128"
      className={className}
      style={style}
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill={pinColor}
        d="M64 14 c-19 0 -34 15 -34 33 c0 24 34 61 34 61 s34 -37 34 -61 c0 -18 -15 -33 -34 -33 Z"
      />
      <path
        d="M54 75 V35 H66 a13 13 0 0 1 0 26 H54"
        fill="none"
        stroke={letterColor}
        strokeWidth="12"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** 带底板的完整图标，浅色背景下用（后台顶栏等） */
export default function BrandMark({
  className = "h-6 w-6",
  radius = 22,
}: {
  className?: string;
  /** viewBox 宽 128 时的圆角，默认 22% */
  radius?: number;
}) {
  const tile: CSSProperties = {
    background: "linear-gradient(135deg, #1b6bff 0%, #0d3fb0 100%)",
    borderRadius: `${radius}%`,
  };

  return (
    <span
      className={`inline-flex items-center justify-center ${className}`}
      style={tile}
      aria-hidden="true"
    >
      <BrandPin className="h-[68%] w-[68%]" />
    </span>
  );
}

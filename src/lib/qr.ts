/**
 * 二维码全部前端现场生成，后台不存任何码图。
 *
 * 码内容沿用官方海报解码出来的模板（见 reference/promo-qr-research.md）：
 *   套餐：https://m.jparking.cn/carParkDetail?detailTab=service&sourceId=FXFX02
 *           &showPackageId={sourcePackageId}&parkCode={parkCode}&shareCode={shareCode}
 *   兜底：https://m.jparking.cn/search-stall?sourceId=FXFX01&shareCode={shareCode}
 */
import qrcode from "qrcode-generator";
import { DEFAULT_SHARE_CODE } from "./types";

/** 套餐详情页的来源位，与官方海报一致 */
const PACKAGE_SOURCE_ID = "FXFX02";
/** 搜索页的来源位，官方首页海报同款 */
const SEARCH_SOURCE_ID = "FXFX01";

/** 依次尝试的二维码版本号（1 最小，容量不够就往上换） */
const QR_VERSIONS: Parameters<typeof qrcode>[0][] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/** 套餐直达链接；缺任一要素返回空串 */
export function packagePromoUrl(
  parkCode: string,
  packageId: string,
  shareCode: string,
): string {
  if (!parkCode || !packageId || !shareCode) return "";
  return (
    `https://m.jparking.cn/carParkDetail?detailTab=service&sourceId=${PACKAGE_SOURCE_ID}` +
    `&showPackageId=${encodeURIComponent(packageId)}` +
    `&parkCode=${encodeURIComponent(parkCode)}` +
    `&shareCode=${encodeURIComponent(shareCode)}`
  );
}

/** 兜底链接：车场缺官方编码时扫出来直接进官方搜索页 */
export function searchPromoUrl(shareCode: string): string {
  if (!shareCode) return "";
  return (
    `https://m.jparking.cn/search-stall?sourceId=${SEARCH_SOURCE_ID}` +
    `&shareCode=${encodeURIComponent(shareCode)}`
  );
}

/**
 * 把文本编成二维码 dataURL（GIF，纯 JS，无 DOM 依赖，SSR 也能跑）。
 * 版本号从 1 往上试，容量不够就换更大的；全失败返回空串。
 */
export function qrDataUrl(text: string, cellSize = 6, margin = 20): string {
  if (!text) return "";
  for (const version of QR_VERSIONS) {
    try {
      const qr = qrcode(version, "M");
      qr.addData(text);
      qr.make();
      return qr.createDataURL(cellSize, margin);
    } catch {
      // 容量不足，继续换大版本
    }
  }
  return "";
}

/**
 * 套餐落地链接：优先直达该套餐，缺官方编码就退到搜索页兜底。
 * shareCode 传空（接口没返回）时也能拼，用内置兜底值。
 *
 * 手机端可以直接把这个链接给用户点（不用非走二维码），
 * 二维码只是「跨 App / PC / 打印」场景的兜底。
 */
export function packagePromoLink(
  parkCode: string,
  packageId: string,
  shareCode: string,
): string {
  const code = shareCode || DEFAULT_SHARE_CODE;
  return packagePromoUrl(parkCode, packageId, code) || searchPromoUrl(code);
}

/** 套餐码：内容就是上面的落地链接 */
export function packageQrDataUrl(
  parkCode: string,
  packageId: string,
  shareCode: string,
): string {
  return qrDataUrl(packagePromoLink(parkCode, packageId, shareCode));
}

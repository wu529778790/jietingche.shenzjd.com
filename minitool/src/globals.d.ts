/**
 * app.js 的运行时注入声明。
 *
 * 用途：build-h5 用 `tsc --checkJs` 对 app.js 做一次「未定义标识符」检查
 * （只认 TS2304）。app.js 没有构建步骤，删掉一个顶层变量却漏改引用时，
 * 语法检查和 eslint 都看不出来，只有真机点到那一层才炸——那正是 TYPE_DAYS 那次。
 * 这份声明只用来消掉「window 上没有自定义属性」这类噪音，别往里加业务类型。
 *
 * 一律用 unknown 而不是 any：本仓 eslint 开了 no-explicit-any，声明文件也会被扫到
 * （2026-11-19 的 CI 就是栽在这九个 any 上）。unknown 对「只消 TS2304」这个用途等价，
 * 属性访问产生的 TS18046 本来也不在 tsc 那道闸的检查范围内。
 */

interface Window {
  __JTC_DATA__?: unknown;
  __JTC_INDEX__?: unknown;
  __JTC_QR__?: unknown;
  __JTC_SHARE__?: unknown;
  __JTC_PLATFORM__?: string;
  __JTC_SHARED__?: unknown;
  __JTC_CITY_DATA__?: unknown;
  /** ip-city.js（仅 toy 包注入）：按出口 IP 取城市名，回调一定被调用，拿不到给空串 */
  __JTC_IPCITY__?: (done: (name: string) => void) => void;
  xhs?: unknown;
  toy?: unknown;
  webkit?: unknown;
}

/**
 * app.js 的运行时注入声明。
 *
 * 用途：build-h5 用 `tsc --checkJs` 对 app.js 做一次「未定义标识符」检查
 * （只认 TS2304）。app.js 没有构建步骤，删掉一个顶层变量却漏改引用时，
 * 语法检查和 eslint 都看不出来，只有真机点到那一层才炸——那正是 TYPE_DAYS 那次。
 * 这份声明只用来消掉「window 上没有自定义属性」这类噪音，别往里加业务类型。
 */

interface Window {
  __JTC_DATA__?: any;
  __JTC_INDEX__?: any;
  __JTC_QR__?: any;
  __JTC_SHARE__?: any;
  __JTC_PLATFORM__?: string;
  __JTC_SHARED__?: any;
  __JTC_CITY_DATA__?: any;
  xhs?: any;
  toy?: any;
  webkit?: any;
}

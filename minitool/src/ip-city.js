/**
 * 城市级 IP 定位（仅 B站 Toy 构建注入）。
 *
 * 为什么只在 toy 包里有这个文件：
 *   - 小红书的 device-capabilities §6 禁止任何网络请求（fetch/XHR/WebSocket/外部资源），
 *     build-h5 的静态扫描门禁会把带这个文件的小红包直接拦下来；
 *   - Toy 没有这条限制，页面本来就要从 hdslb CDN 拉 SDK，多一个 JSON 请求没有额外代价
 *     （2026-11-19 在线上详情页实测：跨域 fetch 放行，CORS 头齐全）。
 *
 * 为什么需要它：
 *   Toy 把作品套在 sandbox iframe 里（allow 只有 pointer-lock），Chrome 的
 *   Permissions Policy 直接禁掉 geolocation，连权限窗都不会弹；官方 SDK
 *   （bilibili-toy@0.1.12 的 8 个 namespace）也没有定位能力。
 *   于是「距离」在 Toy 里做不出来，只能退一步：按出口 IP 猜城市，
 *   让用户一进来就落在对的城市，不用先手动点「位置」。
 *
 * 只做城市级，绝不拿来算距离——IP 落点是运营商出口，和用户实际位置能差几十公里。
 *
 * 接口：ipip.net 的公开 JSON
 *   {"ret":"ok","data":{"location":["中国","广东","深圳","","移动"]}}
 * 选它的理由：国内可达、CORS 开放、结构简单。
 * 实测被否掉的：ipwho.is / api.ip.sb 走代理出口回了日本；ipinfo.io、
 * ip.useragentinfo.com 直接 fetch 失败；baidubce qifu 的公开路径 404。
 */
(function () {
  "use strict";

  var API = "https://myip.ipip.net/json";
  var TIMEOUT_MS = 2500;

  window.__JTC_IPCITY__ = function (done) {
    var finished = false;
    var timer = null;
    var ctrl = null;

    var finish = function (name) {
      if (finished) return;
      finished = true;
      if (timer) clearTimeout(timer);
      done(String(name || "").replace(/\s/g, ""));
    };

    if (typeof fetch !== "function") { finish(""); return; }
    try {
      if (typeof AbortController === "function") {
        ctrl = new AbortController();
        timer = setTimeout(function () {
          try { ctrl.abort(); } catch (e) { /* 已结束 */ }
        }, TIMEOUT_MS);
      }
      fetch(API, ctrl ? { signal: ctrl.signal } : undefined)
        .then(function (res) { return res && res.ok ? res.json() : null; })
        .then(function (json) {
          var loc = json && json.data && json.data.location;
          /* location = [国家, 省, 市, 区, 运营商]；直辖市省市同名，取不到市就用省 */
          finish(loc && loc[2] ? loc[2] : loc && loc[1] ? loc[1] : "");
        })
        .catch(function () { finish(""); });
    } catch (e) {
      finish("");
    }
  };
})();

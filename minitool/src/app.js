/* 找停车·小红书小工具 v2
 * ES2017（Chrome 61 基线），无外部依赖，经典脚本（无 import/export）。
 * 平台 API 调用前先做方法存在性检测 + buildVersion 版本门禁（js-api.md 规范）：
 *   getLocation 9.49+ / saveImageToPhotosAlbum 9.42+，低版本走降级提示。
 */
(function () {
  "use strict";

  var DATA = window.__JTC_DATA__ || { city: "", updatedAt: "", parks: [] };
  var INDEX = window.__JTC_INDEX__ || { cities: [] };
  var loadedFiles = { "": DATA };
  var QR_GLOBAL = (window.__JTC_QR__ && window.__JTC_QR__.global) || "";
  var SHARE_CODE = window.__JTC_SHARE__ || "";

  var TYPE_LABEL = { "1": "月卡", "2": "日卡", "3": "次卡", "4": "年卡", "5": "半年卡", "6": "季卡" };
  var SLOT_LABEL = { "0": "全天", "1": "白天", "2": "夜间" };
  var PAGE_SIZE = 30;
  var LOC_MIN_VERSION = 9490;      // getLocation 需客户端 9.49+
  var SAVE_MIN_VERSION = 9420;     // saveImageToPhotosAlbum 需客户端 9.42+

  var state = {
    kw: "",
    district: "",
    industry: "",
    type: "",
    slot: "",
    sort: "price",
    lat: null,
    lng: null,
    page: 1,
    expanded: {},
    cityFile: "",
  };
  var filtered = [];

  /* ------------------------------ 基础工具 ------------------------------ */

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function yuan(fen) {
    var v = (fen || 0) / 100;
    return v % 1 === 0 ? String(v) : v.toFixed(2);
  }

  function getMini() {
    return window.xhs && window.xhs.miniTool ? window.xhs.miniTool : null;
  }

  /* buildVersion 读取：同步 launchOptions 优先，异步 getLaunchOptions 兜底（js-api.md） */
  function readBuildVersion(launchOptions) {
    var env = launchOptions && launchOptions.miniToolEnv;
    return Number(env && env.buildVersion) || 0;
  }

  function getBuildVersion() {
    var syncVersion = readBuildVersion(window.xhs && window.xhs.launchOptions);
    if (syncVersion) return Promise.resolve(syncVersion);

    var mini = getMini();
    if (!mini || typeof mini.getLaunchOptions !== "function") return Promise.resolve(0);

    return mini.getLaunchOptions()
      .then(function (options) { return readBuildVersion(options); })
      .catch(function () { return 0; });
  }

  function clientVersionAtLeast(buildVersion, minimum) {
    return Math.floor((Number(buildVersion) || 0) / 1000) >= minimum / 10;
  }

  function haversine(lat1, lng1, lat2, lng2) {
    var rad = function (d) { return d * Math.PI / 180; };
    var a1 = rad(lat1), b1 = rad(lng1), a2 = rad(lat2), b2 = rad(lng2);
    var x = Math.sin(a1) * Math.sin(a2) + Math.cos(a1) * Math.cos(a2) * Math.cos(b2 - b1);
    return 6371000 * Math.acos(Math.min(1, Math.max(-1, x)));
  }

  function distText(m) {
    return m < 1000 ? Math.round(m) + "m" : (m / 1000).toFixed(1) + "km";
  }

  function minPriceOf(list) {
    var min = Infinity;
    for (var i = 0; i < list.length; i++) {
      var pr = list[i].pr;
      if (pr > 0 && pr < min) min = pr;
    }
    return min === Infinity ? 0 : min;
  }

  /* ------------------------------ 筛选 / 排序 ------------------------------ */

  function applyFilters() {
    var kw = state.kw.trim().toLowerCase();
    var arr = [];
    for (var i = 0; i < DATA.parks.length; i++) {
      var p = DATA.parks[i];
      if (state.district && p.d !== state.district) continue;
      if (state.industry && p.i !== state.industry) continue;
      if (kw && p.n.toLowerCase().indexOf(kw) < 0 && (p.a || "").toLowerCase().indexOf(kw) < 0) continue;
      var pkgs = [];
      for (var j = 0; j < p.p.length; j++) {
        var k = p.p[j];
        if (state.type && k.t !== state.type) continue;
        if (state.slot && k.v !== state.slot) continue;
        pkgs.push(k);
      }
      if (!pkgs.length) continue;
      pkgs.sort(function (a, b) { return (a.pr || 0) - (b.pr || 0); });
      arr.push({ park: p, pkgs: pkgs, d: null, min: minPriceOf(pkgs) });
    }

    var located = state.lat != null && state.lng != null;
    if (state.sort === "dist" && located) {
      for (var m = 0; m < arr.length; m++) {
        var g = arr[m].park.g || [0, 0];
        arr[m].d = haversine(state.lat, state.lng, g[1], g[0]);
      }
      arr.sort(function (a, b) { return a.d - b.d; });
    } else {
      arr.sort(function (a, b) { return a.min - b.min; });
    }

    filtered = arr;
    state.page = 1;
    renderList();
  }

  /* ------------------------------ 筛选抽屉（对齐官方分享中心交互） ------------------------------ */

  var draft = { district: "", industry: "", type: "", slot: "" };

  function updateFilterBadge() {
    var n = (state.district ? 1 : 0) + (state.industry ? 1 : 0)
      + (state.type ? 1 : 0) + (state.slot ? 1 : 0);
    var badge = $("filterBadge");
    badge.textContent = n;
    badge.hidden = n === 0;
  }

  function fButtonHtml(section, code, label) {
    var on = draft[section] === code;
    return '<button class="fbtn' + (on ? " on" : "") + '" data-sec="' + section + '" data-v="' + esc(code) + '">'
      + esc(label) + "</button>";
  }

  function renderFilterPanel() {
    var industries = {};
    var types = {};
    for (var i = 0; i < DATA.parks.length; i++) {
      industries[DATA.parks[i].i] = 1;
      var pp = DATA.parks[i].p;
      for (var j = 0; j < pp.length; j++) types[pp[j].t] = 1;
    }
    var inds = Object.keys(industries).sort();
    var typeCodes = Object.keys(types).sort(function (a, b) { return Number(a) - Number(b); });

    // 所在区域（当前城市，按车场量降序）
    var districts = {};
    for (var di = 0; di < DATA.parks.length; di++) {
      var dv = DATA.parks[di].d;
      if (dv) districts[dv] = (districts[dv] || 0) + 1;
    }
    var dts = Object.keys(districts).sort(function (a, b) { return districts[b] - districts[a]; });

    var html = "";
    // 停放时间（官方面板顺序：白天/夜间/全天；不选 = 全部）
    html += '<div class="fsec"><div class="fsec-title">停放时间</div><div class="fgrid">';
    html += fButtonHtml("slot", "1", SLOT_LABEL["1"]);
    html += fButtonHtml("slot", "2", SLOT_LABEL["2"]);
    html += fButtonHtml("slot", "0", SLOT_LABEL["0"]);
    html += "</div></div>";

    // 套餐类型
    html += '<div class="fsec"><div class="fsec-title">套餐类型</div><div class="fgrid">';
    for (var t = 0; t < typeCodes.length; t++) {
      var c = typeCodes[t];
      html += fButtonHtml("type", c, TYPE_LABEL[c] || c);
    }
    html += "</div></div>";

    // 所在区域
    if (dts.length > 1) {
      html += '<div class="fsec"><div class="fsec-title">所在区域</div><div class="fgrid">';
      for (var k = 0; k < dts.length; k++) {
        html += fButtonHtml("district", dts[k], dts[k]);
      }
      html += "</div></div>";
    }

    // 业态（自有维度）
    html += '<div class="fsec"><div class="fsec-title">业态</div><div class="fgrid">';
    for (var k = 0; k < inds.length; k++) {
      html += fButtonHtml("industry", inds[k], inds[k]);
    }
    html += "</div></div>";

    $("fbody").innerHTML = html;

    var btns = $("fbody").querySelectorAll(".fbtn");
    for (var b = 0; b < btns.length; b++) {
      btns[b].addEventListener("click", function (e) {
        var el = e.currentTarget;
        var sec = el.getAttribute("data-sec");
        var v = el.getAttribute("data-v") || "";
        draft[sec] = draft[sec] === v ? "" : v;
        renderFilterPanel();
      });
    }
  }

  function openFilterPanel() {
    draft = { district: state.district, industry: state.industry, type: state.type, slot: state.slot };
    renderFilterPanel();
    $("fpanel").hidden = false;
  }

  function commitFilter() {
    state.district = draft.district;
    state.industry = draft.industry;
    state.type = draft.type;
    state.slot = draft.slot;
    updateFilterBadge();
    applyFilters();
    $("fpanel").hidden = true;
  }

  function pkgTagsHtml(k) {
    var tags = [];
    if (TYPE_LABEL[k.t]) tags.push(TYPE_LABEL[k.t]);
    if (SLOT_LABEL[k.v]) tags.push(SLOT_LABEL[k.v]);
    var html = "";
    for (var i = 0; i < tags.length; i++) html += "<span>" + esc(tags[i]) + "</span>";
    return html;
  }

  function pkgRowHtml(key, k) {
    var origin = k.po > k.pr ? '<span class="pkg-origin">原价 ' + yuan(k.po) + " 元</span>" : "";
    return '<div class="pkg" data-park="' + esc(key) + '" data-pkg="' + esc(k.id) + '">'
      + '<div class="pkg-name">' + esc(k.n) + "</div>"
      + '<div class="pkg-tags">' + pkgTagsHtml(k) + "</div>"
      + '<div class="pkg-ft">'
      + '<span class="pkg-price">' + yuan(k.pr) + " 元</span>" + origin
      + '<span class="pkg-btn" data-park="' + esc(key) + '" data-pkg="' + esc(k.id) + '">扫码办卡</span>'
      + "</div>"
      + (k.ru ? '<div class="pkg-rule">' + esc(k.ru) + "</div>" : "")
      + "</div>";
  }

  function cardHtml(item, idx) {
    var p = item.park;
    var key = p.n + "|" + (p.a || "");
    var dist = item.d != null ? '<span class="card-dist">' + distText(item.d) + "</span>" : "";
    var open = !!state.expanded[key];
    var html = '<div class="card" data-idx="' + idx + '" data-key="' + esc(key) + '">'
      + '<div class="card-hd"><div class="card-name">' + esc(p.n) + "</div>" + dist + "</div>"
      + '<div class="card-sub">' + esc((p.d ? p.d + " · " : "") + (p.i || "") + (p.a ? " · " + p.a : "")) + "</div>"
      + '<div class="card-meta">'
      + '<span class="card-price">最低<b>' + yuan(item.min) + "</b>元起</span>"
      + '<span class="card-count">' + item.pkgs.length + " 个套餐</span>"
      + '<span class="card-arrow">' + (open ? "收起▲" : "展开▼") + "</span>"
      + "</div>";
    if (open) {
      html += '<div class="pkgs">';
      for (var i = 0; i < item.pkgs.length; i++) html += pkgRowHtml(key, item.pkgs[i]);
      html += "</div>";
    }
    return html + "</div>";
  }

  function renderList() {
    var shown = state.page * PAGE_SIZE;
    var end = Math.min(shown, filtered.length);
    var html = "";
    for (var i = 0; i < end; i++) html += cardHtml(filtered[i], i);
    if (!filtered.length) html = '<div class="empty">没有符合条件的套餐，换个筛选试试</div>';
    $("list").innerHTML = html;

    var more = $("more");
    if (filtered.length > shown) {
      more.hidden = false;
      more.textContent = "加载更多（还剩 " + (filtered.length - shown) + " 个车场）";
    } else {
      more.hidden = true;
    }
  }

  function findItem(key) {
    for (var i = 0; i < filtered.length; i++) {
      var p = filtered[i].park;
      if (p.n + "|" + (p.a || "") === key) return filtered[i];
    }
    return null;
  }

  function findPkg(item, pkgId) {
    for (var i = 0; i < item.pkgs.length; i++) {
      if (item.pkgs[i].id === pkgId) return item.pkgs[i];
    }
    return null;
  }

  /* ------------------------------ 交互（事件委托，只绑一次） ------------------------------ */

  function bindListEvents() {
    $("list").addEventListener("click", function (e) {
      var btn = e.target.closest ? e.target.closest(".pkg-btn") : null;
      if (btn) {
        var item = findItem(btn.getAttribute("data-park"));
        var pkg = item && findPkg(item, btn.getAttribute("data-pkg"));
        if (item && pkg) openSheet(item.park, pkg);
        return;
      }
      var card = e.target.closest ? e.target.closest(".card") : null;
      if (card) {
        var key = card.getAttribute("data-key");
        state.expanded[key] = !state.expanded[key];
        renderList();
      }
    });
  }

  /* ------------------------------ 二维码弹层（每个套餐现场画专属直达码） ------------------------------ */

  /* 套餐直达链接：官方海报同款模板（2026-11-10 海报解码验证） */
  function packageUrl(park, pkg) {
    if (!SHARE_CODE || !park.pc || !pkg.id) return QR_GLOBAL;
    return "https://m.jparking.cn/carParkDetail?detailTab=service&sourceId=FXFX02"
      + "&showPackageId=" + encodeURIComponent(pkg.id)
      + "&parkCode=" + encodeURIComponent(park.pc)
      + "&shareCode=" + encodeURIComponent(SHARE_CODE);
  }

  /* 运行时画码：Canvas 2D 容器完全支持，纯 JS 编码器无外部依赖 */
  function drawQrDataUrl(text) {
    var qr = null;
    for (var t = 1; t <= 10 && !qr; t++) {
      try {
        var cand = window.qrcode(t, "M");
        cand.addData(text);
        cand.make();
        qr = cand;
      } catch (e) { /* 容量不足换更大 typeNumber */ }
    }
    if (!qr) return "";
    var count = qr.getModuleCount();
    var cell = 8;
    var margin = 16;
    var size = count * cell + margin * 2;
    var canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    var ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = "#000000";
    for (var r = 0; r < count; r++) {
      for (var c2 = 0; c2 < count; c2++) {
        if (qr.isDark(r, c2)) {
          ctx.fillRect(margin + c2 * cell, margin + r * cell, cell, cell);
        }
      }
    }
    return canvas.toDataURL("image/png");
  }


  function openSheet(park, pkg) {
    $("shPark").textContent = park.n;
    $("shPark").title = park.n;
    $("shPkg").innerHTML =
      '<div class="sh-pkg-name">' + esc(pkg.n) + "</div>"
      + '<div class="sh-pkg-tags">' + pkgTagsHtml(pkg) + (park.a ? " · " + esc(park.a) : "") + "</div>"
      + '<div class="sh-pkg-price">' + yuan(pkg.pr) + " 元"
      + (pkg.po > pkg.pr ? '<small>原价 ' + yuan(pkg.po) + " 元</small>" : "") + "</div>"
      + (pkg.ru ? '<div class="sh-pkg-rule">' + esc(pkg.ru) + "</div>" : "");
    $("shQr").src = drawQrDataUrl(packageUrl(park, pkg));
    $("shTip").textContent = "";
    $("sheet").hidden = false;
  }

  function closeSheet() {
    $("sheet").hidden = true;
  }

  function saveQr() {
    var tip = $("shTip");
    var qrSrc = $("shQr").src || "";
    if (!qrSrc) {
      tip.textContent = "二维码未生成，请重试";
      return;
    }
    var mini = getMini();
    if (!mini || typeof mini.saveImageToPhotosAlbum !== "function") {
      tip.textContent = "浏览器预览：长按图片保存（小红书内点按钮可直接存相册）";
      return;
    }
    getBuildVersion().then(function (version) {
      if (version && !clientVersionAtLeast(version, SAVE_MIN_VERSION)) {
        tip.textContent = "当前小红书版本过低，请升级到最新版再保存";
        return;
      }
      tip.textContent = "保存中…";
      mini.saveImageToPhotosAlbum({ filePath: qrSrc })
        .then(function () {
          tip.textContent = "已保存 ✓ 打开微信扫一扫 → 右上角「相册」选这张码";
        })
        .catch(function (err) {
          tip.textContent = err && err.errCode === 20002
            ? "相册权限未开启，请到手机设置里允许小红书访问相册"
            : "保存失败，可以截图这张二维码代替";
        });
    });
  }

  /* ------------------------------ 定位（平台 API 优先，浏览器降级） ------------------------------ */

  /* WGS-84 → GCJ-02 纠偏（中国大陆范围），浏览器定位坐标须转换后才能与库内 GCJ-02 车场坐标对齐 */
  function wgs2gcj(lat, lng) {
    if (lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271) return [lat, lng];
    var a = 6378245.0, ee = 0.00669342162296594323;
    var dLat = trLat(lng - 105.0, lat - 35.0);
    var dLng = trLng(lng - 105.0, lat - 35.0);
    var radLat = lat / 180.0 * Math.PI;
    var magic = Math.sin(radLat); magic = 1 - ee * magic * magic;
    var sq = Math.sqrt(magic);
    dLat = (dLat * 180.0) / ((a * (1 - ee)) / (magic * sq) * Math.PI);
    dLng = (dLng * 180.0) / (a / sq * Math.cos(radLat) * Math.PI);
    return [lat + dLat, lng + dLng];
  }
  function trLat(x, y) {
    var r = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
    r += (20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0 / 3.0;
    r += (20.0 * Math.sin(y * Math.PI) + 40.0 * Math.sin(y / 3.0 * Math.PI)) * 2.0 / 3.0;
    r += (160.0 * Math.sin(y / 12.0 * Math.PI) + 320.0 * Math.sin(y * Math.PI / 30.0)) * 2.0 / 3.0;
    return r;
  }
  function trLng(x, y) {
    var r = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
    r += (20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0 / 3.0;
    r += (20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin(x / 3.0 * Math.PI)) * 2.0 / 3.0;
    r += (150.0 * Math.sin(x / 12.0 * Math.PI) + 300.0 * Math.sin(x / 30.0 * Math.PI)) * 2.0 / 3.0;
    return r;
  }

  function onLocated(lat, lng, btn) {
    // 定位说了算：无条件切到最近的有数据城市 + 距离排序，不做任何误差判断
    var target = nearestIndexCity(lat, lng);
    var proceed = function () {
      state.lat = lat;
      state.lng = lng;
      if (state.sort !== "dist") {
        state.sort = "dist";
        $("sortDist").classList.add("on");
        $("sortPrice").classList.remove("on");
      }
      applyFilters();
      btn.textContent = "已定位 ✓";
      btn.classList.remove("off");
    };

    if (target && target.entry.c !== DATA.city) {
      pickCity(target.entry, function () {
        if (DATA.city === target.entry.c) {
          showNotice("已定位到" + cityShort(target.entry.c) + "，已切换本城数据");
        }
        proceed();
      });
      return;
    }
    proceed();
  }

  function locateFail(btn, msg) {
    btn.textContent = msg;
    btn.classList.add("off");
  }

  var noticeTimer = null;
  function showNotice(text) {
    var box = $("notice");
    box.textContent = text;
    box.hidden = false;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(function () { box.hidden = true; }, 6000);
  }

  /* 普通浏览器路径：navigator.geolocation（WGS-84）→ 纠偏为 GCJ-02。
     仅当 window.xhs 不存在时才会走到这里；容器内平台分支优先且浏览器定位被禁，双路径互不干扰。 */
  function browserLocate(btn) {
    if (!navigator.geolocation || typeof navigator.geolocation.getCurrentPosition !== "function") {
      locateFail(btn, "此环境不支持定位");
      return;
    }
    btn.textContent = "定位中…";
    navigator.geolocation.getCurrentPosition(
      function (pos) {
        if (!isFinite(pos.coords.latitude) || !isFinite(pos.coords.longitude)) {
          locateFail(btn, "定位失败，可手动筛选");
          return;
        }
        var gcj = wgs2gcj(pos.coords.latitude, pos.coords.longitude);
        onLocated(gcj[0], gcj[1], btn);
      },
      function () { locateFail(btn, "未授权定位，可手动筛选"); },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 }
    );
  }

  function locate() {
    var btn = $("btnLoc");
    var mini = getMini();
    if (mini && typeof mini.getLocation === "function") {
      // 小红书容器：平台定位，返回即 GCJ-02
      getBuildVersion().then(function (version) {
        if (version && !clientVersionAtLeast(version, LOC_MIN_VERSION)) {
          locateFail(btn, "小红书版本过低，无法定位");
          return;
        }
        btn.textContent = "定位中…";
        mini.getLocation({ type: "gcj02" })
          .then(function (loc) {
            if (isFinite(loc.latitude) && isFinite(loc.longitude)) {
              onLocated(loc.latitude, loc.longitude, btn);
            } else {
              locateFail(btn, "定位失败，可手动筛选");
            }
          })
          .catch(function () { locateFail(btn, "未授权定位，可手动筛选"); });
      });
      return;
    }
    browserLocate(btn);
  }

  /* ------------------------------ 城市切换（assets 按需加载 + 选择记忆） ------------------------------ */

  function cityShort(name) {
    return String(name || "").replace(/市$/, "") || "城市";
  }

  function lsSet(key, data) {
    try { localStorage.setItem("zc_" + key, JSON.stringify(data)); return true; } catch (e) { return false; }
  }

  /* Storage JS API（9.46+）优先，浏览器存储降级；写入失败必须容忍 */
  function storageSet(key, data) {
    var mini = getMini();
    if (!mini || typeof mini.setStorage !== "function") return Promise.resolve(lsSet(key, data));
    return getBuildVersion().then(function (version) {
      if (version && !clientVersionAtLeast(version, 9460)) return lsSet(key, data);
      return mini.setStorage({ key: key, data: JSON.stringify(data) })
        .then(function () { return true; })
        .catch(function () { return lsSet(key, data); });
    });
  }

  function storageGet(key, cb) {
    var mini = getMini();
    var fallback = function () {
      try {
        var v = localStorage.getItem("zc_" + key);
        cb(v ? JSON.parse(v) : null);
      } catch (e) { cb(null); }
    };
    if (!mini || typeof mini.getStorage !== "function") { fallback(); return; }
    getBuildVersion().then(function (version) {
      if (version && !clientVersionAtLeast(version, 9460)) { fallback(); return; }
      mini.getStorage({ key: key })
        .then(function (res) {
          try { cb(res.data ? JSON.parse(res.data) : null); } catch (e) { cb(null); }
        })
        .catch(fallback);
    });
  }

  function applyCity(data, entry) {
    if (entry.f) loadedFiles[entry.f] = data;
    DATA = data;
    state.cityFile = entry.f || "";
    state.district = "";
    state.industry = "";
    state.type = "";
    state.slot = "";
    state.page = 1;
    state.expanded = {};
    updateFilterBadge();
    $("cityTag").textContent = DATA.city ? "·" + DATA.city + "版" : "";
    $("btnCity").textContent = cityShort(DATA.city);
    applyFilters();
    storageSet("city", { file: entry.f || "", name: DATA.city });
  }

  function pickCity(entry, done) {
    var finish = done || function () {};
    $("cpanel").hidden = true;
    if ((entry.f || "") === state.cityFile) { finish(); return; }
    var btn = $("btnCity");
    var prevLabel = btn.textContent;
    if (!entry.f) { applyCity(window.__JTC_DATA__, entry); finish(); return; }
    if (loadedFiles[entry.f]) { applyCity(loadedFiles[entry.f], entry); finish(); return; }
    btn.textContent = "加载中…";
    var script = document.createElement("script");
    script.src = "./assets/" + entry.f;
    script.onload = function () {
      var data = window.__JTC_CITY_DATA__;
      if (data && data.city === entry.c && data.parks && data.parks.length) {
        applyCity(data, entry);
      } else {
        btn.textContent = prevLabel;
        showNotice("城市数据异常，请重试");
      }
      finish();
    };
    script.onerror = function () {
      btn.textContent = prevLabel;
      showNotice("城市数据加载失败，请点击城市重试");
      finish();
    };
    document.body.appendChild(script);
  }

  /* 定位点 → 最近的有数据城市（含中心坐标才参与匹配） */
  function nearestIndexCity(lat, lng) {
    var best = null;
    var bestDist = Infinity;
    for (var i = 0; i < INDEX.cities.length; i++) {
      var c = INDEX.cities[i];
      if (!c.g) continue;
      var d = haversine(lat, lng, c.g[1], c.g[0]);
      if (d < bestDist) { bestDist = d; best = c; }
    }
    return best ? { entry: best, distM: bestDist } : null;
  }

  function renderCityPanel(kw) {
    var shown = [];
    for (var i = 0; i < INDEX.cities.length; i++) {
      var c = INDEX.cities[i];
      if (!kw || c.c.indexOf(kw) >= 0) shown.push({ c: c, idx: i });
    }
    var html = "";
    if (!kw && shown.length) {
      html += '<div class="fsec"><div class="fsec-title">热门城市</div><div class="fgrid">';
      for (var h = 0; h < shown.length && h < 8; h++) {
        html += '<button class="fbtn' + (shown[h].c.c === DATA.city ? " on" : "") + '" data-ci="' + shown[h].idx + '">'
          + esc(cityShort(shown[h].c.c)) + "</button>";
      }
      html += "</div></div>";
    }
    html += '<div class="fsec"><div class="fsec-title">'
      + (kw ? "搜索结果 " + shown.length + " 个" : "全部城市 " + shown.length + " 个")
      + "</div>";
    for (var r = 0; r < shown.length; r++) {
      var it = shown[r];
      html += '<button class="city-row' + (it.c.c === DATA.city ? " on" : "") + '" data-ci="' + it.idx + '">'
        + '<span class="cr-name">' + esc(it.c.c) + '</span>'
        + '<span class="cr-count">' + it.c.n + " 场 / " + it.c.p + " 套餐</span></button>";
    }
    html += "</div>";
    $("cityBody").innerHTML = html;
  }

  function openCityPanel() {
    $("cityKw").value = "";
    renderCityPanel("");
    $("cpanel").hidden = false;
  }

  /* ------------------------------ 初始化 ------------------------------ */

  function init() {
    $("cityTag").textContent = DATA.city ? "·" + DATA.city + "版" : "";
    $("upd").textContent = DATA.updatedAt || "";

    $("btnLoc").addEventListener("click", locate);
    bindListEvents();

    $("btnFilter").addEventListener("click", openFilterPanel);
    $("fClose").addEventListener("click", function () { $("fpanel").hidden = true; });
    $("fReset").addEventListener("click", function () {
      draft = { district: "", industry: "", type: "", slot: "" };
      renderFilterPanel();
    });
    $("fApply").addEventListener("click", commitFilter);
    $("fpanel").addEventListener("click", function (e) {
      if (e.target === $("fpanel")) $("fpanel").hidden = true;
    });

    $("btnCity").addEventListener("click", openCityPanel);
    $("cClose").addEventListener("click", function () { $("cpanel").hidden = true; });
    $("cpanel").addEventListener("click", function (e) {
      if (e.target === $("cpanel")) $("cpanel").hidden = true;
    });
    $("cityBody").addEventListener("click", function (e) {
      var b = e.target.closest ? e.target.closest("[data-ci]") : null;
      if (b) pickCity(INDEX.cities[Number(b.getAttribute("data-ci"))]);
    });
    var cityTimer = null;
    $("cityKw").addEventListener("input", function (e) {
      clearTimeout(cityTimer);
      cityTimer = setTimeout(function () {
        renderCityPanel((e.target.value || "").trim());
      }, 200);
    });

    // 恢复上次选择的城市
    storageGet("city", function (saved) {
      if (!saved || !saved.file) return;
      for (var i = 0; i < INDEX.cities.length; i++) {
        if (INDEX.cities[i].f === saved.file) { pickCity(INDEX.cities[i]); return; }
      }
    });
    updateFilterBadge();

    $("sortDist").addEventListener("click", function () {
      state.sort = "dist";
      $("sortDist").classList.add("on");
      $("sortPrice").classList.remove("on");
      if (state.lat == null) {
        locate();
      } else {
        applyFilters();
      }
    });
    $("sortPrice").addEventListener("click", function () {
      state.sort = "price";
      $("sortPrice").classList.add("on");
      $("sortDist").classList.remove("on");
      applyFilters();
    });
    $("more").addEventListener("click", function () {
      state.page += 1;
      renderList();
    });

    $("shClose").addEventListener("click", closeSheet);
    $("shSave").addEventListener("click", saveQr);
    $("notice").addEventListener("click", function () {
      clearTimeout(noticeTimer);
      $("notice").hidden = true;
    });
    $("sheet").addEventListener("click", function (e) {
      if (e.target === $("sheet")) closeSheet();
    });

    var kwTimer = null;
    $("kw").addEventListener("input", function (e) {
      clearTimeout(kwTimer);
      kwTimer = setTimeout(function () {
        state.kw = e.target.value || "";
        applyFilters();
      }, 250);
    });

    applyFilters();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

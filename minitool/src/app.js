/* 泊月·小红书小工具 v3 —— UI 对齐线上站（src/components/HomeSearch/ParkCard/FilterSheet/LocationSheet/PackageSheet）
 * ES2017（Chrome 61 基线），无外部依赖，经典脚本（无 import/export）。
 * 数据层（过滤/排序/定位/切城/出码/保存）沿用 v2 实现；渲染层换成站点同款。
 * 平台 API 调用前先做方法存在性检测 + buildVersion 版本门禁（js-api.md 规范）：
 *   getLocation 9.49+ / saveImageToPhotosAlbum 9.42+ / setStorage 9.46+，低版本走降级提示。
 */
(function () {
  "use strict";

  var DATA = window.__JTC_DATA__ || { city: "", updatedAt: "", parks: [] };
  var INDEX = window.__JTC_INDEX__ || { cities: [] };
  var loadedFiles = { "": DATA };
  var QR_GLOBAL = (window.__JTC_QR__ && window.__JTC_QR__.global) || "";
  var SHARE_CODE = window.__JTC_SHARE__ || "";

  /**
   * 容器平台。默认 xhs——小红书机审不允许页面出现码图，凭证只能在点击时
   * 内存生成写相册，所以未注入时按最严的走。B 站 Toy 构建时注入 "toy"，
   * 弹层直接显示码（那里的用户要能一眼扫出来，否则工具等于没有出口）。
   */
  var PLATFORM = window.__JTC_PLATFORM__ || "xhs";

  /* 展示常量与口径函数全部来自 src/shared/domain.ts（构建时转译成 shared.js）——
     以前是手抄一份，站点改了文案/折算规则这边不会跟，同一个套餐会出现两个价。 */
  var SHARED = window.__JTC_SHARED__;
  if (!SHARED) throw new Error("shared.js 缺失：构建产物不完整，请重新运行 npm run toy / minitool");
  var TYPE_LABEL = SHARED.TYPE_LABEL;
  var TYPE_ORDER = SHARED.TYPE_ORDER;        // 月/季/半年/年/日/次（与站点 PACKAGE_TYPES 同序）
  var SLOT_LABEL = SHARED.SLOT_LABEL;
  var SLOT_ORDER = SHARED.SLOT_ORDER;        // 全天/白天/夜间（与站点 TIME_SLOTS 同序）
  var INDUSTRIES = SHARED.INDUSTRIES;
  var PRICE_STEPS = SHARED.PRICE_STEPS;      // 按折合月价，单位分

  var PAGE_SIZE = 30;
  var LOC_MIN_VERSION = 9490;      // getLocation 需客户端 9.49+
  var SAVE_MIN_VERSION = 9420;     // saveImageToPhotosAlbum 需客户端 9.42+

  var state = {
    kw: "",
    district: "",
    industry: "",
    type: "",
    slot: "",
    maxPrice: 0,
    sort: "recommend",
    lat: null,
    lng: null,
    page: 1,
    cityFile: "",
    /* boot=首帧未定位 / locating=定位请求进行中 / idle=出真列表。
       boot/locating 期间列表区出骨架屏——先给一份「错的推荐」不如给一块占位 */
    geo: "boot",
  };
  var filtered = [];
  var currentSheet = null;   /* 当前弹层对应的套餐：凭证图保存时才在内存生成，页面不渲染 */

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

  /* 折合月价（分/月）：官方数据无精确时长，按类型码推算天数，再走共享的 monthlyPrice 口径 */
  function monthlyPriceOf(pkg) {
    return SHARED.monthlyPrice(pkg.pr || 0, SHARED.daysOfType(pkg.t));
  }

  function minMonthlyOf(list) {
    var min = Infinity;
    for (var i = 0; i < list.length; i++) {
      var v = monthlyPriceOf(list[i]);
      if (v > 0 && v < min) min = v;
    }
    return min === Infinity ? 0 : min;
  }

  /* 规则展示层简写（数据原文不动）：共享实现，含「工作日 工作日」这种重复词压缩 */
  function ruleShort(text) {
    return SHARED.cleanRuleSummary(text || "");
  }

  /* 套餐标签：类型 + 时段（全天不重复展示） */
  function pkgLabel(k) {
    var parts = [];
    if (TYPE_LABEL[k.t]) parts.push(TYPE_LABEL[k.t]);
    if (k.v !== "0" && SLOT_LABEL[k.v]) parts.push(SLOT_LABEL[k.v]);
    return parts.join(" · ") || "套餐";
  }

  /* ------------------------------ 筛选 / 排序（数据层） ------------------------------ */

  function applyFilters() {
    var kw = state.kw.trim().toLowerCase();
    var located = state.lat != null && state.lng != null;
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
        if (state.maxPrice > 0 && monthlyPriceOf(k) > state.maxPrice) continue;
        pkgs.push(k);
      }
      if (!pkgs.length) continue;
      pkgs.sort(function (a, b) { return (a.pr || 0) - (b.pr || 0); });
      var item = { park: p, key: p.n + "|" + (p.a || ""), pkgs: pkgs, d: null, min: minMonthlyOf(pkgs) };
      if (located) {
        var g = p.g || [0, 0];
        item.d = haversine(state.lat, state.lng, g[1], g[0]);
      }
      arr.push(item);
    }

    if (state.sort === "dist" && located) {
      arr.sort(function (a, b) { return a.d - b.d; });
    } else if (state.sort === "recommend" && located) {
      /* 站点推荐排序：距离圈层（≤1km/≤3km/≤10km/更远）优先，同圈层内月均价升序 */
      function ring(d) { return d <= 1000 ? 0 : d <= 3000 ? 1 : d <= 10000 ? 2 : 3; }
      arr.sort(function (a, b) {
        var ra = ring(a.d), rb = ring(b.d);
        return ra !== rb ? ra - rb : a.min - b.min;
      });
    } else {
      arr.sort(function (a, b) { return a.min - b.min; });
    }

    filtered = arr;
    state.page = 1;
    renderList();
    updateToolbar();
  }

  /* ------------------------------ 吸顶工具条（位置/筛选/排序/清空） ------------------------------ */

  function updateToolbar() {
    var locPill = $("btnLoc");
    var label = DATA.city ? cityShort(DATA.city) : "位置";
    if (state.district) label += " · " + state.district;
    locPill.textContent = label;
    locPill.className = "filter-pill shrink" + (DATA.city || state.district ? " on" : "");

    var dirty = state.kw.trim() || state.district || state.industry || state.type
      || state.slot || state.maxPrice > 0 || state.sort !== "recommend";
    $("btnReset").hidden = !dirty;

    $("sortDist").className = "filter-pill"
      + (state.sort === "dist" ? " on" : state.lat == null ? " dim" : "");
    $("sortRec").className = "filter-pill" + (state.sort === "recommend" ? " on" : "");
    $("sortPrice").className = "filter-pill" + (state.sort === "price" ? " on" : "");
  }

  function updateFilterBadge() {
    var n = (state.industry ? 1 : 0) + (state.type ? 1 : 0)
      + (state.slot ? 1 : 0) + (state.maxPrice > 0 ? 1 : 0);
    var badge = $("filterBadge");
    badge.textContent = n;
    badge.hidden = n === 0;
  }

  function setSort(sort) {
    state.sort = sort;
    applyFilters();
    scheduleCloudSave();
  }

  /* ------------------------------ 筛选弹层（FilterSheet 同款四维，确定才生效） ------------------------------ */

  var draft = { industry: "", type: "", slot: "", maxPrice: 0 };

  function fButtonHtml(section, code, label) {
    var on = String(draft[section]) === String(code);
    return '<button class="fbtn' + (on ? " on" : "") + '" data-sec="' + section + '" data-v="' + esc(code) + '">'
      + esc(label) + "</button>";
  }

  function renderFilterPanel() {
    /* 只展示当前城市数据里真实存在的取值，顺序对齐站点常量 */
    var industries = {}, types = {};
    for (var i = 0; i < DATA.parks.length; i++) {
      if (DATA.parks[i].i) industries[DATA.parks[i].i] = 1;
      var pp = DATA.parks[i].p;
      for (var j = 0; j < pp.length; j++) types[pp[j].t] = 1;
    }
    var inds = [];
    for (var a = 0; a < INDUSTRIES.length; a++) if (industries[INDUSTRIES[a]]) inds.push(INDUSTRIES[a]);
    var typeCodes = [];
    for (var b = 0; b < TYPE_ORDER.length; b++) if (types[TYPE_ORDER[b]]) typeCodes.push(TYPE_ORDER[b]);

    var html = "";
    html += '<div class="fsec"><div class="fsec-title">业态</div><div class="fgrid">';
    html += fButtonHtml("industry", "", "全部");
    for (var m = 0; m < inds.length; m++) html += fButtonHtml("industry", inds[m], inds[m]);
    html += "</div></div>";

    html += '<div class="fsec"><div class="fsec-title">套餐类型</div><div class="fgrid">';
    html += fButtonHtml("type", "", "全部");
    for (var t = 0; t < typeCodes.length; t++) {
      html += fButtonHtml("type", typeCodes[t], TYPE_LABEL[typeCodes[t]] || typeCodes[t]);
    }
    html += "</div></div>";

    html += '<div class="fsec"><div class="fsec-title">停放时间</div><div class="fgrid">';
    html += fButtonHtml("slot", "", "全部");
    for (var s = 0; s < SLOT_ORDER.length; s++) {
      html += fButtonHtml("slot", SLOT_ORDER[s], SLOT_LABEL[SLOT_ORDER[s]]);
    }
    html += "</div></div>";

    html += '<div class="fsec"><div class="fsec-title">价格上限</div><div class="fgrid">';
    for (var pr = 0; pr < PRICE_STEPS.length; pr++) {
      html += fButtonHtml("maxPrice", PRICE_STEPS[pr].value, PRICE_STEPS[pr].label);
    }
    html += "</div></div>";

    $("fbody").innerHTML = html;
  }

  function bindFilterPanel() {
    $("fbody").addEventListener("click", function (e) {
      var el = e.target.closest ? e.target.closest(".fbtn") : null;
      if (!el) return;
      var sec = el.getAttribute("data-sec");
      var v = el.getAttribute("data-v") || "";
      if (sec === "maxPrice") v = Number(v) || 0;
      draft[sec] = (String(draft[sec]) === String(v)) ? (sec === "maxPrice" ? 0 : "") : v;
      renderFilterPanel();
    });
  }

  function openFilterPanel() {
    draft = {
      industry: state.industry,
      type: state.type,
      slot: state.slot,
      maxPrice: state.maxPrice,
    };
    renderFilterPanel();
    $("fpanel").hidden = false;
  }

  function commitFilter() {
    state.industry = draft.industry;
    state.type = draft.type;
    state.slot = draft.slot;
    state.maxPrice = draft.maxPrice;
    updateFilterBadge();
    applyFilters();
    $("fpanel").hidden = true;
  }

  /* ------------------------------ 车场卡（ParkCard 同款：chips 直点出码） ------------------------------ */

  function chipHtml(item, k) {
    var origin = k.po > k.pr ? '<span class="chip-origin">¥' + yuan(k.po) + "</span>" : "";
    var month = SHARED.daysOfType(k.t) >= 60
      ? '<div class="chip-month">折合 ¥' + yuan(monthlyPriceOf(k)) + "/月</div>"
      : "";
    return '<button class="pkg-chip" data-park="' + esc(item.key) + '" data-pkg="' + esc(k.id) + '">'
      + '<div class="chip-label">' + esc(pkgLabel(k)) + "</div>"
      + '<div class="chip-price">' + (k.pr > 0 ? "¥" + yuan(k.pr) : "见码") + origin + "</div>"
      + month
      + "</button>";
  }

  function cardHtml(item) {
    var p = item.park;
    var dist = item.d != null ? '<span class="tag tag-brand">' + distText(item.d) + "</span>" : "";
    var industry = p.i ? '<span class="tag tag-muted">' + esc(p.i) + "</span>" : "";
    var sub = (p.d ? p.d : "") + (p.i ? " · " + p.i : "") + (p.a ? " · " + p.a : "");
    /* 套餐全展示：这个工具的价值就是比价，藏掉一半等于让用户看不出差价。
       单个车场最多 21 个套餐，多一两行也比「还有 N 个套餐」这种死提示强。 */
    var chips = "";
    for (var i = 0; i < item.pkgs.length; i++) chips += chipHtml(item, item.pkgs[i]);
    return '<div class="card">'
      + '<div class="card-hd">'
      + '<div class="card-main">'
      + '<div class="card-name">' + esc(p.n) + "</div>"
      + '<div class="card-sub">' + esc(sub) + "</div>"
      + "</div>"
      + '<div class="card-tags">' + industry + dist + "</div>"
      + "</div>"
      + '<div class="pkg-chips">' + chips + "</div>"
      + "</div>";
  }

  function skeletonHtml() {
    var html = "";
    for (var i = 0; i < 4; i++) {
      html += '<div class="skel-card">'
        + '<div class="skel-line w50"></div><div class="skel-line w75"></div>'
        + '<div class="skel-chips"><div class="skel-chip"></div><div class="skel-chip"></div><div class="skel-chip"></div></div>'
        + "</div>";
    }
    return html;
  }

  function renderList() {
    if (state.geo !== "idle" || locatingHard) {
      $("list").innerHTML = skeletonHtml();
      $("sentinel").hidden = true;
      $("noMore").hidden = true;
      return;
    }
    var shown = state.page * PAGE_SIZE;
    var end = Math.min(shown, filtered.length);
    var html = "";
    for (var i = 0; i < end; i++) html += cardHtml(filtered[i]);

    if (!filtered.length) {
      var kw = state.kw.trim();
      html = '<div class="empty"><div class="empty-title">没找到匹配的车场</div>';
      if (kw) {
        html += '<div class="empty-sub">站里收录的是具体车场、楼宇和小区名，<br>换个名称试试，或者直接按位置看。</div>'
          + '<div class="empty-btns">'
          + '<button class="btn-brand-solid" id="btnNearMe" type="button">按我的位置找附近</button>'
          + '<button class="btn-brand-line" id="btnWholeCity" type="button">看' + esc(cityShort(DATA.city) || "全部") + "车场</button>"
          + "</div>";
      } else {
        html += '<div class="empty-sub">当前筛选条件下没有车场，放宽业态 / 时段 / 价格试试。</div>'
          + '<div class="empty-btns"><button class="btn-brand-solid" id="btnClearAll" type="button">清空筛选</button></div>';
      }
      html += "</div>";
    }
    $("list").innerHTML = html;

    /* 「加载更多」按钮已换成滚动哨兵：滑到底自动续页，没有更多时藏哨兵、亮提示 */
    $("sentinel").hidden = !(filtered.length > shown);
    $("noMore").hidden = !(filtered.length > 0 && filtered.length <= shown);
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

  /* ------------------------------ 套餐详情弹层（PackageSheet 同款：先价格后凭证） ------------------------------ */

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

  /** 非小红书容器（B 站 Toy / 桌面浏览器）存图：没有平台相册 API，用 a[download] */
  function downloadDataUrl(dataUrl, filename) {
    var a = document.createElement("a");
    a.href = dataUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function isMobileUA() {
    return /Android|iPhone|iPad|iPod|Mobile|MicroMessenger/i.test(navigator.userAgent);
  }

  function openSheet(item, pkg) {
    var park = item.park;
    $("shPark").textContent = park.n;
    /* 地址紧跟车场名（用户看名字时要知道在哪）；容器禁外链，导航只能到站点端用 */
    var addrTop = $("shAddrTop");
    if (park.a) {
      addrTop.textContent = park.a;
      addrTop.hidden = false;
    } else {
      addrTop.hidden = true;
    }
    var distBox = $("shDist");
    if (item.d != null) {
      distBox.textContent = "距你 " + distText(item.d);
      distBox.hidden = false;
    } else {
      distBox.hidden = true;
    }

    /* 先给价格和规格，再给码：用户先判断值不值，再决定扫不扫 */
    var facts = [];
    if (TYPE_LABEL[pkg.t]) facts.push(TYPE_LABEL[pkg.t]);
    if (pkg.v !== "0" && SLOT_LABEL[pkg.v]) facts.push(SLOT_LABEL[pkg.v]);
    var html = pkg.pr > 0 ? '<span class="big-price">¥' + yuan(pkg.pr) + "</span>" : "";
    if (pkg.po > pkg.pr) html += '<span class="origin">¥' + yuan(pkg.po) + "</span>";
    if (pkg.pr > 0 && SHARED.daysOfType(pkg.t) >= 60) {
      html += '<span class="per-month">折合 ¥' + yuan(monthlyPriceOf(pkg)) + "/月</span>";
    }
    for (var f = 0; f < facts.length; f++) html += '<span class="fact">' + esc(facts[f]) + "</span>";
    $("shPkg").innerHTML = html;

    /* 可停时段是决策参数不是页脚细则：紧跟标签/价格（数据原文不动，仅显示层简写） */
    var ruleTop = $("shRule");
    if (pkg.ru) {
      ruleTop.textContent = ruleShort(pkg.ru);
      ruleTop.hidden = false;
    } else {
      ruleTop.hidden = true;
    }

    currentSheet = { park: park, pkg: pkg };
    var qrUrl = packageUrl(park, pkg);
    $("shSave").hidden = qrUrl === "";

    /* 凭证图：小红书一律不渲染（机审红线，只在点击时内存生成写相册）；
       Toy / 浏览器不把码摆出来，用户就没有任何办理入口 */
    var qrBox = $("shQr");
    var qrImg = $("shQrImg");
    var qrData = PLATFORM === "xhs" || !qrUrl ? "" : drawQrDataUrl(qrUrl);
    if (qrData) {
      qrImg.src = qrData;
      qrBox.hidden = false;
    } else {
      qrImg.removeAttribute("src");
      qrBox.hidden = true;
    }
    $("shGuide").textContent = PLATFORM === "xhs"
      ? "点上方按钮保存凭证图，在停车场官方小程序中从相册选取即可使用"
      : "用微信扫一扫上方凭证；点按钮可存到相册（存不进时长按凭证图），再用微信「扫一扫 → 相册」选取";

    $("shTip").textContent = "";
    $("shTip").className = "sh-tip";
    $("sheet").hidden = false;

    /* App 里宿主没下发相册能力时（预览页就是这样），按钮点了只会报错——
       直接换成长按指引，别给一个点了没反应的按钮 */
    adaptSaveEntry();
  }

  /* 相册能力探测结果缓存：一次出码弹层只查一次 JSB */
  var saveAbility = null;

  function adaptSaveEntry() {
    var t = toySdk();
    if (!t || typeof t.saveImageToAlbum !== "function") return;   // 非 Toy 环境：按钮保留，a[download] 可用
    var apply = function (ok) {
      saveAbility = ok;
      if (ok) return;
      /* 只有真的在 App 容器里（UA 有 BiliApp）才藏按钮：那里下载是落不了地的 */
      if (!toyInApp()) return;
      $("shSave").hidden = true;
      $("shGuide").textContent = "长按上方凭证图 →「存储图像」，再用微信「扫一扫 → 相册」选取";
    };
    if (saveAbility !== null) { apply(saveAbility); return; }
    if (typeof t.isSupport !== "function") return;
    Promise.resolve(t.isSupport("saveImageToAlbum")).then(apply).catch(function () { /* 保持按钮 */ });
  }

  function closeSheet() {
    $("sheet").hidden = true;
  }

  /* 点击「保存办理凭证」：此刻才在内存画凭证图（数据 URL）并直接写相册——
     页面上没有任何码图渲染，包内不落任何码图（v1.0.0 机审「涉嫌违法违规」整改核心） */
  function saveQr() {
    var tip = $("shTip");
    if (!currentSheet) {
      tip.textContent = "请先选择套餐";
      return;
    }
    var qrSrc = drawQrDataUrl(packageUrl(currentSheet.park, currentSheet.pkg));
    if (!qrSrc) {
      tip.textContent = "凭证生成失败，请重新打开";
      return;
    }
    var mini = getMini();
    if (!mini || typeof mini.saveImageToPhotosAlbum !== "function") {
      /* B站 Toy：App 内走平台相册接口（WebView 里 a[download] 根本落不了地）。
         三种结果分开说话：成功 / 环境不支持 / 真失败（带原因） */
      var fileName = "泊月-" + currentSheet.park.n + "-办理凭证.png";
      tip.textContent = "保存中…";
      toySaveImage(qrSrc).then(function (res) {
        if (res.ok) {
          tip.textContent = "凭证已存入相册 ✓ 打开微信「扫一扫 → 相册」选这张图";
          return;
        }
        if (res.reason === "unsupported" || res.reason === "sdk_missing") {
          downloadDataUrl(qrSrc, fileName);
          /* 分开说：SDK 靠 UA 里的 BiliApp 判断在不在 App 容器内，
             不在容器里（含 App 内置浏览器、私信外链）相册接口一律不可用 */
          tip.className = "sh-tip err";
          tip.textContent = toyInApp()
            ? "宿主没有上报相册能力（预览页常见），发版后在作品页里再试；也可长按上方凭证图保存"
            : "当前页面不在 B站 App 容器内（UA 无 BiliApp），系统相册接口用不了；请长按上方凭证图保存";
          return;
        }
        /* 走到这里是真的失败了：把 SDK 的原始报错摆出来，
           用户截图发过来就能判断是权限被拒还是接口问题 */
        tip.className = "sh-tip err";
        tip.textContent = "保存失败：" + res.reason
          + "。请到手机「设置 → 应用 → 哔哩哔哩 → 权限」里允许存储/照片，再点一次；也可长按上方凭证图保存";
        if (window.console && console.warn) console.warn("[save-qr] " + res.reason);
      });
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
          tip.textContent = "凭证已存入相册 ✓ 在停车场官方小程序中从相册选取即可使用";
        })
        .catch(function (err) {
          tip.textContent = err && err.errCode === 20002
            ? "相册权限未开启，请到手机设置里允许小红书访问相册"
            : "保存失败，请重试";
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
    r += (160.0 * Math.sin(y / 12.0 * Math.PI) + 320.0 * Math.sin(y / 30.0 * Math.PI)) * 2.0 / 3.0;
    return r;
  }
  function trLng(x, y) {
    var r = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
    r += (20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0 / 3.0;
    r += (20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin(x / 3.0 * Math.PI)) * 2.0 / 3.0;
    r += (150.0 * Math.sin(x / 12.0 * Math.PI) + 300.0 * Math.sin(x / 30.0 * Math.PI)) * 2.0 / 3.0;
    return r;
  }

  /* 定位成功：切最近城市 → 按 wantSort 出列表。
     成功不需要 toast——骨架屏换真实列表就是反馈，排序语义看筛选条的激活态；
     黄条只留给「定位中 / 失败 / 城市分包加载」这些真正需要说话的时刻 */
  function onLocated(lat, lng, wantSort, silent) {
    var target = nearestIndexCity(lat, lng);
    var proceed = function () {
      if (locateTimer) { clearTimeout(locateTimer); locateTimer = null; }
      /* 「正在获取定位」黄条只属于定位过程：结果一出立即清掉，绝不和结果同屏 */
      if (noticeTimer) { clearTimeout(noticeTimer); noticeTimer = null; }
      $("notice").hidden = true;
      /* 最短骨架展示 600ms：定位极快（权限已开、缓存命中）时也保证过渡不被看成「闪一下」 */
      var unlock = function () {
        locatingHard = false;
        state.geo = "idle";
        state.lat = lat;
        state.lng = lng;
        $("geoRetry").hidden = true;
        setSort(wantSort);
      };
      var elapsed = Date.now() - locateStartedAt;
      if (elapsed < 600) { setTimeout(unlock, 600 - elapsed); } else { unlock(); }
    };

    if (target && target.entry.c !== DATA.city) {
      pickCity(target.entry, function () {
        proceed();
      });
      return;
    }
    proceed();
  }

  /* 定位失败文案：三个环境三种出路——
     小红书 / B站 App 是「去系统设置开权限」，普通浏览器则是「在地址栏允许」。
     以前一律写小红书，Toy 里报错会指错地方。 */
  function geoFailCopy(msg) {
    if (getMini()) return msg + "。可到手机设置里允许小红书使用定位，或直接点「位置」手动选城市";
    if (toyInApp()) return msg + "。也可以直接点「位置」手动选城市";
    return msg + "。可在浏览器地址栏允许本站使用定位，或直接点「位置」手动选城市";
  }

  function locateFail(msg) {
    if (locateTimer) { clearTimeout(locateTimer); locateTimer = null; }
    var failNow = function () {
      locatingHard = false;
      state.geo = "idle";
      applyFilters();
    /* 授权动作后 2 秒内就失败 = 系统层早已拒绝定位（平台不会再弹权限窗）：
       不裸露默认列表，重弹引导卡并写清出路——用户去设置开权限后点卡即成 */
    var fast = locateStartedAt && Date.now() - locateStartedAt < 2000;
    if (fast && getMini()) {
      $("geoRetry").hidden = true;
      $("geoDesc").textContent = "定位权限未开启：请到手机「设置」里允许小红书使用定位，再回来点「开启定位」";
      $("geoPanel").hidden = false;
      return;
    }
    /* B站 App 里 WebView 多半不给定位：别把用户支到系统设置页（那儿没有这一项），
       指向「位置」手动选城市更实在 */
    if (fast && toyInApp()) {
      $("geoRetry").hidden = true;
      $("geoDesc").textContent = "没能拿到你的位置：点这里再试一次，或直接点「位置」手动选城市";
      $("geoPanel").hidden = false;
      return;
    }
    /* 慢速失败（信号/超时等）：黄条说原因，重试条常驻列表顶部给一键重试 */
    $("geoRetry").hidden = false;
    showNotice(geoFailCopy(msg), 12000);
    };
    var elapsed = Date.now() - locateStartedAt;
    if (elapsed < 600) { setTimeout(failNow, 600 - elapsed); } else { failNow(); }
  }

  var noticeTimer = null;
  function showNotice(text, duration) {
    var box = $("notice");
    box.textContent = text;
    box.hidden = false;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(function () { box.hidden = true; }, duration || 6000);
  }

  /* 浏览器定位可用性：B站 Toy（App 内 WebView / PC 详情页）与本地调试都走这条 */
  function canBrowserGeo() {
    return !!(navigator.geolocation && typeof navigator.geolocation.getCurrentPosition === "function");
  }

  /* 普通浏览器路径：navigator.geolocation（WGS-84）→ 纠偏为 GCJ-02。
     仅当 window.xhs 不存在时才会走到这里；容器内平台分支优先且浏览器定位被禁，双路径互不干扰。
     silent = 进页面时的自动尝试：失败不弹黄条（引导卡/重试条会说人话） */
  function browserLocate(wantSort, silent) {
    if (!canBrowserGeo()) {
      locateFail("此环境不支持定位");
      return;
    }
    if (!silent) showNotice("正在获取定位，若弹出权限窗口请选择允许", 10000);
    navigator.geolocation.getCurrentPosition(
      function (pos) {
        if (!isFinite(pos.coords.latitude) || !isFinite(pos.coords.longitude)) {
          locateFail("定位失败");
          return;
        }
        var gcj = wgs2gcj(pos.coords.latitude, pos.coords.longitude);
        onLocated(gcj[0], gcj[1], wantSort);
      },
      function (err) {
        var why = err && err.code === 1 ? "定位权限被拒绝" : err && err.code === 3 ? "定位超时" : "位置不可用";
        locateFail(why + (err && err.code ? "（" + err.code + "）" : ""));
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 }
    );
  }

  /* silent = 自动定位（进页面）：失败不打扰首屏；手动触发才给完整提示 */
  var locateTimer = null;
  var locateStartedAt = 0;
  /* 定位硬锁：置位期间列表区无条件只渲染骨架，唯一解锁口是拿到定位结果（成功/终态失败）。
     用户要求「授权到拿到地址之前只看到加载」——不依赖状态机各分支的自觉，锁是最终保证 */
  var locatingHard = false;
  function locate(wantSort, silent) {
    locateStartedAt = Date.now();
    locatingHard = true;
    state.geo = "locating";
    renderList();
    if (locateTimer) clearTimeout(locateTimer);
    /* 超时多半是权限弹窗上停留 + 定位本身耗时（授权到拿地址之间必须一直是骨架/引导，
       不能裸露默认列表）——重弹引导卡给第二次机会，而不是露出错误推荐 */
    locateTimer = setTimeout(function () {
      if (state.geo !== "locating") return;
      locatingHard = false;
      state.geo = "idle";
      applyFilters();
      if (state.lat == null) {
        $("geoPanel").hidden = false;
        showNotice("定位没有完成，请再试一次", 8000);
      }
    }, 20000);
    var mini = getMini();
    if (mini && typeof mini.getLocation === "function") {
      // 小红书容器：平台定位，返回即 GCJ-02
      getBuildVersion().then(function (version) {
        if (version && !clientVersionAtLeast(version, LOC_MIN_VERSION)) {
          if (!silent) locateFail("小红书版本过低，无法定位");
          return;
        }
        if (!silent) showNotice("正在获取定位，若弹出权限窗口请选择允许", 10000);
        mini.getLocation({ type: "gcj02" })
          .then(function (loc) {
            if (isFinite(loc.latitude) && isFinite(loc.longitude)) {
              onLocated(loc.latitude, loc.longitude, wantSort, silent);
            } else if (!silent) {
              locateFail("定位失败");
            }
          })
          .catch(function (err) {
            if (!silent) {
              locateFail("定位未成功" + (err && err.errCode ? "（错误码 " + err.errCode + "）" : "（未授权或定位不可用）"));
            }
          });
      });
      return;
    }
    browserLocate(wantSort, silent); // 非小红书：浏览器定位（B站 Toy 也走这里）
  }

  /* 定位引导：官方 §3.12 要求定位由用户手势触发，页面加载期的自动调用会被平台拦掉——
     每次进页面（还没定位）都弹引导卡，用户点「开启定位」（手势）后立刻定位；
     点「暂不」只关掉本次的卡，下次进来继续引导，直到定位成功为止 */
  function checkGeoAsk() {
    if (state.lat != null) return;
    var mini = getMini();
    if (!mini || typeof mini.getLocation !== "function") {
      /* 非小红书（B站 Toy 的 App / 网页壳、本地调试）：这里以前是「直接出默认列表」，
         于是 Toy 里连权限窗都没弹过，距离永远不出现。
         现在只要浏览器定位可用就走引导；App 内先静默自动试一次（进页面就问权限），
         拿不到再交给引导卡/重试条。 */
      if (!canBrowserGeo()) {
        state.geo = "idle";
        applyFilters();
        return;
      }
      if (toyInApp()) { locate("recommend", true); return; }
      $("geoDesc").textContent = "按你的位置推荐附近能办月卡的车场，远近一目了然";
      $("geoPanel").hidden = false;
      return;
    }
    $("geoDesc").textContent = "按你的位置推荐附近能办月卡的车场，远近一目了然";
    $("geoPanel").hidden = false;
  }

  /* ------------------------------ 容器顶栏避让（fullscreen-experience.md 处方） ------------------------------ */

  /* getWindowInfo（在线文档 §3.11，9.49+）：容器坐标系以容器左上角为原点，
     menuButtons.back/me/share 是宿主按钮的真实矩形——按钮底缘就是遮挡线，
     优先用它；没有按钮矩形再退 safeArea.top / statusBarHeight。
     结果写进 --page-top（hero 与吸顶工具条避让）；探测失败保持 env(safe-area) 兜底。
     文档要求窗口变化后重取——监听一次 resize。 */
  function applyHostTop() {
    try {
      var mini = getMini();
      if (!mini || typeof mini.getWindowInfo !== "function") return;
      var apply = function (info) {
        if (!info) return;
        var top = 0;
        var btns = info.menuButtons || {};
        var names = ["back", "me", "share"];
        for (var i = 0; i < names.length; i++) {
          var b = btns[names[i]];
          if (b && Number(b.bottom)) top = Math.max(top, Number(b.bottom));
        }
        if (!top && info.safeArea && Number(info.safeArea.top)) top = Number(info.safeArea.top);
        if (!top && Number(info.statusBarHeight)) top = Number(info.statusBarHeight);
        if (top > 0) {
          document.documentElement.style.setProperty("--page-top", Math.ceil(top + 6) + "px");
        }
      };
      var queryWin = function () {
        getBuildVersion().then(function (version) {
          if (version && !clientVersionAtLeast(version, LOC_MIN_VERSION)) return;
          return mini.getWindowInfo().then(apply).catch(function () { /* env() 兜底 */ });
        });
      };
      queryWin();
      window.addEventListener("resize", queryWin);
    } catch (e) { /* 保持 env() 兜底 */ }
  }

  /* ------------------------------ 宿主全屏叠层避让（B站 Toy 等 iframe 容器） ------------------------------
     只有「宿主把状态栏/工具条叠在我们画面上层」时才需要让位（App 内就是这样）。
     Toy 的**网页壳**（PC 详情页、发布台预览）相反：它把状态栏和顶栏画在 iframe 外面，
     iframe 从顶栏下方开始（实测 iPhone UA 下 iframe y=44），我们再补 100px 就是纯白留。
     判据用 SDK 自己的那条：UA 带 BiliApp 才是 App 容器（toy-sdk 里就是这个正则）。
     常量取 B站 Android 实测（486px 截图换算）：状态栏 ≈28 + 工具条 ≈44 + 间隙 ≈8 → 84，
     底部操作栏（评论/收藏/点赞）≈52 → 60；iOS 状态栏更高，各加一档。
     App 内真正的值由 applyToyInset（SDK onContainerChange）覆盖，这里只是异步到达前的保底；
     小红书那边同样由 getWindowInfo 写入真实值，这里只填保底值。 */
  function applyEmbedInset() {
    try {
      if (window.self === window.top) return;
      var ua = navigator.userAgent || "";
      var ios = /iPhone|iPad|iPod/i.test(ua);
      var mobile = isMobileUA();
      var inApp = /BiliApp/i.test(ua);
      var root = document.documentElement.style;
      /* 有 toy SDK 但不在 App 内 = 网页壳：内容区已经在壳的顶栏下面，
         不但不补常量，还要显式写 0 压掉宿主可能注入的 --safe-area-inset-top
         （CSS 里 var(--page-top, var(--safe-area-inset-top, env(...))) 是这个兜底链）。 */
      if (window.toy && !inApp) {
        root.setProperty("--page-top", "0px");
        root.setProperty("--page-bottom", "0px");
        return;
      }
      /* 其余非移动容器（桌面浏览器）同样不让——桌面壳的顶栏也在页面外 */
      if (!mobile && !inApp) return;
      if (!root.getPropertyValue("--page-top")) {
        root.setProperty("--page-top", (ios ? 100 : 84) + "px");
      }
      if (!root.getPropertyValue("--page-bottom")) {
        root.setProperty("--page-bottom", (ios ? 72 : 60) + "px");
      }
    } catch (e) { /* 保持 env() 兜底 */ }
  }

  /* ------------------------------ B站 Toy SDK（toy-sdk.js，仅 toy 包注入） ------------------------------
     文档：Toy JS SDK。能力只在 B站 App 内有值，Web 端多数抛 unsupported，
     所以每个入口都先看 window.toy 在不在、再看 isSupport，缺能力就静默降级到原逻辑。 */

  function toySdk() {
    return window.toy || null;
  }

  /* 官方 SDK 用 UA 里的 BiliApp 判断「在不在 App 容器内」（toy-sdk.js 里就是
     /BiliApp/i.test(navigator.userAgent)），拿不到这个标记时所有系统能力都不可用。
     这里复用同一条判据，只用于把失败原因说准。 */
  function toyInApp() {
    return /BiliApp/i.test(navigator.userAgent || "");
  }

  /* 容器安全区：getContainerState / onContainerChange 给出 CSS px 的 safeArea——
     App 内这就是状态栏 + 工具条 + 底部操作栏的真实占位，比常量准。
     订阅会先推一次完整状态，之后仅变化时推；Web 端两个能力都不支持，保持常量兜底。 */
  function applyToyInset() {
    var t = toySdk();
    if (!t || typeof t.onContainerChange !== "function") return;
    var root = document.documentElement.style;
    var apply = function (state) {
      if (!state || !state.safeArea) return;
      var top = Math.ceil(Number(state.safeArea.top) || 0);
      var bottom = Math.ceil(Number(state.safeArea.bottom) || 0);
      root.setProperty("--page-top", top + "px");
      root.setProperty("--page-bottom", bottom + "px");
    };
    try {
      /* Web 端调用会抛/拒「not supported on web」，用 Promise.resolve 统一吃掉，
         否则控制台多出一条 Uncaught (in promise)，与「怎么没生效」混在一起不好排查 */
      Promise.resolve(t.onContainerChange(apply)).catch(function () { /* 保持现状 */ });
      if (typeof t.getContainerState === "function") {
        Promise.resolve(t.getContainerState()).then(apply).catch(function () { /* 保持现状 */ });
      }
    } catch (e) { /* 保持现状 */ }
  }

  /* 存办理凭证：App 内走平台相册接口（WebView 里 a[download] 不落地）。
     返回 Promise<{ ok, reason }>——reason 原样带回 SDK 的报错文案，
     真机上「点了没反应/没进相册」时，把界面提示截图就能判断是权限被拒、
     预览态不支持，还是接口报错，不用连电脑抓控制台。 */
  function toySaveImage(dataUrl) {
    var t = toySdk();
    if (!t || typeof t.saveImageToAlbum !== "function") {
      return Promise.resolve({ ok: false, reason: "sdk_missing" });
    }
    var call = function () {
      try {
        return Promise.resolve(t.saveImageToAlbum({
          base64Data: dataUrl,
          hintMsg: "需要相册权限才能把办理凭证存到相册",
        })).then(function (res) {
          return { ok: true, path: (res && res.localPath) || "" };
        }).catch(function (err) {
          var reason = (err && (err.type || err.code ? (err.type || "code " + err.code) : "")) || "";
          var msg = (err && err.message) || "";
          return { ok: false, reason: msg || reason || "unknown" };
        });
      } catch (e) {
        return Promise.resolve({ ok: false, reason: (e && e.message) || "throw" });
      }
    };
    if (typeof t.isSupport !== "function") return call();
    /* 预览态 / Web 端 isSupport 为 false，此时不该让用户对着「保存失败」发呆 */
    return Promise.resolve(t.isSupport("saveImageToAlbum"))
      .then(function (ok) { return ok ? call() : { ok: false, reason: "unsupported" }; })
      .catch(function () { return call(); });
  }

  /* 分享：只能分享本 Toy 内的相对路径，完整链接由平台生成 */
  function initShare() {
    var t = toySdk();
    var btn = $("btnShare");
    if (!btn) return;
    if (!t || typeof t.share !== "function") return;
    Promise.resolve(t.isSupport ? t.isSupport("share") : true)
      .then(function (ok) {
        if (!ok) return;
        btn.hidden = false;
        btn.addEventListener("click", function () {
          t.share({ path: "index.html" }).catch(function () {
            btn.hidden = true;
          });
        });
      })
      .catch(function () { /* 不支持就保持隐藏 */ });
  }

  /* ------------------------------ 云存档：跨设备记住「看哪个城市、怎么排序」 ------------------------------
     只存这两个：筛选是一次性决策，恢复它容易让用户打开就是空列表。
     云存储按「登录用户 + 本 Toy」隔离，游客调用会 reject，一律静默。 */

  var PREF_KEY = "prefs";
  var prefTimer = null;

  function cloudPrefs() {
    var t = toySdk();
    if (!t || typeof t.setCloudStorage !== "function" || typeof t.getCloudStorage !== "function") return null;
    return t;
  }

  function scheduleCloudSave() {
    var t = cloudPrefs();
    if (!t) return;
    clearTimeout(prefTimer);
    prefTimer = setTimeout(function () {
      try {
        t.setCloudStorage({
          prefs: JSON.stringify({ city: (DATA && DATA.city) || "", sort: state.sort }),
        }).catch(function () { /* 未登录/限流都无所谓，本地记忆还在 */ });
      } catch (e) { /* 同上 */ }
    }, 1200);
  }

  function restoreCloudCity(done) {
    var finish = function () { done(); };
    var t = cloudPrefs();
    if (!t) { finish(); return; }
    var called = false;
    var once = function () { if (called) return; called = true; finish(); };
    var timer = setTimeout(once, 2500);
    try {
      t.getCloudStorage([PREF_KEY]).then(function (bag) {
        clearTimeout(timer);
        var p = null;
        try { p = JSON.parse((bag && bag[PREF_KEY]) || "null"); } catch (e) { p = null; }
        var wrapped = function () {
          if (p && p.sort) setSort(p.sort);
          once();
        };
        if (p && p.city) {
          for (var i = 0; i < INDEX.cities.length; i++) {
            if (INDEX.cities[i].c === p.city) { pickCity(INDEX.cities[i], wrapped); return; }
          }
        }
        wrapped();
      }).catch(function () { clearTimeout(timer); once(); });
    } catch (e) { clearTimeout(timer); once(); }
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
    state.maxPrice = 0;
    state.page = 1;
    updateFilterBadge();
    applyFilters();
    storageSet("city", { file: entry.f || "", name: DATA.city });
    scheduleCloudSave();
  }

  function pickCity(entry, done) {
    var finish = done || function () {};
    $("lpanel").hidden = true;
    if ((entry.f || "") === state.cityFile) { finish(); return; }
    if (!entry.f) { applyCity(window.__JTC_DATA__, entry); finish(); return; }
    if (loadedFiles[entry.f]) { applyCity(loadedFiles[entry.f], entry); finish(); return; }
    showNotice("正在加载" + cityShort(entry.c) + "数据…");
    var script = document.createElement("script");
    script.src = "./assets/" + entry.f;
    script.onload = function () {
      var data = window.__JTC_CITY_DATA__;
      if (data && data.city === entry.c && data.parks && data.parks.length) {
        applyCity(data, entry);
      } else {
        showNotice("城市数据异常，请重试");
      }
      finish();
    };
    script.onerror = function () {
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

  /* ------------------------------ 位置弹层（LocationSheet 同款：当前位置 + 城市 + 区域） ------------------------------ */

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
    renderDistrictPanel();
  }

  /* 区域：当前城市的行政区 chips，点选即时生效（对齐 LocationSheet 的区域块） */
  function renderDistrictPanel() {
    var districts = {};
    for (var i = 0; i < DATA.parks.length; i++) {
      var dv = DATA.parks[i].d;
      if (dv) districts[dv] = (districts[dv] || 0) + 1;
    }
    var dts = Object.keys(districts).sort(function (a, b) { return districts[b] - districts[a]; });
    var sec = $("distSec");
    if (dts.length <= 1) { sec.hidden = true; return; }
    sec.hidden = false;
    var html = "";
    html += '<button class="fbtn' + (state.district ? "" : " on") + '" data-dv="">全部</button>';
    for (var k = 0; k < dts.length; k++) {
      html += '<button class="fbtn' + (state.district === dts[k] ? " on" : "") + '" data-dv="' + esc(dts[k]) + '">'
        + esc(dts[k]) + " " + districts[dts[k]] + "</button>";
    }
    $("distBody").innerHTML = html;
  }

  function openLocPanel() {
    $("cityKw").value = "";
    renderCityPanel("");
    $("lpanel").hidden = false;
  }

  function resetAll() {
    state.kw = "";
    $("kw").value = "";
    state.district = "";
    state.industry = "";
    state.type = "";
    state.slot = "";
    state.maxPrice = 0;
    updateFilterBadge();
    setSort("recommend");
  }

  /* ------------------------------ 初始化 ------------------------------ */

  function init() {
    $("upd").textContent = DATA.updatedAt || "";
    applyEmbedInset();
    applyToyInset();
    applyHostTop();
    initShare();

    /* 排序按钮文案与站点 SORT_OPTIONS 同源——以前这里写「价格优先」、站点写「每月最省」 */
    var sorts = SHARED.SORT_OPTIONS || [];
    var sortLabel = {};
    for (var si = 0; si < sorts.length; si++) sortLabel[sorts[si].value] = sorts[si].label;
    if (sortLabel.recommend) $("sortRec").textContent = sortLabel.recommend;
    if (sortLabel.distance) $("sortDist").textContent = sortLabel.distance;
    if (sortLabel.price) $("sortPrice").textContent = sortLabel.price;

    // 试水包只带一个城市（构建时 --max-parks），城市切换没有意义，直接藏掉入口
    if (INDEX.cities.length <= 1) $("btnLoc").hidden = true;

    /* 品牌头搜索 */
    var kwTimer = null;
    $("kw").addEventListener("input", function (e) {
      clearTimeout(kwTimer);
      kwTimer = setTimeout(function () {
        state.kw = e.target.value || "";
        applyFilters();
      }, 250);
    });

    /* 吸顶工具条 */
    $("btnLoc").addEventListener("click", openLocPanel);
    $("btnFilter").addEventListener("click", openFilterPanel);
    $("btnReset").addEventListener("click", resetAll);
    $("sortRec").addEventListener("click", function () { setSort("recommend"); });
    $("sortDist").addEventListener("click", function () {
      if (state.lat == null) {
        locate("dist");
      } else {
        setSort("dist");
      }
    });
    $("sortPrice").addEventListener("click", function () { setSort("price"); });

    /* 列表：点套餐 chip 出码；空结果按钮 */
    $("list").addEventListener("click", function (e) {
      var chip = e.target.closest ? e.target.closest(".pkg-chip") : null;
      if (chip) {
        var item = findItem(chip.getAttribute("data-park"));
        var pkg = item && findPkg(item, chip.getAttribute("data-pkg"));
        if (item && pkg) openSheet(item, pkg);
        return;
      }
      var btn = e.target.closest ? e.target.closest("button") : null;
      if (!btn) return;
      if (btn.id === "btnNearMe") {
        state.kw = "";
        $("kw").value = "";
        locate("dist");
      } else if (btn.id === "btnWholeCity") {
        state.kw = "";
        state.district = "";
        $("kw").value = "";
        applyFilters();
      } else if (btn.id === "btnClearAll") {
        resetAll();
      }
    });
    /* 滚到底自动加载：哨兵进入视口（含 240px 预载区）就翻下一页；
       纯本地切片无网络失败，不需要重试路径 */
    var io = new IntersectionObserver(function (entries) {
      if (!entries[0].isIntersecting) return;
      if (state.geo !== "idle" || locatingHard) return;
      if (filtered.length > state.page * PAGE_SIZE) {
        state.page += 1;
        renderList();
      }
    }, { rootMargin: "240px 0px" });
    io.observe($("sentinel"));

    /* 位置弹层 */
    $("useGeo").addEventListener("click", function () {
      $("lpanel").hidden = true;
      locate("dist");
    });
    $("lClose").addEventListener("click", function () { $("lpanel").hidden = true; });
    $("lpanel").addEventListener("click", function (e) {
      if (e.target === $("lpanel")) $("lpanel").hidden = true;
    });
    $("cityBody").addEventListener("click", function (e) {
      var b = e.target.closest ? e.target.closest("[data-ci]") : null;
      if (b) pickCity(INDEX.cities[Number(b.getAttribute("data-ci"))]);
    });
    $("distBody").addEventListener("click", function (e) {
      var b = e.target.closest ? e.target.closest("[data-dv]") : null;
      if (!b) return;
      state.district = b.getAttribute("data-dv") || "";
      applyFilters();
      $("lpanel").hidden = true;
    });
    var cityTimer = null;
    $("cityKw").addEventListener("input", function (e) {
      clearTimeout(cityTimer);
      cityTimer = setTimeout(function () {
        renderCityPanel((e.target.value || "").trim());
      }, 200);
    });

    /* 筛选弹层 */
    bindFilterPanel();
    $("fClose").addEventListener("click", function () { $("fpanel").hidden = true; });
    $("fReset").addEventListener("click", function () {
      draft = { industry: "", type: "", slot: "", maxPrice: 0 };
      renderFilterPanel();
    });
    $("fApply").addEventListener("click", commitFilter);
    $("fpanel").addEventListener("click", function (e) {
      if (e.target === $("fpanel")) $("fpanel").hidden = true;
    });

    /* 出码弹层 */
    $("shClose").addEventListener("click", closeSheet);
    $("shSave").addEventListener("click", saveQr);
    $("sheet").addEventListener("click", function (e) {
      if (e.target === $("sheet")) closeSheet();
    });

    $("notice").addEventListener("click", function () {
      clearTimeout(noticeTimer);
      $("notice").hidden = true;
    });

    /* 恢复上次选择的城市 → 检查是否弹定位引导 */
    storageGet("city", function (saved) {
      if (saved && saved.file) {
        for (var i = 0; i < INDEX.cities.length; i++) {
          if (INDEX.cities[i].f === saved.file) { pickCity(INDEX.cities[i], checkGeoAsk); return; }
        }
      }
      /* 本地没有城市记忆（换设备 / 清过缓存）：用云存档里的城市兜底，拿不到就照常走定位引导 */
      restoreCloudCity(checkGeoAsk);
    });

    /* 引导卡上任意点击（按钮/遮罩）都算手势：关卡 + 立刻定位——进页面的每个人都走到定位 */
    $("geoPanel").addEventListener("click", function () {
      $("geoPanel").hidden = true;
      locate("recommend");
    });
    $("geoRetry").addEventListener("click", function () {
      locate("recommend");
    });

    updateFilterBadge();
    applyFilters();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

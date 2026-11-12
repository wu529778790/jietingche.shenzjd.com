# 泊月（jietingche）

站点名「泊月」，定位是**找附近能包月的停车场**：面向深圳、广州、上海这类大城市里
没有固定车位、正发愁车停哪儿的车主，按位置把能包月的车场（月卡 / 季卡 / 夜间包月…）
挑出来，选好套餐直接扫码办理。
数据来自捷停车分销选品池。访客链路：**首页搜索 → 城市/区域/车场落地页 → 出码**，
落地页全部服务端渲染，专门给搜索引擎和分享落地用（见「SEO / 落地页」）。
管理端全部收在 `/admin/*`，需要口令才能进，前台没有任何入口暴露它们。

## 开发

```bash
npm install
npm run dev     # http://localhost:3000
npm run build   # 生产构建
```

数据库：**运行时读本地 SQLite 文件** `data/app.db`（首次访问自动建表）。

为什么不用远程库：服务器在新加坡、Turso 免费版只能开在东京、访客在大陆，
一次跨洋往返 70~90ms，而首页一轮要跑 14 次查询，光网络就 1 秒多；换成同机文件后单次查询 <1ms
（数据量只有 10MB / 8.4k 车场 / 18.4k 套餐）。Turso 只保留两个用途：**数据中转**（`db:push` / `db:pull`）
和**异地备份**。

本地想临时直连线上库（只读排障、核对数据）：`JTC_DB=remote npm run dev`，
凭证仍是 `.env.local` 里的 `TURSO_*`（已 gitignore）。`JTC_DB_FILE` 可以换库文件路径。

**把本地库整库搬到 Turso**（幂等，重复跑只覆盖不重复）：

```bash
npm run db:push              # 默认 data/app.db
npm run db:push -- data/jtc.db
```

脚本读 `.env.local` 里的凭证，按本地 `sqlite_master` 建表建索引，再按 200 行一批
`INSERT OR REPLACE`，最后逐表对行数。

**反过来：把 Turso 整库拉回本地**（本地库落后于线上时用，旧库自动备份成 `data/app.db.bak`）：

```bash
npm run db:pull              # 默认写 data/app.db
```

后台在线上改过的数据只落在 Turso，所以**任何「以线上为准」的场景都要先 pull、再上传服务器**。
产物是单个自包含的 `.sqlite` 文件（跑完 VACUUM、不开 WAL），可以直接 scp。

`data/app.db` 是业务库，`data/jtc.db` 是官方选品池原始库（`enrich-jtc` / `import-jtc` /
`build-h5` 都依赖它），两者都不入库。`public/uploads/` 里的二维码图片同样不入库，
线上通过 Docker 卷持久化。

## 数据：爬取 → 清洗导入

```bash
# 1. 抓官方选品池（输出 data/jtc.db）
node --no-warnings scripts/crawl-jtc.mjs         # 每城一个点（市中心）拉全部分页
node --no-warnings scripts/crawl-jtc-grid.mjs    # 网格补抓：每城多点采样，捞出远郊/周边城区
node --no-warnings scripts/crawl-jtc-deep.mjs    # 重点城市深抓：北上广深，坐标自举密网格 + 多圈，迭代到饱和
node --no-warnings scripts/crawl-jtc-deep.mjs --capitals   # 只跑省会/直辖市（不含已饱和的北上广深）
node --no-warnings scripts/enrich-jtc.mjs        # 补套餐类型/时段/时长，重算省市区

# 2. 洗入业务库（幂等，重复跑只更新不重复）
node --no-warnings scripts/import-jtc.mjs
node --no-warnings scripts/import-jtc.mjs --city 深圳市   # 只导一个城市

# 3. 存量数据清洗（幂等；导入侧已边导边洗，这个只刷已经进库的旧数据）
npm run db:clean                          # 有 TURSO_* 就清线上，否则清 data/app.db
npm run db:clean -- --local --dry         # 只预演本地库，看看要改多少行
```

清洗规则收口在 `src/lib/packageText.ts`：官方套餐名里的 `<畅停无忧>` 这类推荐标签、
拼接下划线、车场名前缀和尾部冗余时长都会去掉（`金銮国际商务大厦停车场（<禁停一期地库>夜间套餐1月）`
→ `夜间套餐`）；规则摘要里的「工作日 工作日 18:30-08:30」会压成「工作日 18:30-08:30」。

**为什么要网格补抓**：`query_package_list` 只认查询坐标，按距离由近到远分页，
传 `cityCode` / `canton` 之类的行政区参数都无效；一个市中心点只能覆盖半径内的套餐，
远郊（如深圳坪山、上海嘉定）完全看不到。`crawl-jtc-grid.mjs` 以城市中心为原点，
按 9km / 18km / 30km 三圈采样，用 `package_id` 去重合并，并可反复增量跑（跑不出新增即为已饱和）。
城市实测池子里的大城市自动多采外圈，行政区划解析统一收口在 `scripts/lib/canton.mjs`。

`crawl-jtc-deep.mjs` 是重点城市专用的加强版：拿已抓套餐的坐标做 ~3km 自举网格，
再加 10~60km 多圈采样，第二轮新增为 0 即视为饱和。四城实测已饱和
（北京第二轮 +0、上海 +0、广州 +2、深圳 +0）。
`--capitals` 覆盖官方城市列表里存在的 28 个省会/直辖市/计划单列市
（银川、西宁没有城市条目），同样迭代到第二轮无新增。

前台优先级：`src/lib/types.ts` 的 `FOCUS_CITIES`（北上广深 + 省会/强二线）
决定车场库默认排序与首页**没定位**时的推荐顺序（有定位时按距离圈层排，见「接口」一节），
`HOT_CITIES` 是首页那排快捷城市入口。

导入做了什么：按 `park_code` 归并车场、`package_id` 派生稳定主键、佣金元→分、
按车场名推断业态（商场/写字楼/医院/景区/社区/交通枢纽）、官方 `<居住推荐>` 等标签转成适用人群。
已上传的专属码不会被重导入覆盖。

## 静态 H5 产线（小红书小工具 / B站 Toy）

两个平台都是「离线静态包 + 平台审核」，所以共用一份源 `minitool/src`，只按目标产出不同的目录/包名：

```bash
npm run snapshot                                        # data/jtc.db → data/jtc-snapshot.json
npm run snapshot:publish                                # 传到 GitHub Release（tag: snapshot-YYYYMMDD-HHmm）
npm run minitool -- --snapshot data/jtc-snapshot.json   # 小红书 → minitool/dist/*.zip
npm run toy -- --snapshot data/jtc-snapshot.json        # B站 Toy → platforms/toy/dist/*.zip
```

打包脚本在 CI 里跑时拿不到本地的 `data/jtc.db`，所以数据走 Release 附件：
`h5.yml` 会用 `gh` 找最新的 `snapshot-*` Release 并下载 `jtc-snapshot.json`，**不需要配任何 secret**
（仓库私有，附件也只有协作者能下）。要临时换地址，填 workflow 的 `snapshot_url` 或 secret `SNAPSHOT_URL` 覆盖。
`npm run snapshot:publish -- --keep 5 --prune` 可以把历史快照只留最近 5 个。

- xhs：带 `mini_tool.json`，跑 minitool-zip-builder 的审计；
- toy：不带平台清单、不跑小红书审计，zip 根目录直接是 `index.html`（详见 `platforms/toy/README.md`）。

- 快照只留打包要用的字段（`raw` 压缩成 `packageInterval` 一个数），59MB 原始池 → 10.6MB JSON，
  可以放到任意能直链下载的地方；
- 不带 `--snapshot` 时仍读本地 `data/jtc.db`，老流程不变；
- 官方 skill 目录（`~/.agents/skills/minitool-zip-builder`）不在时自动写等价 `mini_tool.json`，
  CI/Linux 用系统 `zip`，Windows 继续用 `Compress-Archive`；
- `.github/workflows/minitool.yml` 手动触发：填快照 URL → 出包 → 存 artifact（30 天）。
  **送审仍在本地**（`redapp preview` 扫码 → `redapp submit`），要本机登录并人工看预览。

## 页面

| 路径 | 归属 | 用途 |
| --- | --- | --- |
| `/` | 公开 | 访客搜索：定位/关键词 + 业态、套餐类型、时段、城市、区域、价格筛选 → 点套餐出二维码 |
| `/park/[parkCode]` | 公开 | 车场落地页：套餐表、折合月价、现场出码、周边车场内链（SSR，给搜索引擎收录） |
| `/city/[city]` | 公开 | 城市落地页：区域入口 + 月价最低的车场榜 |
| `/city/[city]/[district]` | 公开 | 区域落地页：该区可办月卡的车场列表 |
| `/sitemap.xml` | 公开 | 运行时生成的 sitemap（首页 + 城市 + 区域 + 有在售套餐的车场） |
| `/robots.txt` | 公开 | 放行全站，屏蔽 `/admin`、`/api`，指向 sitemap |
| `/admin/login` | 公开 | 管理后台登录 |
| `/admin/parks` | 后台 | 车场库：维护车场与套餐（码不在这里配） |
| `/admin/logs` | 后台 | 投放台账 |
| `/admin/stats` | 后台 | 对账（浏览/下单/佣金） |

## 品牌

站名「泊月」，图标是一枚定位针里嵌 P（对应「按位置找车场」这个核心动作）。

- `src/app/icon.svg` —— favicon / 标签页图标，路径数据是唯一源；
- `src/app/apple-icon.png` —— iOS 桌面图标 180×180，满方不切角（圆角由系统切）；
- `public/og.png` —— 1200×630 分享图，`layout.tsx` 里挂成 og:image / twitter:image；
- `src/components/BrandMark.tsx` —— 页面内联用的两版图形（带底板 / 只留针）。

改图形或改分享图文案要三处同步：`icon.svg`、`scripts/brand/og-card.html`（出图源文件）、
`BrandMark.tsx`。重新出图的命令写在 `og-card.html` 顶部注释里。

## PWA

能装到主屏（安卓 Chrome 直接装，iOS Safari「添加到主屏幕」），断网时给一页提示而不是白屏。

- `src/app/manifest.ts` —— 清单，Next 会自动注入 `<link rel="manifest">`；图标在 `public/icons/`
  （`icon-192` / `icon-512` 是 any，`maskable-512` 的针缩到 52% 留给系统圆形裁切）；
- `public/sw.js` —— 手写 SW，没引 workbox。导航网络优先（3.5s 超时吃缓存），
  `/_next/static` 与图片缓存优先，`/api/*` 完全不拦——价格是实时的，缓存等于给用户看错价；
- `src/components/PwaRegister.tsx` —— 只在生产构建注册，且等 `load` 之后再注册；
- `src/app/offline/page.tsx` —— 离线兜底页，样式全部内联（断网时 globals.css 可能没进缓存）。

改缓存策略或预缓存列表要把 `sw.js` 里的 `VERSION` 加一，`activate` 会清掉上一版本的 cache。
部署侧别给 `/sw.js`、`/manifest.webmanifest` 配长缓存：源站现在给的是 `max-age=0`，
但 CDN 一旦命中「静态资源长缓存」规则，发版后旧 SW 会一直不更新。

## SEO / 落地页

首页的搜索列表是客户端拉的，爬虫拿不到；所以另开了三层服务端渲染的落地页，
首页底部再补一组 SSR 的「城市 / 热门区域 / 最低价车场」入口，把
「首页 → 城市 → 区域 → 车场」这条路打通：

- 城市/区域/车场页都有独立的 title、description、canonical、og，以及
  `BreadcrumbList` + `ParkingFacility` / `ItemList` / `FAQPage` 结构化数据
  （FAQ 的页面文案和结构化数据共用同一个数组，改一处不会两边不一致）；
- 标题模板都带价格锚点：`深圳停车月卡多少钱？1337 个车场最低 ¥60/月`、
  `XX停车场月卡 ¥60/月（深圳坪山区）`——SERP 里带数字的比「价格与车场」更容易被点；
- 车场页有一句只有它自己才有的数据：「比深圳坪山区 32 个车场的中间价（¥160/月）便宜约 63%」。
  8000 页铺同一套模板会被判低质，这句话是拿同区中位数现算的，每页不同；
  样本少于 5 个车场的区不出这句（`getDistrictMonthlyBenchmark` 返回 null）；
- 城市页有分页 `/city/[city]/page/N`（每页 40 个车场，见 `components/seo/CityLanding.tsx`）。
  深圳 1337 个车场，靠一页 40 条传不到其余 1300 个车场页；分页补上「城市 → 车场」这条链。
  **第 2 页起 `noindex, follow`**：它们和第 1 页共用标题导语，进了索引就是几千个近似页，
  但 follow 照样让爬虫顺着链接走到每个车场页；
- 车场页的二维码是服务端现场生成的（`src/lib/qr.ts` 纯 JS，SSR 可跑）；
- 只把「有在售套餐」的车场写进 sitemap，避免空页面被索引（当前约 8000 条车场 + 城市/区域）；
- `sitemap.xml` 是运行时 Route Handler，进程内缓存 30 分钟，构建期不查库
  （CI 没有数据库也能过构建）。

线上域名通过 `NEXT_PUBLIC_SITE_URL` 覆盖，不配就用
`https://jietingche.shenzjd.com`（canonical 不能指到 localhost）。

价格口径：站内所有「最低价 / 排序 / 价格筛选」都按**折合月价**（`price * 30 / duration_days`），
长租卡（月/季/半年/年卡）优先于日卡/次卡；官方池里的「付定金专用」占位套餐在前台统一排除。

二维码规则：**全部前端现场生成，后台不存任何码图。**
码内容 = `m.jparking.cn` 套餐直达链接（`parkCode` + `sourcePackageId` + `shareCode`），
车场缺官方编码时退到官方搜索页链接。`shareCode` 取 `app_config.share_code`，
没配则读环境变量 `JTC_SHARE_CODE`，再没有就用 `src/lib/types.ts` 里的兜底值。

**只能出码，不能给直链**（2026-11-10 真机验证）：`m.jparking.cn/carParkDetail` 不是网页——
任何 UA 请求都是 404，根路径只是 OpenResty 默认页。它其实是微信
「扫普通链接二维码打开小程序」的规则前缀：微信扫一扫在客户端本地匹配规则后直接唤起
小程序，根本不请求这个 URL；一旦被当普通链接点开，只能按网页处理，必然打不开。

所以二维码是唯一入口（`src/components/QrActions.tsx`）：

- 微信内打开：提示长按识别（等价扫码），不引导下载；
- 手机浏览器/PC：给「下载二维码」按钮，把 GIF 转成 512px PNG 存相册，
  再引导「微信 → 扫一扫 → 相册」选图；
- 小红书小工具不能外跳，同样是出码图存相册。

## 后台鉴权

`src/proxy.ts`（Next 16 的 proxy 约定，即原 middleware）拦住 `/admin/*` 和 `/api/*`。公开白名单：
`GET /api/search`、`GET /api/facets`、`GET /api/locate`、`GET /api/config`（首页要读 shareCode），
加上登录/登出接口和 `/admin/login` 本身。其余读写接口、车场库/台账/对账全部要登录态。
`/api/v1/*` 是同一批接口的对外别名（`next.config` 里 rewrite 到 `/api/*`），proxy 判定时按别名归一。

公开接口统一走 `src/lib/api.ts`：CORS 白名单（`ALLOWED_ORIGINS`，逗号分隔，`*` 表示全放开）、
按 IP 每分钟限流（搜索 240 / 其它 120，进程内计数）、统一 `{ ok, data }` 结构，
搜索和分面还带 `Cache-Control`。分桶键优先取 `EO-Connecting-IP`（EdgeOne 写入并覆盖同名头），
退到 `X-Real-IP`/`X-Forwarded-For`——别把 XFF 放第一位，源站直连时它是客户端自己编的。

反采集（`src/proxy.ts`）：

- **只拦 UA 明确的采集器**：ahrefs/semrush/mj12 这类 SEO 工具、python-requests/scrapy/okhttp/
  puppeteer 这类裸脚本与无头浏览器，搜索引擎（Google/Bing/百度/搜狗/360/头条/Petal/
  Applebot）与社交预览一律放行。
- **不拦 curl/wget，也不拦空 UA**：发版脚本的健康检查就是从宿主机 `curl 127.0.0.1`
  打进来的，拦了 `deploy.yml` 会直接失败；空 UA 可能是 CDN 的回源/预热探测，拦错会被
  判成源站不可用。这两类量级交给上面的 IP 频控。
- `BOT_BLOCK=off` 一键关掉整套 UA 拦截，`BLOCK_UA_EXTRA` 追加正则片段（逗号分隔）做热修。
- 页面不禁爬：落地页有 5 分钟 CDN 缓存，爬虫打到的是 EdgeOne，而且它们本来就是流量来源。
  `/api/search` 让前端把坐标取 3 位小数（≈110m 网格），同一片区拼出同一个 URL，
  重复搜索落 CDN 而不是回源。

### 访问日志与埋点

零日志时连「有人在爬」都只能靠猜，所以 `visit_logs` 一张表装三类行（`kind`）：

| kind | 写入方 | 内容 |
|---|---|---|
| `page` | `proxy.ts` | 页面请求（含 `/park/*` 的 `park_code`），爬虫被拦的 403 也记 |
| `api` | `proxy.ts` | 接口调用（`name` 是接口名，`/api/search` 顺手记下 `q`） |
| `event` | `POST /api/log` | 前端埋点：`sheet_open`（点开套餐码弹层）、`qr_save`（保存二维码图）、`search` |

口径与边界：

- 存原始 IP（后台「请求最多的来源」直接显示，方便认出爬虫），同时也存加盐 `sha256` 前 16 位
  用于 UV 去重、`/24`、`/48` 网段用于聚合。数据只落自家库，`LOG_KEEP_DAYS`（默认 90 天）到期自动删。
  2026-11-12 之前的记录没有 IP 列，报表会退回显示网段。
- `via_cdn=0` 表示请求没带 EdgeOne 特征头，即**绕过 CDN 直连源站**——这一列比任何推测都准。
- 二维码链路只能测到「点了保存/下载」这一步：微信内长按识别、iOS 存相册都点不到按钮，
  真实拿码人数一定更高；扫码之后发生在捷停车官方小程序，本站拿不到。
- 后台看板：`/admin/traffic`（今日 PV/UV、来源构成、请求最多来源、热门页面、搜索词、每日趋势）。
- 保留 90 天，`LOG_KEEP_DAYS` 可调；`LOG_OFF=1` 一键停采集；`LOG_SALT` 换盐会让历史 UV 断代。

后台登录接的是 **wx-auth 统一账号**，没有口令：

- 浏览器：后台登录页加载 wx-auth SDK 出小程序码，扫码后 SDK 把签名 token 写进**根域 Cookie**
  `wxauth-token`（`domain=.shenzjd.com`）。本站与 `wx-auth.shenzjd.com` 同根域，Cookie 自动带过来。
- 服务端：`proxy.ts` 拿这个 token 问 `GET {WX_AUTH_API_BASE}/api/auth/userinfo`，
  只有 `user.isAdmin === true` 放行（fail-closed）。管理员身份在 wx-auth 后台给账号打 `is_admin`，
  本站不维护名单，加人减人都在 wx-auth 里做。
- 缓存：同一 token 10 分钟内不重复问远程；wx-auth 超时/5xx/限流算「瞬时故障」，回 503 让稍后重试，
  **不会**把登录态判成失效。
- 本地开发默认免登录（`next dev` 下直接进后台），想跟线上一致跑
  `ADMIN_DEV_REQUIRE_WX_AUTH=1 npm run dev`。

```bash
# 可选：默认已经是线上地址，一般不用配
WX_AUTH_API_BASE='https://wx-auth.shenzjd.com'
```

> `ADMIN_PASSWORD` 已废弃：部署脚本仍会把它写进 `data/.env`，但代码不再读取，留着无害。

模块也按前台/后台拆开了：`src/lib/types.ts` 只放公开领域模型与展示常量（客户端组件会 import），
`src/lib/adminTypes.ts` 放台账/对账类型，`src/lib/rows.ts` 放 libsql `Row` → 业务对象的映射（仅服务端）。
`PackageSheet` 只保留访客出码逻辑，原先混在里面的话术、记台账等推广员功能已删除。

## 部署（push main 自动）

`.github/workflows/deploy.yml`：push main 自动跑「类型检查 + lint + 构建」→ 构建镜像推 **Docker Hub**
→ SSH 到服务器 `docker pull` 换容器。业务库是宿主机上的 `data/app.db`，挂进容器 `/app/data`，
换容器不丢。

**为什么镜像走 Docker Hub**（每条都是实测的）：

| 方案 | 实测结果 |
|---|---|
| 服务器直连 GHCR 拉 | 32 分钟拉不完，失败 |
| CI `docker save` + rsync 直传 | 跨境上行 <1 Mbps，80 MB 传 17 分钟未完成 |
| CI 推腾讯云 TCR（境内 registry） | 出海 30 KB/s，80 MB 要 45 分钟 |
| **CI 推 Docker Hub** | 境外机房之间，25 秒量级 |
| **服务器拉 docker.io** | 走 `mirror.ccs.tencentyun.com` 内网加速，136 MB 实测 **3 秒** |

关键在于**两个方向都不跨境**：推是境外→境外，拉是腾讯云内网代理。服务器 `/etc/docker/daemon.json`
已配该加速器，所以 `docker pull` 自动生效。

镜像在 Docker Hub 上是 **public**（加速器只代理公开镜像，私有就只能直连 docker.io）。
镜像里只有编译产物，`TURSO_*` / `WX_AUTH_API_BASE` 等运行时配置通过 `data/.env` 以 `--env-file`
注入，不进镜像，运行时也**不需要登录** Docker Hub。

需要的 GitHub secrets：`DOCKERHUB_USERNAME`（Docker ID，不是邮箱）、`DOCKERHUB_TOKEN`、
`DEPLOY_HOST`、`DEPLOY_USER`、`DEPLOY_PASSWORD`、`TURSO_DATABASE_URL`、`TURSO_AUTH_TOKEN`，
可选 `DEPLOY_PORT`、`DEPLOY_SITE_DIR`、`APP_PORT`（线上 6715）、`JTC_SHARE_CODE`。
（`ADMIN_PASSWORD` 已废弃，后台登录改走 wx-auth，见上文「后台」一节。）

服务器上落在 1Panel 站点目录 `/opt/1panel/www/sites/jietingche.shenzjd.com`（可用 `DEPLOY_SITE_DIR` 改），
所有运行时文件收在 `data/` 下，1Panel 备份站点时会一起带上：

- `data/app.db`：**业务库（SQLite）**，容器读的就是这份。部署脚本会先校验「存在且 `car_parks` 非空」，
  缺失或空库直接中止部署，避免上线一个空白站。目录和文件 owner 必须是 `1001`（容器以 `nextjs` 运行，
  SQLite 要在同目录写 `-wal`/`-journal`）。
- `data/.env`：`TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` / `ALLOWED_ORIGINS` / `JTC_SHARE_CODE`，
  可选 `WX_AUTH_API_BASE`（不配就用默认的线上地址）。
  chmod 600，`ALLOWED_ORIGINS` 不配默认 `*`。首次部署若不存在，会用 GitHub secrets 自动生成，
  之后以服务器上这份为准；想把 secret 的改动刷进服务器，手动跑一次 workflow 勾 `refresh_env=true`。
- `data/uploads/`：挂到容器 `/app/public/uploads`，换容器不丢（码图已改成前端生成，这里是通用上传位）。

部署顺序是「拉镜像 → 临时容器预检 → 换容器 → 容器内探活 → 缓存头断言」，任一步失败都保留旧容器/
旧镜像（`jietingche:previous`）可回滚，不会出现停服又拉不起来的情况。预检用的是业务库的
**副本**（`mktemp -d` 里 cp 一份），不会和线上容器抢同一个 SQLite 文件的写锁。

**业务库怎么更新到服务器**（改了数据/后台改过库之后）：

```bash
npm run db:sync            # 打包 → 校验 → 备份线上库 → 停容器 → 上传 → 换文件 → 起容器 → 回查
npm run db:sync -- --dry   # 只打印将要做什么
```

脚本读根目录 `.env.deploy`（已 gitignore）里的 `DEPLOY_HOST` / `DEPLOY_USER` / `DEPLOY_SITE_DIR` / `DEPLOY_CONTAINER`
等，走 `~/.ssh` 免密；任一步失败都会从 `app.db.bak-<时间戳>` 回滚并把容器拉起来。
本地库**比线上车场少**时脚本会警告——那种情况应该先 `npm run db:pull` 以线上为准。

手工等价流程（脚本不可用时）：

```bash
npm run db:pull                                                        # 1. 以线上为准拉一份
ssh <user>@<host> 'sudo docker stop jietingche'                        # 2. 先停容器
scp data/app.db <user>@<host>:<SITE_DIR>/data/app.db                   # 3. 传上去
ssh <user>@<host> 'sudo chown 1001:1001 <SITE_DIR>/data/app.db && sudo docker start jietingche'
```

直接 `scp` 覆盖正在使用的 SQLite 有触发 `database disk image is malformed` 的风险，所以必须停容器再传。

本机没配免密时，用 `.github/workflows/ssh-bootstrap.yml`（`workflow_dispatch`，填公钥整行）
把 `~/.ssh/id_ed25519.pub` 追加到服务器 `authorized_keys`，跑完就能 `ssh jietingche`（`~/.ssh/config` 里的别名）。

## 接口

公开：

- `GET /api/search?q=&city=&district=&industry=&type=&slot=&maxPrice=&sort=&lat=&lng=&page=`
  - `sort=recommend`（默认）：有定位时按距离圈层（≤1km / ≤3km / ≤10km / 更远）排序，
    同圈层内价格升序；**没有定位**时按 `FOCUS_CITIES` 城市热度 + 价格升序
  - `sort=distance` 严格按距离、`sort=price` 按最低价、`sort=commission` 按最高佣金
  - 佣金不参与默认排序：它是商家侧指标，按它排会把远且贵的顶到首屏
- `GET /api/facets?city=` 筛选栏分面
- `GET /api/locate?lat=&lng=` 定位反查城市（前端定位后自动选中）
- `GET /api/config` 读前端出码用的 `shareCode`

需登录（后台）：

- `GET/POST/PATCH/DELETE /api/parks`、`/api/packages`、`/api/logs`、`/api/stats`
- `POST /api/upload` 通用上传（码图已改成前端生成，这里目前没人调用）
- `GET /api/admin/session` 当前登录身份（免鉴权，登录页用）、`POST /api/admin/logout` 退出

# 找停车（jietingche）

按位置和需求找停车场优惠套餐（月卡 / 季卡 / 夜间包月…），选好套餐直接扫码办理。
数据来自捷停车分销选品池。**访客只看得到首页这一个页面**：搜索 → 筛选 → 出码。
管理端全部收在 `/admin/*`，需要口令才能进，前台没有任何入口暴露它们。

## 开发

```bash
npm install
npm run dev     # http://localhost:3000
npm run build   # 生产构建
```

数据库：配了 `TURSO_DATABASE_URL`（+ `TURSO_AUTH_TOKEN`）走远程 libsql，
否则落到本地 `data/app.db`（首次访问自动建表）。这两个值写在 `.env.local` 里（已 gitignore），
所以本地开发也是直连线上那个 Turso 库，不再各自一份数据。

**把本地库整库搬到 Turso**（幂等，重复跑只覆盖不重复）：

```bash
npm run db:push              # 默认 data/app.db
npm run db:push -- data/jtc.db
```

脚本读 `.env.local` 里的凭证，按本地 `sqlite_master` 建表建索引，再按 200 行一批
`INSERT OR REPLACE`，最后逐表对行数。

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
```

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
| `/admin/login` | 公开 | 管理后台登录 |
| `/admin/parks` | 后台 | 车场库：维护车场与套餐（码不在这里配） |
| `/admin/logs` | 后台 | 投放台账 |
| `/admin/stats` | 后台 | 对账（浏览/下单/佣金） |

二维码规则：**全部前端现场生成，后台不存任何码图。**
码内容 = `m.jparking.cn` 套餐直达链接（`parkCode` + `sourcePackageId` + `shareCode`），
车场缺官方编码时退到官方搜索页链接。`shareCode` 取 `app_config.share_code`，
没配则读环境变量 `JTC_SHARE_CODE`，再没有就用 `src/lib/types.ts` 里的兜底值。

## 后台鉴权

`src/proxy.ts`（Next 16 的 proxy 约定，即原 middleware）拦住 `/admin/*` 和 `/api/*`。公开白名单：
`GET /api/search`、`GET /api/facets`、`GET /api/locate`、`GET /api/config`（首页要读 shareCode），
加上登录/登出接口和 `/admin/login` 本身。其余读写接口、车场库/台账/对账全部要登录态。
`/api/v1/*` 是同一批接口的对外别名（`next.config` 里 rewrite 到 `/api/*`），proxy 判定时按别名归一。

公开接口统一走 `src/lib/api.ts`：CORS 白名单（`ALLOWED_ORIGINS`，逗号分隔，`*` 表示全放开）、
按 IP 每分钟限流（搜索 240 / 其它 120，进程内计数）、统一 `{ ok, data }` 结构，
搜索和分面还带 `Cache-Control`。

```bash
# 生产必须配置，容器启动时注入即可（proxy 固定跑 Node 运行时，不需要构建期写死）
ADMIN_PASSWORD='换成一个强口令'
```

登录后下发 7 天 HMAC 签名的 httpOnly cookie；生产环境没配 `ADMIN_PASSWORD` 时后台直接 503，
不存在默认口令。本地开发不配就是免密，方便调试。

模块也按前台/后台拆开了：`src/lib/types.ts` 只放公开领域模型与展示常量（客户端组件会 import），
`src/lib/adminTypes.ts` 放台账/对账类型，`src/lib/rows.ts` 放 libsql `Row` → 业务对象的映射（仅服务端）。
`PackageSheet` 只保留访客出码逻辑，原先混在里面的话术、记台账等推广员功能已删除。

## 部署（GitHub Actions → 自己服务器）

`.github/workflows/deploy.yml`：push main 自动跑「类型检查 + lint + 构建」→ 构建镜像推 GHCR →
SSH 到服务器拉取换容器。服务器上只要有 Docker，数据全在 Turso，容器本身无状态。

服务器上落在 1Panel 站点目录 `/opt/1panel/www/sites/jietingche.shenzjd.com`（可用 `DEPLOY_SITE_DIR` 改），
所有运行时文件收在 `data/` 下，1Panel 备份站点时会一起带上：

- `data/.env`：`TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` / `ADMIN_PASSWORD` / `ALLOWED_ORIGINS` / `JTC_SHARE_CODE`。
  首次部署若不存在，会用 GitHub secrets 自动生成（chmod 600，`ALLOWED_ORIGINS` 不配默认 `*`），
  之后以服务器上这份为准；想把 secret 的改动刷进服务器，手动跑一次 workflow 勾 `refresh_env=true`。
- `data/uploads/`：挂到容器 `/app/public/uploads`，换容器不丢（码图已改成前端生成，这里是通用上传位）。

仓库 Settings → Secrets 需要配：`DEPLOY_HOST`、`DEPLOY_USER`、`DEPLOY_PASSWORD`、
`TURSO_DATABASE_URL`、`TURSO_AUTH_TOKEN`、`ADMIN_PASSWORD`，可选 `DEPLOY_PORT`（默认 22）、
`DEPLOY_SITE_DIR`、`APP_PORT`（默认 3000，线上用的是 6715）、`JTC_SHARE_CODE`。

部署顺序是「拉镜像 → 临时容器预检 → 换容器 → 容器内探活」，任一步失败都保留旧容器/
旧镜像（`jietingche:previous`）可回滚，不会出现停服又拉不起来的情况。

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
- `POST /api/admin/login`、`POST /api/admin/logout`

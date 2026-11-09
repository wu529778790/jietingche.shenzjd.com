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
否则落到本地 `data/app.db`（首次访问自动建表）。

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
决定车场库默认排序与首页没选城市/没定位时的推荐顺序，
`HOT_CITIES` 是首页那排快捷城市入口。

导入做了什么：按 `park_code` 归并车场、`package_id` 派生稳定主键、佣金元→分、
按车场名推断业态（商场/写字楼/医院/景区/社区/交通枢纽）、官方 `<居住推荐>` 等标签转成适用人群。
已上传的专属码不会被重导入覆盖。

## 页面

| 路径 | 归属 | 用途 |
| --- | --- | --- |
| `/` | 公开 | 访客搜索：定位/关键词 + 业态、套餐类型、时段、城市、区域、价格筛选 → 点套餐出二维码 |
| `/admin/login` | 公开 | 管理后台登录 |
| `/admin/parks` | 后台 | 车场库：配每个套餐的专属码，以及全局兜底推广码 |
| `/admin/logs` | 后台 | 投放台账 |
| `/admin/stats` | 后台 | 对账（浏览/下单/佣金） |

二维码规则：套餐有专属码就用专属码，没有就用 `/admin/parks` 里配的兜底推广码。
**上线前记得先传一张兜底码，否则访客看不到码。**

## 后台鉴权

`src/middleware.ts` 拦住 `/admin/*` 和 `/api/*`。公开白名单只有三项：
`GET /api/search`、`GET /api/facets`、`GET /api/config`（首页要读兜底码），
加上登录/登出接口和 `/admin/login` 本身。其余读写接口、车场库/台账/对账全部要登录态。

```bash
# 生产必须配置，容器启动时注入即可（middleware 用 Node 运行时，不需要构建期写死）
ADMIN_PASSWORD='换成一个强口令'
```

登录后下发 7 天 HMAC 签名的 httpOnly cookie；生产环境没配 `ADMIN_PASSWORD` 时后台直接 503，
不存在默认口令。本地开发不配就是免密，方便调试。

模块也按前台/后台拆开了：`src/lib/types.ts` 只放公开领域模型与展示常量（客户端组件会 import），
`src/lib/adminTypes.ts` 放台账/对账类型，`src/lib/rows.ts` 放 libsql `Row` → 业务对象的映射（仅服务端）。
`PackageSheet` 只保留访客出码逻辑，原先混在里面的话术、记台账等推广员功能已删除。

## 接口

公开：

- `GET /api/search?q=&city=&district=&industry=&type=&slot=&maxPrice=&sort=&lat=&lng=&page=`
- `GET /api/facets?city=` 筛选栏分面
- `GET /api/config` 读兜底推广码

需登录（后台）：

- `GET/POST/PATCH/DELETE /api/parks`、`/api/packages`、`/api/logs`、`/api/stats`
- `POST /api/upload` 上传专属码图片，`POST /api/config` 改兜底码
- `POST /api/admin/login`、`POST /api/admin/logout`

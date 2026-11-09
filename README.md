# 找停车（jietingche）

按位置和需求找停车场优惠套餐（月卡 / 季卡 / 夜间包月…），选好套餐直接扫码办理。
数据来自捷停车分销选品池，前台只做「搜索 → 筛选 → 出码」这一件事；
`/parks`、`/logs`、`/stats` 是给自己用的内部工作台（配专属码、记投放台账、对账）。

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
node --no-warnings scripts/crawl-jtc-deep.mjs --capitals   # 追加省会城市
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

前台优先级：`src/lib/types.ts` 的 `FOCUS_CITIES`（北上广深 + 省会/强二线）
决定车场库默认排序与首页没选城市/没定位时的推荐顺序，
`HOT_CITIES` 是首页那排快捷城市入口。

导入做了什么：按 `park_code` 归并车场、`package_id` 派生稳定主键、佣金元→分、
按车场名推断业态（商场/写字楼/医院/景区/社区/交通枢纽）、官方 `<居住推荐>` 等标签转成适用人群。
已上传的专属码不会被重导入覆盖。

## 页面

| 路径 | 用途 |
| --- | --- |
| `/` | 访客搜索：定位/关键词 + 业态、套餐类型、时段、城市、区域、价格筛选 → 点套餐出二维码 |
| `/parks` | 车场库：配每个套餐的专属码，以及全局兜底推广码 |
| `/logs` | 投放台账 |
| `/stats` | 对账（浏览/下单/佣金） |

二维码规则：套餐有专属码就用专属码，没有就用 `/parks` 里配的兜底推广码。
**上线前记得先传一张兜底码，否则访客看不到码。**

## 接口

- `GET /api/search?q=&city=&district=&industry=&type=&slot=&maxPrice=&sort=&lat=&lng=&page=`
- `GET /api/facets?city=` 筛选栏分面
- `GET /api/parks?q=&page=&pageSize=&withQr=1`
- `GET /api/packages?q=` 对账选套餐
- `GET/POST /api/config` 兜底推广码

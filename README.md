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
node --no-warnings scripts/crawl-jtc.mjs
node --no-warnings scripts/enrich-jtc.mjs

# 2. 洗入业务库（幂等，重复跑只更新不重复）
node --no-warnings scripts/import-jtc.mjs
node --no-warnings scripts/import-jtc.mjs --city 深圳市   # 只导一个城市
```

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

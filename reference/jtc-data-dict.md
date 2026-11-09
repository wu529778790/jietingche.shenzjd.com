# 捷停车数据字典

数据库：`data/jtc.db`（sqlite，已 gitignore）
爬虫：`scripts/crawl-jtc.mjs`　维度补全：`scripts/enrich-jtc.mjs`　查询：`scripts/q-jtc.mjs`

## 一、数据规模

| 项 | 数量 |
|---|---|
| 套餐 | 14266 |
| 停车场 | 6541 |
| 区县 | 408 |
| 城市 | 125 |
| 省份 | 30 |

覆盖来源：全国 152 个城市（有套餐的城市 123 个，其余 29 个接口返回 0）。`pageSize=200` 翻页，每个城市 1~10 页。

**完整性说明**：服务端 `totalRecord` 合计声明 15446 条，实拉 15278 条，翻页数均覆盖了声明的页数。差值 1.1% 来自 `totalRecord` 口径不准（服务端估算，与实际返回不一致），不是漏页。跨城市查询范围重叠产生的重复由 `package_id` 去重，最终唯一套餐 14266 条。

## 二、官方维度（来自小程序代码枚举）

### 套餐类型 `package_type` / `package_type_label`

代码原文：`{1:"月", 2:"日", 3:"次", 4:"年", 5:"半年", 6:"季"}`

| 值 | 含义 | 数量 |
|---|---|---|
| 1 | 月卡 | 11885 |
| 6 | 季卡 | 1285 |
| 4 | 年卡 | 550 |
| 5 | 半年卡 | 403 |
| 3 | 次卡 | 82 |
| 2 | 日卡 | 61 |

> 注意：小程序筛选面板只暴露了「次卡/日卡/月卡」三项，季卡/年卡/半年卡在 API 里存在但界面筛不到。

### 时段 `time_slot`（原字段 `packageInterval`）

代码原文：`{0:"full", 1:"day", 2:"night"}`

| 值 | 含义 | 数量 |
|---|---|---|
| 0 | 全天 | 8620 |
| 2 | 夜间 | 3956 |
| 1 | 白天 | 1690 |

### 适用日 `time_types`（原字段 `packageRuleList[].timeType`）

| 枚举 | 中文 | 说明 |
|---|---|---|
| `EVERY_DAY` | 每天 | |
| `WORK_DAY` | 工作日 | |
| `WEEK_DAY` | 周末 | |
| `HOLIDAY` | 节假日 | |

组合分布（一个套餐可含多条规则）：

| 适用日 | 数量 |
|---|---|
| 每天 | 10239 |
| 工作日,周末,节假日 | 3491 |
| 工作日 | 443 |
| 工作日,周末 | 54 |
| 周末,节假日 | 14 |
| 每天,周末,节假日 | 10 |
| 周末 | 8 |
| 工作日,节假日 | 6 |
| 节假日 | 1 |

具体时间段在 `rule_summary`，形如 `每天 00:00-23:59`、`工作日 08:00-20:00 / 节假日 00:00-23:59`。

### 售卖状态 `status`

| 值 | 含义 | 数量 |
|---|---|---|
| `ENABLE` | 在售 | 12872 |
| `SOLDOUT` | 售罄 | 1394 |

### 限时特惠 `limit_time_flag`

`1` = 限时活动价，仅 6 条。

### 充电桩 `is_charge`

`1` = 场内有充电桩（该字段只在 577 条数据里出现，其余为 null，不能当筛选条件用）。

## 三、派生维度

| 字段 | 说明 | 取值 |
|---|---|---|
| `duration_days` | 有效时长（天），用于排序比较 | 1 ~ 3650 |
| `duration_label` | 归一后的时长文案 | `1天` / `7天` / `1个月` / `1季` / `半年` / `1年` |
| `discount_rate` | 折扣率 = `current_price / origin_price` | 0.01 ~ 1.0 |
| `use_period` | 原始有效天数（`usePeriod`） | 0 表示按类型默认 |
| `use_times` | 可用次数（`useTimes`），次卡才有意义 | 0 ~ 100 |
| `sell_begin` / `sell_end` | 套餐售卖期 | `2024-05-20 00:00:00` |

时长分布：

| 时长 | 数量 |
|---|---|
| 1个月 | 11899 |
| 1季 | 1289 |
| 1年 | 548 |
| 半年 | 400 |
| 1天 | 63 |
| 7天 | 24 |
| 10天 | 13 |
| 5天 | 9 |
| 15天 | 7 |
| 3天 | 5 |

## 四、地理维度

`province` / `city` / `district` 由 `canton` 解析归一：

| 原始 canton | 解析结果 |
|---|---|
| `广东深圳市福田区` | 广东 / 深圳市 / 福田区 |
| `广东省深圳市龙华区` | 广东 / 深圳市 / 龙华区 |
| `上海上海市浦东新区` | 上海市 / 上海市 / 浦东新区 |
| `上海上海城区宝山区` | 上海市 / 上海市 / 宝山区 |
| `北京市(省)北京市西城区` | 北京市 / 北京市 / 西城区 |
| `广西南宁市良庆区` | 广西 / 南宁市 / 良庆区 |
| `新疆维吾尔自治区乌鲁木齐市天山区` | 新疆 / 乌鲁木齐市 / 天山区 |
| `内蒙古呼和浩特市赛罕区` | 内蒙古 / 呼和浩特市 / 赛罕区 |

规则：
- 省份统一用简称（`广东` 而非 `广东省`），直辖市保留 `北京市/上海市/天津市/重庆市`
- 自治区统一为 `广西/新疆/内蒙古/宁夏/西藏`
- 仅有 141 条 `district` 为空，原因是原始 `canton` 只到市级（如东莞不设区）

省份 TOP10：

| 省份 | 套餐 | 停车场 |
|---|---|---|
| 广东 | 6603 | 2684 |
| 江苏 | 1246 | 631 |
| 上海市 | 813 | 328 |
| 福建 | 715 | 333 |
| 浙江 | 685 | 272 |
| 四川 | 495 | 235 |
| 湖南 | 424 | 160 |
| 重庆市 | 342 | 159 |
| 天津 | — | — |
| 北京 | — | — |

## 五、表结构

### packages

```sql
package_id        TEXT PK     套餐唯一 ID（= packageCode）
goods_id          TEXT        商品 ID
park_code         TEXT        停车场编码，如 p200722946
park_name         TEXT        停车场名
package_name      TEXT        套餐全名
simple_name       TEXT        套餐简称
biz_type          TEXT        B2C（分销场景下均为 B2C）
package_type      TEXT        原始类型 1~6
package_type_label TEXT       月卡/日卡/次卡/年卡/半年卡/季卡
time_slot         TEXT        全天/白天/夜间
time_types        TEXT        适用日，逗号分隔
rule_summary      TEXT        具体时段文本
use_period        INTEGER     有效天数
use_times         INTEGER     可用次数
duration_days     INTEGER     折算天数
duration_label    TEXT        归一时长文案
sell_begin/end    TEXT        售卖期
limit_time_flag   INTEGER     限时特惠
discount_rate     REAL        折扣率
status            TEXT        ENABLE / SOLDOUT
canton            TEXT        原始省市区串
province/city/district TEXT   归一后的行政层级
address           TEXT        详细地址
lng / lat         REAL        坐标
distance          REAL        距离（米，相对爬取时的城市中心）
current_price     INTEGER     现价（分）
origin_price      INTEGER     原价（分）
distribute_price  INTEGER     分销价（分）
max_commission    REAL        最高佣金（元）
commission        REAL        佣金（元，distributeFavour）
commission_amt    REAL        立减金额（元）
favour_amt        REAL        优惠金额（元）
is_charge         INTEGER     场内有充电桩
total_share_space / left_share_space INTEGER  可分享车位总数 / 剩余
raw               TEXT        接口原始 JSON（全字段兜底）
city_code         TEXT        爬取时所属城市
fetched_at        TEXT        拉取时间
```

索引：`city_code`、`province`、`canton`、`park_code`、`max_commission DESC`、`current_price`、`package_type_label`、`time_slot`、`duration_days`、`(city, district)`

### cities

`city_code` PK、`city_name`、`province`、`longitude`、`latitude`、`package_count`（平台声明值）

### crawl_log

`city_code` PK、`total`（服务端声明）、`fetched`（实拉）、`pages`、`ok`、`error`、`ran_at`

## 六、查询

### CLI

```bash
node scripts/q-jtc.mjs --stats                     # 全维度统计
node scripts/q-jtc.mjs --cities --limit 20         # 城市排行
node scripts/q-jtc.mjs --city 深圳市 --district 福田区 --slot 夜间 --sort commission
node scripts/q-jtc.mjs --province 广东 --type 月卡 --max-price 300 --sort distance
node scripts/q-jtc.mjs --park 中心书城
node scripts/q-jtc.mjs --day 工作日 --type 月卡 --limit 15
```

参数：`--province` `--city` `--district` `--type` `--slot` `--day` `--duration` `--park` `--min-price` `--max-price` `--sort` `--limit` `--soldout`

排序：`distance`（默认）、`commission`、`price`、`discount`、`duration`

### SQL

```sql
-- 深圳福田夜间套餐按佣金
SELECT park_name, simple_name, current_price/100.0 价格, max_commission 佣金, distance
FROM packages
WHERE city='深圳市' AND district='福田区' AND time_slot='夜间' AND status='ENABLE'
ORDER BY max_commission DESC LIMIT 20;

-- 各城市月卡均价
SELECT city, COUNT(*) 数量, ROUND(AVG(current_price)/100.0) 均价, ROUND(AVG(max_commission)) 均佣
FROM packages
WHERE package_type_label='月卡' AND status='ENABLE'
GROUP BY city HAVING 数量>20 ORDER BY 均佣 DESC LIMIT 20;

-- 折扣最低的 20 个
SELECT park_name, city, district, simple_name,
       current_price/100.0 现价, origin_price/100.0 原价, ROUND(discount_rate*10,1) 折
FROM packages WHERE status='ENABLE' AND discount_rate IS NOT NULL
ORDER BY discount_rate LIMIT 20;
```

## 七、更新

```bash
node scripts/crawl-jtc.mjs        # 重新拉全量（约 100 秒，按 package_id 覆盖更新价格/佣金/状态）
node scripts/enrich-jtc.mjs       # 重算派生维度
```

价格、佣金、状态会随重爬更新；新增套餐自动插入。

## 八、已知缺口

1. **`is_charge` 覆盖不全**：只有 577/14266 条带该字段，其余为 null，不能用于筛选。
2. **`distance` 有偏差**：是按爬取时传入的城市中心坐标算的直线距离，不是用户真实位置，只适合同城内相对比较。
3. **`total_share_space` / `left_share_space`** 仅 58 条有值。
4. **不可分售的套餐不在库里**：接口只返回分销池内的商品，平台 `package_count` 更大（如深圳声明 4284，分销池 1962）。
5. **`packageInterval` 与 `time_slot`** 一致，但个别套餐的 `packageRuleList` 与 `packageInterval` 语义可能不一致，以 `packageRuleList` 的具体时段为准。

# 推广图（推广二维码）生成调研

调研日期：2026-11-09~10。来源：捷停车小程序反编译产物（`reference/jtc-api.md` 第七节）
+ 三张官方海报实拍解码（2026-11-09/10）。

## 一、核心结论

捷停车官方的分享海报**不是微信小程序码**，而是客户端 canvas 本地合成：

```
二维码内容 = 带 shareCode 的 HTTPS H5 链接（普通网址，标准 QR 库即可生成）
海报 = 车场配图 + 标语 + 套餐信息/价格 + 车场名/地址 + 二维码（canvas 合成）
```

→ **完全本地复刻，零接口依赖**：套餐数据、车场图（OSS 直链）都在 `data/jtc.db` 的
`raw` 字段里；二维码用 `qrcode` 库生成（已试跑成功）；海报排版用 `sharp`/`canvas` 自己合成。
官方标语图（"便宜有好位""办月卡就上捷停车"）不复用，自有海报打「找停车」品牌 + 扫码进官方页，
避免冒用官方 logo。

## 二、链接格式（✅ 三张官方海报解码全部验证）

| 海报 | 解码结果 |
| --- | --- |
| 套餐详情（怀德翠湖工业区，11-09 23:54） | `https://m.jparking.cn/carParkDetail?detailTab=service&sourceId=FXFX02&showPackageId=f023858e…&parkCode=p240672210&shareCode=USC26110923541177396R1w5` |
| 全局兜底（办月卡就上捷停车，11-10 00:20） | `https://m.jparking.cn/search-stall?shareCode=USC261110002056207ZEqLdE&sourceId=FXFX01` |
| 套餐详情（新田上岛充电桩，11-10 00:22） | `https://m.jparking.cn/carParkDetail?detailTab=service&sourceId=FXFX02&showPackageId=da42dc4b…&parkCode=p251201102&shareCode=USC261110002253414vrCAeS` |

**出码模板（已验证）**：

```
套餐级: https://m.jparking.cn/carParkDetail?detailTab=service&sourceId=FXFX02
          &showPackageId={package_id}&parkCode={park_code}&shareCode={shareCode}
全局级: https://m.jparking.cn/search-stall?shareCode={shareCode}&sourceId=FXFX01
```

渠道号实测：`FXFX01` 首页/搜索页分享、`FXFX02` 分享中心套餐海报
（反编译里的 FXFX03/04 与实测不符，以实测为准）。

## 三、shareCode（⚠️ 关键未定项：码的长期有效性）

**已确认**：每次分享都重新生成。三张海报三个码，码内 `2611092354` 段 = 日期+分钟
（生成时间戳，用户猜测正确），尾段随机。结构：`USC` + `yyMMddHHmm` + 数字段 + 随机段。

**未定**：昨天生成的码今天还有效吗？两种假设：
- **H1 码长期有效**（服务端按码登记归因，时间戳只是防伪/排序）→ 静态批量出码 ✅，
  任何一个码硬编码进 1.4 万张二维码都没问题
- **H2 码短期有效**（会话级，过期失效）→ 静态出码不可行，须改为
  自有域名 302 动态取最新码（网站本体可行；小红书小工具不能联网，只能定期重发包）

**判定实验（两步，用户执行）**：
1. 用昨天那张官方海报（怀德翠湖工业区）现在真机微信扫码：能打开+能下单 → H1 成立；
   打不开或提示失效 → H2 成立
2. 买一张最便宜的套餐（确保该套餐已加入选品库），下单后到 分享中心→收益/订单
   看佣金记录是否出现 → 同时验证归因链路

## 四、官方归因规则（用户向官方确认，2026-11-10）

1. **必须把套餐加入自己的选品库**（选品池 `isAdded`）才可能归因佣金
   → 工作台 `/parks` 需要加「已加入选品库」标记列，出码/投放只推已加入的套餐
2. **必须当场买**：用户从链接进来直接下单才归因；关闭小程序再自己打开，归因丢失
   → 引导话术要强调「扫码后当场办理」，QR 尽量用套餐直达链接（减少中间步骤）

## 五、生成方案

### 路线 A：纯二维码 PNG（✅ 已试跑成功：`scripts/gen-promo-qr.mjs`）

- 源：`data/jtc.db`（node:sqlite 只读）；出图：`qrcode` 库，600px、容错 M
- 输出：`data/promo/{城市}/{park_code}_{package_id前8}.png` + `data/promo/manifest.json`
- 模式：`--global` / `--park` / `--city` / `--limit N`；默认只出在售（`--all` 含售罄）
- shareCode 硬编码默认值取第一张海报解码的码，`--share-code`/`JTC_SHARE_CODE` 可覆盖
- **H1 未判定前不要全量跑**（守卫：无 --limit/--city/--park 时拒绝）
- 2026-11-10 试跑：`--limit 20` 出 20 张（北京/广州/深圳），manifest.json 正常

### 路线 B：海报图（素材已确认齐全，待写合成脚本）

- 套餐数据：`data/jtc.db` packages 表 + `raw` 字段
- 车场配图：`raw.parkPhotos`（阿里云 OSS 直链，如
  `https://sytoss-market.oss-cn-shenzhen.aliyuncs.com/jparking/...`），批量下载一次即本地化
- 合成：`sharp`/`canvas`，自有排版（3:4），文案区（套餐名/时段/标签/价格/车场名/地址）+
  右下角/底部二维码，打「找停车」品牌
- 可选增强：匿名接口 `cwzg/cwyy/query_share_setting` 拿官方文案（非必需）

## 六、验证清单

- [x] 官方海报解码 × 3 → h5Base、两个路径模板、渠道号、shareCode 结构全确认
- [x] 链接能否直接打开 → 不能（404，只能扫码/长按识别，见第七节）
- [ ] **shareCode 长期有效性**：旧海报真机扫码实验（H1/H2 判定，全量出码闸门）
- [ ] **归因链路**：真机扫码买一单 → 分享中心看佣金记录
- [ ] 选品库标记：确认 `isAdded` 在登录态下的取数方式（工作台标记列的数据源）
- [ ] 路线 A 小批量码 → 真机扫生成的 PNG → 落地页正常、当场下单归因
- [ ] 路线 B 合成脚本（`scripts/gen-promo-poster.mjs`，待写）
- [ ] 小红书发布端实测（图内无码不违规，码只出现在工具/落地页）

## 七、链接为什么不能直点（2026-11-10 实测，重要）

真机结论：**微信扫这个二维码能进小程序，但把同一串 URL 在微信里点开不行。**

curl 验证（含微信 UA）：

| 请求 | 结果 |
| --- | --- |
| `m.jparking.cn/carParkDetail?...`（iPhone/Android 微信 UA、curl UA） | 全部 404，150 字节 |
| `m.jparking.cn/` | 200，OpenResty 默认欢迎页（2022 年的默认页） |

也就是说这个域名下没有任何业务网页。它用的是微信官方能力
「扫普通链接二维码打开小程序」（小程序后台 → 开发管理，登记域名 + 路径前缀）：

- **扫码**：微信客户端本地识别二维码内容 → 前缀匹配规则 → 直接唤起小程序，
  把 `parkCode` / `showPackageId` / `shareCode` 当参数带进去，**不发 HTTP 请求**；
- **点链接**：按普通网页处理，请求服务器 → 404 → 打不开。微信另有一层业务域名白名单，
  但不是这次失败的主因。

推论（直接决定产品形态）：

1. 二维码是唯一可行入口，不存在「给个链接让用户点」的方案；
2. 规则只校验域名 + 路径前缀，参数怎么拼都行 —— 自造码与官方海报码效力相同，
   这是本项目能成立的前提；
3. 想要「点一下直接进小程序」，只有小程序 URL Link / URL Scheme（需捷停车 appid + secret）
   或 `wx-open-launch-weapp`（需自有公众号 + 小程序关联），两者都拿不到，不做。

## 八、状态

- [x] 调研完成（本文件）
- [x] shareCode 获取（官方海报解码 ×3）
- [x] 路线 A 脚本（`scripts/gen-promo-qr.mjs`）+ 试跑 20 张成功
- [ ] shareCode 长期有效性判定（人工实验，见第三节）
- [ ] 归因验证（人工买一单）
- [ ] `/parks` 加「已加入选品库」标记
- [ ] 路线 B 海报合成脚本

# 捷停车小程序接口清单

来源：微信小程序 `wx24b70f0ad2a9a89a`（版本 346）反编译产物
包格式：`V1MMWX` + 单字节 XOR `0x39`，索引 `[u32 名长][名][u32 偏移][u32 大小]`（大端）
技术栈：uni-app（`VUE_APP_NAME: uni-app-jtc`）

## 一、请求约定

封装函数 `$http`（`app-service.js`），统一 POST：

```js
header = {
  'content-type': 'application/json;charset=UTF-8',  // action:'form' 时为 x-www-form-urlencoded
  'applicationVersion': '1.1.0',
  'UC_ID': openId,        // 登录后才有
  'token': sytToken       // 仅命中 isMatchSytTokenGateway 白名单的网关
}
timeout: 5000（默认）
```

成功判定（任一成立即为成功）：

```js
resultCode === 0 || code === 0 || respCode === 0 || status === 0 || respCode === 'SYT0001'
```

返回体取值优先级：`data > obj > attributes > respData`

错误码：`SYT0999` = token 失效（触发重新授权重试）；`JIESHUN0997/0998/0999` = 需重新登录。

## 二、网关 → 域名

| 网关前缀 | 生产域名（RELEASE） | 测试域名 |
|---|---|---|
| `base-gateway` | `sytgate.jslife.com.cn` | `sytgate-test.jslife.com.cn` |
| `core-gateway` | `sytgate.jslife.com.cn` | `sytgate-test.jslife.com.cn` |
| `cw-gateway` | `cw.jparking.cn` | `psbg-test.jparking.cn` |
| `cw-core-gateway` | `cwc.jparking.cn` | — |
| `mc-gateway` | `mc.jparking.cn` | — |
| `member-core-gateway` | `mbr.jparking.cn` | — |
| `zyh-gateway` | `zyh.jparking.cn` | — |
| `pay-gateway` | `pay.jparking.cn` | — |
| `orderquery-gateway` | `q.jparking.cn` | — |
| `charge-biz-gateway` | `m.jparking.cn` | — |
| `invoice-gateway` | `m.jparking.cn` | — |
| `oms-gateway` | `oms.jslife.com.cn` | `jtc-oms1.jslife.com.cn` |
| `data-report-gateway` | `etgw.jparking.cn` | `jtc-test.jslife.com.cn` |
| `ai-gateway` | `aigw.jparking.cn` | — |

其他域名：

| 键 | 生产域名 | 用途 |
|---|---|---|
| `wxhttp` / `cloudURL` / `jscspFront` | `www.jslife.com.cn` | 主站 |
| `jparkingService` / `jparkingOtherService` | `jparking.jslife.com.cn` | 停车服务 |
| `jtcFileService` | `file.jslife.com.cn` | 文件 |
| `aliparkAdapter` | `isv.jslife.com.cn` | ISV 适配 |
| `cwrH5` | `sztc.jslife.com.cn` | 车主 H5 |
| `abTestGateway` / `apiAd` | `e.jparking.cn` | A/B、广告 |
| `mJparkingH5` | `m.jparking.cn` | H5 容器 |
| `yfIndoorNavUrl` | `wx.indoorun.com` | 室内导航 |
| 静态资源 | `sytoss-market.oss-cn-shenzhen.aliyuncs.com` | OSS |
| 高德 | `restapi.amap.com` | 地图 |

## 三、接口清单（176 个）

### base-gateway（63）

分销业务 `distribute-business`（45，对应 `subPkg/fenxiao`）：

```
/query_favour_goods          /query_goods_list          /query_package_list
/query_park_goods            /query_park_list           /query_space_list
/remove_flag
/material/bind               /material/bind/query       /material/query
/task/income/info            /task/income/total         /task/receive/info
/user/add_goods              /user/award/list           /user/circle/info
/user/circle/report          /user/goods/share          /user/income
/user/info                   /user/one_click_clear      /user/register
/user/remove_goods           /user/settle_detail        /user/settle_list_detail
/user/settle_record          /user/share/orderInfo      /user/shareGuide
/user/unSettle_list          /user/unSettle_month       /user/v2/settle_list
/user/view/count             /user/view/info            /withdrawn/user_list
```

配置 / 授权：

```
/config/auth/commitAuthConfig          /config/auth/getUserInfoAuthConfig
/config/buttonConfig/getButton         /config/checkInFuncList
/config/getCarNoPrefixByIp             /config/queryUserPrivacy
/config/query_parkfunction             /config/updateUserPrivacy
```

车辆、订单、欠费：

```
/car/carauthappealnew/xcx/queryCorrect
/orderquery/car/payRecord              /orderquery/queryArrearsList
/orderquery/queryChargeDetail          /orderquery/order/reportFeeError
```

会员 / 权益 / 积分：

```
/member/userBenefits                   /member/userMbr
/member/fopl/queryShowStatus
/member/mbr/external/marketing/hw/query/couponDetail
/rv1/member/queryUserBenefitInfo       /rv1/integral/v2/balance/query
```

券 / 营销 / 其他：

```
/coupons/receive                       /cpActivateConsumer/queryCouponsActivateCount
/jscpc-favour/period/time/favour/goods/list
/jscpc-favour/period/time/favour/multi/list
/jscpc-favour/period/time/favour/navigation
/rv1/jscpc-favour/h5/receive
/bookcharge/charge/queryChargeDetail   /invoice/api/queryParkInvoiceStatus
/msg/subscribe/record/query            /msg/subscribe/record/submit
```

### core-gateway（43）

登录认证：

```
/user/wx/getUserByOpenId        /user/login/v2/h5login
/user/login/v2/sms/push         /user/login/v2/verify/image
/user/v2/sms/verify             /user/order/verify/image
/captcha/order/verify/image     /user/v3/query/attention/info
/user/query/subscribe/status    /user/queryWxSubscribeTemplate
/rv1/user/relieve_official_account
```

车辆管理：

```
/rv1/car/get/user/cars          /rv1/car/add_car            /rv1/car/setDefaultCar
/car/delete_user_car            /car/query/bind/info        /car/get/getCarPrivacy
/car/query_apeal_record         /car/query_realtime_signatory
/car/closeRealTimeDk
```

无感支付：

```
/car/autoPay/open               /car/autoPay/openBizAutoPay
/car/offline/checkOpenState     /rv1/car/queryAutoPayStatus
/rv1/car/queryPayBindLink
```

订单 / 支付：

```
/order/pay/prepay               /order/pay/v2/prepay
/order/queryOrderDetail         /payop/getPayTypeList
```

钱包：

```
/rv1/wallet/queryUserWalletInfo        /wallet/queryWalletPayInfo
/wallet/order/createRechargeOrder      /wallet/order/queryRechargeOrderStatus
```

券：

```
/coupon/favour/receiveDiscountCoupons  /coupon/getReductFavour
/coupons/activity/checkActivity        /coupons/activity/createOrder
/coupons/couponsThaw                   /member/coupon/zeroOrderNotify
/rv1/coupons/queryMineCouponsTotal
```

配置 / 月卡校验：

```
/carddelay/checkCarIsMonthCard         /config/queryPrivacyConfig
/config/query_variable
```

### cw-gateway（23）

```
/cwzg/park_standard_fee                      /cwzg/order/un_park_order
/cwzg/checkCarIsMember                       /cwzg/query_arrears_order_details
/cwzg/cwyy/queryCarNos                       /cwzg/cwyy/queryCwyxPackageCard
/cwzg/cwyy/query_share_setting               /cwzg/rentout/check_new_user
/cwzg/v2/park_attention_info                 /cwzg/sub/wx/saveWxMsgAuth
/park-search/v4/query_spaceshare_park_list   /park-search/v3/query_spaceshare_list
/park-search/v2/query_spaceshare_park_details
/park-search/v2/get_recommend_package        /park-search/package/longparking/query
/park-search/park/navigate_param             /park-search/query_metro_addr
/park-search/rentout/metro/list              /park-search/rentout/query_hot_city
/park-search/cwyy/query_parking_area         /park-search/chargeStation/queryMergeInfo
/park-search/distribute/query_package_list   /opt-carowner/package/packageDetail
```

### mc-gateway（12）

```
/carddelay/monthcard/issue_favour
/mc-core-service/apply/card/open              /mc-core-service/apply/card/agreementSign
/rv1/mc-core-service/order/close
/mc-query-service/apply/detail                /mc-query-service/package/apply/list
/mc-query-service/package/apply/attachment
/mc-query-service/package/apply/checkAgreementSignStatus
/mc-query-service/company/list                /mc-query-service/company/carNo/check
/mc-query-service/company/park/status         /mc-query-service/company/pre/check
```

### member-core-gateway（7）

```
/integral/v2/show/query                    /integral/v2/order-integral/query
/integral/v2/task/complete                 /integral/v2/task/token
/integral/v2/task-register/check-receive   /integral/v2/task-register/receive
/rv1/integral/v2/task/receive
```

### zyh-gateway（9）

```
/coupons-query/meituan/queryGoodsList/v3        /coupons-query/meituan/queryGoodsConfig
/coupons-query/meituan/queryUnCouponsNum        /coupons-query/parkCoupons/queryBestCoupons
/coupons-query/parkCoupons/queryCouponsParkList
/coupons-query/parkCoupons/queryCwyyCouponsList
/jys-ddfw-center/inStore/queryCategoryList
/jys-ddfw-center/inStore/queryConsumptionVouchersList
/jys-ddfw-center/marketing/getConsumptionVouchers
```

### pay-gateway（8）

```
/order/pay/prepay                     /order/pay/v3/prepay
/order/query/queryStartNode           /order/queryFeeDetail
/order/queryCashierOrderDetail        /order/queryGeneralOrderDetail
/order/walletCharge                   /payop/cashier/queryPayType
```

### charge-biz-gateway（5）

```
/charge/biz/queryUserChargeList                  /chargesearch/biz/queryStations
/chargesearch/biz/queryStationByParkCode         /chargesearch/biz/queryConnectorsByParkCode
/chargesearch/biz/queryStationFeeByParkCode
```

### invoice-gateway（2）

```
/core/invoiceApply/invoiceIntentionApply         /query/order/canInvoiceMerchantService
```

### orderquery-gateway（2）

```
/order/query/queryFee                            /order/query/carno/pay/index
```

### ai-gateway（1）

```
/agent/ai/dialog/conversation_v4
```

### data-report-gateway（1）

```
/syt-data-report/receive
```

## 四、客户端内置凭据（`authKey`）

```
gaodeJsapiKey : e15ab7bbaccbb1c2830ad5c1243ff08b
encKey        : b541357525f64da89759aea341c08d73
cmccAppId     : 300012056518
cmccAppKey    : （见代码）
jgAppKey      : 05cefdd43c1f32e5b2d8d115
k00 ~ k0x     : 多组 128/64 位十六进制密钥（参数加密用）
```

## 五、实测结果（2026-11-09）

匿名可调用，无需登录态：

| 接口 | 请求 body | 结果 |
|---|---|---|
| `POST https://sytgate.jslife.com.cn/core-gateway/config/query_variable` | `{"channelCode":"WX_XCX"}` | 成功，返回 3 条系统变量 |
| `POST https://sytgate.jslife.com.cn/base-gateway/config/getCarNoPrefixByIp` | `{}` | 成功，`data:["粤-B"]`（按出口 IP 推断车牌前缀） |
| `POST https://cw.jparking.cn/cw-gateway/park-search/rentout/query_hot_city` | `{"channelCode":"WX_XCX"}` | 成功，返回 `allCity`（按字母分组的城市 + `packageCount` + 经纬度） |
| `POST https://cw.jparking.cn/cw-gateway/park-search/v4/query_spaceshare_park_list` | 见下 | 成功，返回停车场 + 套餐列表 |

**关键点：不传 `channelCode` 会被网关直接拒绝**，返回 `{"code":"1","message":null,"success":false,"data":null}`（HTTP 仍是 200）。

`base-gateway/config/query_parkfunction` 空参数返回 `functionCode:数据不能为空`，说明该类接口的必填参数在服务端校验。

### 车位优选列表请求示例

```bash
curl -X POST 'https://cw.jparking.cn/cw-gateway/park-search/v4/query_spaceshare_park_list' \
  -H 'Content-Type: application/json;charset=UTF-8' \
  -H 'applicationVersion: 1.1.0' \
  -d '{
    "sortMode": 1,
    "userLongitude": 114.0579,
    "userLatitude": 22.5431,
    "longitude": 114.0579,
    "latitude": 22.5431,
    "pageIndex": 1,
    "pageSize": 10,
    "platform": "ios",
    "distance": 0,
    "cityCode": "440300"
  }'
```

响应结构：

```json
{
  "code": "0",
  "success": true,
  "data": {
    "data": [
      {
        "parkName": "中心书城停车场",
        "parkCode": "p200722946",
        "address": "莲花街道鹏程三路深圳书城(中心城店)",
        "distance": "302",
        "longitude": 114.058452,
        "latitude": 22.545772,
        "parkPhotos": "https://sytoss-market.oss-cn-shenzhen.aliyuncs.com/...",
        "isCharge": 0,
        "packageBaseInfo": { "dayCount": 0, "nightCount": 2, "allDayCount": 2, "totalCount": 4, "maxCommission": 49.5 },
        "packageList": [
          {
            "bizType": "B2C",
            "packageId": "38712876c00f46499c631f0e31e03291",
            "packageName": "中心书城停车场（<APEC绿色出行>7天停车卡）",
            "shortName": "全天套餐",
            "enableOrderSpace": 20,
            "originPrice": 42000,
            "currentPrice": 12500,
            "packageType": 3,
            "useTimes": 7,
            "usePeriod": 7,
            "packageStatus": "FREE",
            "packageRules": ["每天全天"]
          }
        ]
      }
    ]
  }
}
```

价格单位是**分**（`originPrice: 42000` = 420 元，`currentPrice: 12500` = 125 元）。

### 其他调用参数备忘

`/cw-gateway/park-search/v3/query_spaceshare_list`（需登录）：

```json
{ "userId": "", "openId": "", "sortMode": 2,
  "longitude": 0, "latitude": 0, "userLongitude": 0, "userLatitude": 0,
  "parkCode": "p200722946", "pageSize": 10, "pageIndex": 1 }
```

`/cw-gateway/park-search/v2/get_recommend_package`（需登录）：

```json
{ "userId": "", "openId": "", "parkCode": "", "carNo": "",
  "longitude": 0, "latitude": 0, "size": 3, "platform": "ios",
  "cardType": 0, "c2cFlag": true }
```

`/cw-gateway/cwzg/park_standard_fee`（停车费标准）：

```json
{ "parkCode": "p200722946", "inTime": "2026-11-09 10:00:00" }
```

## 六、接口实测对照表（2026-11-09 18:00 实跑）

统一 header：`Content-Type: application/json;charset=UTF-8`、`applicationVersion: 1.1.0`。
测试数据：`parkCode=p200722946`（中心书城停车场）、`packageId=38712876c00f46499c631f0e31e03291`、坐标深圳 `114.0579, 22.5431`。

### 匿名可用，返回真实数据

| 接口 | 必需参数 | 说明 |
|---|---|---|
| `POST cw.jparking.cn/cw-gateway/park-search/v4/query_spaceshare_park_list` | `sortMode` `userLongitude` `userLatitude` `longitude` `latitude` `pageIndex` `pageSize` `platform` `cityCode` | 停车场列表 + 每个场的套餐；`pageSize`：地图模式 30、列表模式 10 |
| `POST cw.jparking.cn/cw-gateway/park-search/v2/query_spaceshare_park_details` | `packageId` | 套餐详情（**不需要** `channelCode`） |
| `POST cw.jparking.cn/cw-gateway/park-search/v2/get_recommend_package` | `parkCode` `longitude` `latitude` `size` `platform` `cardType` `c2cFlag` | 推荐套餐数组；`cardType`：5/1004→1，1019→2，其他 0 |
| `POST cw.jparking.cn/cw-gateway/park-search/v3/query_spaceshare_list` | `sortMode` `longitude` `latitude` `parkCode` `pageSize` `pageIndex` | 单场套餐列表，**userId 可为空** |
| `POST cw.jparking.cn/cw-gateway/park-search/rentout/query_hot_city` | `channelCode` | 全国城市（字母分组 + `packageCount`） |
| `POST cw.jparking.cn/cw-gateway/park-search/rentout/metro/list` | `cityCode` | 地铁线路与站点；深圳 440300 返回 1 号线全站点 |
| `POST cw.jparking.cn/cw-gateway/park-search/park/navigate_param` | `parkCode` | 室内导航参数，返回 `navigateType:"YF"` + `indoorMapRegionId` + `indoorMapUuid` |
| `POST cw.jparking.cn/cw-gateway/cwzg/checkCarIsMember` | — | 是否月卡会员，`isMember`/`isOverTime`/`overAmount` |
| `POST cw.jparking.cn/cw-gateway/cwzg/park_attention_info` | `parkCode` | `obj` 为 null 表示该场无关注配置 |
| `POST cw.jparking.cn/cw-gateway/cwzg/query_arrears_order_details` | `arrearsId` | 传 ID 后返回 `obj:null` 表示无此欠费单 |
| `POST cw.jparking.cn/cw-gateway/cwzg/cwyy/query_share_setting` | `packageId` | 分享文案与配图（`h5Title`/`h5SubTitle`/`h5Picture`） |
| `POST cw.jparking.cn/cw-gateway/park-search/chargeStation/queryMergeInfo` | `parkCode` `stationId` | 充电桩信息，无充电桩时字段全 null、`stationNum:0` |
| `POST cw.jparking.cn/cw-gateway/park-search/package/longparking/query` | — | 长租套餐，无数据时 `data:null` |
| `POST cw.jparking.cn/cw-gateway/park-search/distribute/query_package_list` | `parkCode` | 分销套餐，无数据时返回空分页 |
| `POST sytgate.jslife.com.cn/base-gateway/orderquery/queryArrearsList` | `carNo` | 欠费汇总，含 `amount`、`orderList`、`appealOrders`、`payUrl` |
| `POST sytgate.jslife.com.cn/base-gateway/config/query_parkfunction` | `functionCode` | 停车场功能开关，返回数组 |
| `POST sytgate.jslife.com.cn/base-gateway/config/getCarNoPrefixByIp` | — | 按出口 IP 返回车牌前缀，实测 `["粤-B"]` |
| `POST sytgate.jslife.com.cn/core-gateway/config/query_variable` | `channelCode` | 系统变量（引导语、口令广告、无感黑名单） |
| `POST sytgate.jslife.com.cn/core-gateway/config/queryPrivacyConfig` | — | 隐私配置 |

### 需要登录 / 缺少业务数据

| 接口 | 返回 | 缺什么 |
|---|---|---|
| `cw-gateway/cwzg/cwyy/queryCarNos` | `userId不能为空` | 登录 userId |
| `cw-gateway/cwzg/cwyy/queryCwyxPackageCard` | `carNo不能为空` → 补 carNo 后 `userId不能为空` | 登录 + 车牌 |
| `cw-gateway/cwzg/rentout/check_new_user` | `参数为空` | 参数名待确认 |
| `cw-gateway/cwzg/order/un_park_order` | `参数异常` | 参数名待确认 |
| `cw-gateway/opt-carowner/package/packageDetail` | `OQ001 套餐信息不能为空` | `packageInfo` 结构待确认 |
| `cw-gateway/park-search/cwyy/query_parking_area` | `packageId is empty`（注意路径是 `park-search` 而非 `cwzg`） | packageId |
| `base-gateway/member/userMbr` | `请求来源不能为空 && 用户id不能为空` | `reqSource` + `userId` |
| `core-gateway/rv1/wallet/queryUserWalletInfo` | `用户ID不能为空` | 登录 userId |
| `core-gateway/payop/getPayTypeList` | `orderNo不能为空` | 订单号 |
| `base-gateway/config/buttonConfig/getButton` | `SYT0004 参数非法{appType, position}` | `appType` + `position` |
| `core-gateway/order/queryOrderDetail` | HTTP 500（orderNo 传 `"1"` 触发服务端异常） | 需真实订单号 |

### 异常响应

| 现象 | 接口 | 原因 |
|---|---|---|
| `404 Not Found /cwyy/query_parking_area` | `cw-gateway/cwzg/cwyy/query_parking_area` | 网关前缀写错，服务端实际路由是 `park-search/cwyy/query_parking_area` |
| `{"code":null,"success":false}` | `cw-gateway/cwzg/v2/park_attention_info` | 该路径不存在，正确为 `cwzg/park_attention_info` |
| `{"code":"1","success":false}` HTTP 200 | 任意 `cw-gateway` 接口 | 缺必填参数（最常见是 `channelCode`） |

### 复跑脚本

`reference/probe.sh`、`reference/probe2.sh`，改 `PARK` / `PKG` 变量即可对任意停车场探测。

## 七、分销 / 分享中心

对应小程序 `subPkg/fenxiao`（分享中心页面 = `share-page`，代码在 `chunk_4.appservice.js`）。

### 关键结论：商品池公开，分销身份需登录

| 能力 | 是否需要登录 | 依据 |
|---|---|---|
| 选品列表（有哪些套餐可分销、佣金多少、省市区、距离） | **不需要** | `userId` 传空仍返回 1955 条，含 `maxCommission`、`distributeFavour.commission` |
| 套餐筛选 / 排序 | 不需要 | 纯查询参数 |
| 是否已加入选品（`isAdded`） | 需要 | 匿名恒为 `0` |
| 分销员信息 / `shareCode` | **需要** | `user/info` 匿名返回 `SDB001 用户ID为空` |
| 收益、结算、提现、注册分销员 | **需要** | `user/income`、`settle_*`、`withdrawn/*` |

原理：选品列表是「平台有哪些商品可分销」的公共池，服务端不校验身份；一旦涉及「谁分销的、赚了多少」，必须靠 `userId`/`openId`/`token` 定位到人。

### 选品列表接口（匿名可爬）

```
POST https://sytgate.jslife.com.cn/base-gateway/distribute-business/query_package_list
```

完整参数（`formData` 展开后）：

```json
{
  "pageSize": 10,
  "pageIndex": 1,
  "userLongitude": 114.0579,
  "userLatitude": 22.5431,
  "longitude": 114.0579,
  "latitude": 22.5431,
  "sortMode": "1",
  "packageType": "",
  "packageInterval": "",
  "isCharge": "",
  "platform": ["ios"],
  "userId": "",
  "openId": ""
}
```

实测参数效果（深圳坐标，总量 1955）：

| 参数 | 取值 | 命中数 | 说明 |
|---|---|---|---|
| `sortMode` | `"1"` | 1955 | **距离最近**（默认，中心书城 302m） |
| `sortMode` | `"11"` | 1955 | **佣金优先**（卓越后海 ¥10800 / 佣 863.60 排第一） |
| `sortMode` | `"12"` | 1955 | 综合/推荐（19.8km 的明月花都排第一） |
| `packageType` | `"1"` | 1651 | 月卡 |
| `packageType` | `"2"` | — | 日卡 |
| `packageType` | `"3"` | 5 | 次卡 |
| `packageInterval` | `"1"` | 150 | 白天 |
| `packageInterval` | `"2"` | 697 | 夜间 |
| `packageInterval` | `"0"` | — | 全天 |

多个值用逗号拼接，如 `"packageType":"1,3"`。

**没有省市区筛选参数**：`canton` / `cityCode` / `provinceCode` / `areaCode` 全部无效（总量恒为 1955）。要按区域查只有两种做法：

1. 传该区域中心的 `userLongitude` / `userLatitude`（服务端按距离排序）
2. 拉全量后按返回的 `canton` 字段本地过滤（格式 `广东深圳市宝安区`）

### 单条返回结构

```json
{
  "parkName": "明月花都停车场",
  "parkCode": "p230559765",
  "address": "西乡街道共乐智慧城B写字楼共乐城",
  "canton": "广东深圳市宝安区",
  "longitude": 113.869118,
  "latitude": 22.582127,
  "distance": 19866.0,
  "isAdded": 0,
  "maxCommission": "51.60",
  "packageId": "033253dbd9b943568829b991e223bdd8",
  "packageCode": "033253dbd9b943568829b991e223bdd8",
  "packageName": "明月花都停车场项目（全天套餐_1月）仅B2层可停",
  "currentPrice": 65000,
  "originPrice": 70000,
  "status": "ENABLE",
  "packageRuleList": [
    { "timeType": "EVERY_DAY", "timePeriod": "每天 00:00-23:59", "parkRule": 3 }
  ],
  "distributeFavour": {
    "favourMode": "AMT", "favourAmt": "5.0",
    "currentPrice": 64500,
    "commission": "51.60", "commissionAmt": "8.0",
    "commissionMode": "DISCOUNT"
  },
  "goodsId": "1bc2b6d3121258b7debdca90f92d753e"
}
```

价格单位分（`65000` = 650 元），`maxCommission` / `commission` 单位元。

### 其他选品接口

| 接口 | 用途 |
|---|---|
| `distribute-business/query_space_list` | 「固定车位」tab（`tabIndex!==0` 时切换到此接口） |
| `distribute-business/query_park_list` | 「推荐车场」tab |
| `distribute-business/query_goods_list` | 按 `packageCodeList` 批量查商品 |
| `distribute-business/query_park_goods` | 按 `parkCode` 查车场商品 |
| `cw-gateway/park-search/distribute/query_package_list` | 按 `shareCode` + `parkCode` 反查（分享落地页用） |

### 分享图 / 二维码链路（需登录）

客户端 canvas 本地绘制，不是服务端出图：

```js
// 1. 生成分享链接（qrCodeUrl）
url = `${h5Base}/search-stall?shareCode=${shareCode}`
// 或  `${h5Base}/cw/index.html#/pages/search-stall/search-stall?shareCode=${shareCode}`
// 车场详情：`.../carPark-detail/carPark-detail?parkCode=${parkCode}&shareCode=${shareCode}`
// 套餐：`...?packageCode=${packageCode}&sourceId=${sourceId}&shareCode=${shareCode}&shareName=${shareName}`

// 2. 画二维码
Jtc.bizImage({ type: 'park' | 'park_muti' | 'c2c', detail: { ...itemData, sourceId: 'FXFX03' } })
// 内部：qrCode({ qrCodeUrl, size: 80 }) → canvas 合成整张分享海报
```

`shareCode` 来源：登录后 `getApp().globalData.distributeShareCode`（由分销员账号决定），所以**分享图必须先登录并注册成分销员**。

`sourceId` 取值：`FXFX03`（首页分享停车）、`FXFX04`（我的选品多选分享）、`4`（C2C）。

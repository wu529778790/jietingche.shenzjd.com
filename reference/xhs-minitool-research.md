# 小红书小工具（Builder Hub）调研

调研日期：2026-11-09。状态：**暂缓落地**——先解决推广图生成，再回来做这一步。

## 一、结论

1. 小红书创作服务中心 → Builder Hub →「小工具」可以承载纯 HTML/CSS/JS 应用：zip 上传、
   **无需开发者账号、无需企业资质**（个人号可用），发布后可挂载到笔记下方，用户点组件直接用。
   官方明确支持"用 agent 创作"口令，可交给 AI 全流程开发/测试/上传。
2. **容器禁止联网**（fetch/XHR/WebSocket/外链资源全禁），页面不能请求自己的 API。
   唯一形态：**数据内置的离线版**——按城市导出静态 JSON 打进包，搜索/筛选全前端做。
3. 这不是妥协：月卡套餐非分钟级商品，天级滞后可接受；一城 JSON 约 200~800KB，轻松入包。
   正式联网要走小红书小程序开放平台（web-view + 业务域名），但要求企业资质，留作升级路径。

## 二、发布入口与门槛

- 入口：小红书创作服务平台 → Builder Hub → 小工具 →「用 agent 创作」/ 手动上传。
- 发布：填名字/简介/封面 → 上传 zip → 审核 → 发布页「添加组件」挂载到笔记（老笔记可编辑追加）。
- 上传时若要调 AI 能力（内测）需appId 加白；用第三方 Agent 上传暂不支持内测 AI 接口。

## 三、容器能力清单（官方文档要点，2026-11-06 版）

来源：https://miniapp-sandbox.xiaohongshu.com/minitool/doc

### 能用

| 能力 | 说明 |
| --- | --- |
| HTML/CSS/JS | 标准技术栈，**基线 Chrome 61 / ES2017**（Android 8.1 最低），高版本语法需转译降级 |
| 包内静态数据 | `.json` 官方支持（"静态数据文件"）；脚本必须外置 `.js` 引入 |
| 图片 | 包内 png/jpg/jpeg/gif/webp/svg；`data:`/`blob:` 内存来源可用 |
| 定位 | 平台 API `window.xhs.miniTool.getLocation`（客户端 9.49+，替代被禁的浏览器定位） |
| 保存图片到相册 | `saveImageToPhotosAlbum`（9.42+）——**二维码交付的唯一出路** |
| 本地缓存 | `setStorage/getStorage`（9.46+），单 key 1MB / 总 10MB |
| 文件系统 | 9.49+，持久目录读写 |
| 关注作者 | `followAuthor` / `getFollowStatus`（9.51+），每天最多 10 次引导弹窗 |
| 分享 | `share` 拉起分享面板（9.53+，仅全屏容器） |
| Worker | classic Dedicated Worker（9.53+），每页最多 1 个 |
| 静态资源外移 | `assets/` 目录可由平台托管分发，减小主包体积（9.53.3+） |
| AI 文本生成 | `window.xhs.AI`（内测加白，deepseek-v4-flash / 点点模型） |

### 不能用（对本项目的影响）

| 禁用项 | 影响 |
| --- | --- |
| **一切联网**：fetch/XHR/WebSocket/SSE/外链图片字体 CDN | 不能查实时数据，必须打包 JSON |
| iframe、window.open、target=_blank、表单跳转 | 不能跳站外/跳网站 |
| **长按菜单** | 二维码不能长按识别 → 必须 `saveImageToPhotosAlbum` 存相册 → 微信扫一扫选相册图 |
| `navigator.clipboard` | 复制话术功能失效 |
| `navigator.geolocation` | 用平台 `getLocation` 替代 |
| eval / new Function / WASM / 内联 script / onclick 行内事件 | 代码规范约束，React/Next 直接搬不可行 |
| `a[download]` 文件下载 | 保存图片走 `saveImageToPhotosAlbum` |

## 四、本项目适配方案

1. **一个小工具 = 一个城市**（找停车·深圳版…），和小红书本地流量逻辑、一篇一车场的笔记选题对齐。
2. 导出脚本：业务库 → per-city JSON。前台字段裁剪：车场名/区/业态/地址/经纬度 +
   套餐名/价格/原价/类型/时段/规则摘要；`commission`、台账、对账等内部字段不导出。
   每条压到 200~300 字节，一城 200~800KB。
3. 小工具版前端：**原生 JS 单页重写**（Chrome 61 基线、JS 外置、addEventListener、无 eval），
   不复用 Next.js/React 代码，只复用筛选维度和交互逻辑。
4. 二维码：兜底推广码图片打进包；专属码体系就绪后按 `source_package_id` 映射打包对应码图
   （体积不够就只放兜底码）。**2026-11-14 已验证 shareCode 长期有效（H1 成立）**，
   静态出码成立：一枚码可以长期烙在包里，不存在「隔天码全废」的机制性风险。
5. 数据更新流水线：重爬 → enrich → 导出 JSON → 重新打包 → 上传审核。官方 agent 口令可自动化，
   周期每周一次的量级。
6. 包体大小上限官方文档未写明，上传页有体积提示，第一个测试包实测确认。

## 五、审核风险（要实测）

- 保存二维码引导去微信扫码属于灰色地带；官方《Skill 上传规范》要求权限说明准确、代码逻辑透明、原创。
  带导流性质可能被拒审/下架。**先用 2~3 个车场的最小包过一次审核，验证红线再铺开。**
  （2026-11-13 已实现：`npm run minitool -- --max-parks 3` 只出 3 个车场、包约 30KB，
  城市索引同步收敛为 1 城，前端自动隐藏城市切换。）
- 二维码图片不要出现在小红书笔记图里（OCR/码图检测直接限流），码只在小工具内部出现。

## 六、引流链路（修正后）

```
小红书笔记（一篇一车场/一城市）→ 笔记下方小工具 → 搜索/筛选 → 存二维码到相册
→ 微信扫一扫（相册选图）→ 捷停车小程序下单
```

比"报品牌词让用户去微信搜网站"短 3 步，全程站内合规。网站本体（Next.js）留给
B站外链、搜索引擎收录和内部工作台。

## 七、升级路径

跑通、注册个体户/公司后：小红书小程序开放平台（open.xiaohongshu.com）要求企业店铺资质，
支持 web-view 配业务域名（最多 200 个、支持子域名）挂 H5 → 可联网调实时 API。

## 八、参考来源

- 官方容器能力清单：https://miniapp-sandbox.xiaohongshu.com/minitool/doc
- Builder Hub 介绍（36氪）：https://m.36kr.com/p/3853737269892104
- Builder Hub 无需开发者账号（知乎）：https://zhuanlan.zhihu.com/p/2063675409376470091
- 内测数据报道（搜狐）：https://m.sohu.com/a/1054000816_362225
- RED Skill 发布（新浪财经）：https://finance.sina.com.cn/jjxw/2026-05-23/doc-inhywcxs5502505.shtml
- 小红书小程序 web-view 业务域名：https://miniapp.xiaohongshu.com/third/api-3rd/post-api-rmp-tp-auth-apps-webview
- 小红书开放平台（企业资质）：https://open.xiaohongshu.com/document/developer/file/32
- 私信通（企业号自动回复，备选）：https://sxt.xiaohongshu.com
- B站承载核实：open.bilibili.com / open-live.bilibili.com（直播 H5 插件）/ open.biligame.com（H5 游戏），
  均不适配停车搜索；B站引流走简介/动态/视频简介外链。

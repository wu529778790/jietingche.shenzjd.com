# B站 Toy（platforms/toy）

Toy 是 B 站的静态网页托管/发布平台：上传 zip、平台安全扫描 + 内容审核，通过后给一个站内可玩的链接。
技术上和小红书小工具是同一类东西——**离线静态 H5 包**，所以不复用一套新代码，只复用同一份源：

```
minitool/src/          ← 共享 H5 源（UI、取数、二维码逻辑都在这里）
minitool/dist/         ← xhs 产物（mini_tool.json + 小红书审计）
platforms/toy/dist/    ← toy 产物（根目录 index.html，无平台清单）
```

## 构建

```bash
npm run snapshot                                     # data/jtc.db → data/jtc-snapshot.json
npm run toy -- --snapshot data/jtc-snapshot.json     # → platforms/toy/dist/zhao-tingche-toy.zip
npm run toy -- --snapshot data/jtc-snapshot.json --city 广州市
```

产物要求（两个平台一致）：**zip 根目录直接是 `index.html`**，不要多包一层文件夹；
资源用相对路径，切换城市时会去 `assets/city-*.js` 动态加载。

## 发布

B 站有官方 CLI（`bilibili/toy` 仓库的 skills/toy），流程与 redapp 类似：登录 → 上传 → 预览 → 提交审核。
发布时还要选分发方式（`PUBLIC_BIP` / `LINK_ONLY` / `PASSWORD`），这个在 CLI 参数里给，不写进包。

## 待第一次上传确认的点

1. **是否允许运行期请求外部接口**：小红书沙箱是禁的（构建时就把数据烙进包里），Toy 目前没有公开说明。
   如果允许，可以给 toy 单独开一条走 `/api/v1/*` 的实时数据（CORS/限流已经就绪）；
   不允许就继续用快照，包体结构不用改。
2. **包体上限**：现在整包约 3MB（130 城分包 2.4MB + 主包）。若 Toy 限制更严，
   用 `--city` 选主城市、其余城市靠分包按需加载。
3. **平台能力**：分享/打开外链等 API 各平台不同，封一层 `platform.{share,openUrl}` 各自实现，
   不支持就降级成「复制链接 + 二维码」（现在小工具就是二维码兜底，天然可复用）。

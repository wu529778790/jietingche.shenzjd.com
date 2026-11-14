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
发布时还要选分发方式，这个在 CLI 参数里给，不写进包（CLI 实际取值 `link-only` / `password` / `public`，默认 link-only）。

安装：`curl -fsSL https://boss.hdslb.com/toy-cli/toy/install.sh | bash`（装到 `~/.local/bin/toy`）。
AI 调用一律带 `--json`；带包体的 create/update 默认只出预览链接，`--yes` 才真正提交审核。

**门槛：Toy 是内测制，登录即要白名单。** 2026-11-14 首次 `toy login` 被拒
（`当前账号未在 Toy CLI 白名单内`）。申请入口：PC 端创作中心侧边栏的 Toy 入口，
没有的话走官方答疑帖（opus/1241171666570051585）里的申请链接。
资格下来后本地已全部就绪：CLI v0.6.6、`dist/zhao-tingche-toy.zip`（实测全量包约 1MB，非上面估的 3MB）、
封面 `reference/brand/covers/cover-4x3.png`（Toy 卡片推荐 4:3 横版，已从 16:9 左对齐裁出），
`toy_doctor.py` 预检通过（唯一 WARN：产物文件名无内容指纹，手写构建、包体小，可接受）。

## 待第一次上传确认的点

1. **是否允许运行期请求外部接口**：小红书沙箱是禁的（构建时就把数据烙进包里），Toy 目前没有公开说明。
   如果允许，可以给 toy 单独开一条走 `/api/v1/*` 的实时数据（CORS/限流已经就绪）；
   不允许就继续用快照，包体结构不用改。
2. **包体上限**：现在整包约 3MB（130 城分包 2.4MB + 主包）。若 Toy 限制更严，
   用 `--city` 选主城市、其余城市靠分包按需加载。
3. **平台能力**：分享/打开外链等 API 各平台不同，封一层 `platform.{share,openUrl}` 各自实现，
   不支持就降级成「复制链接 + 二维码」（现在小工具就是二维码兜底，天然可复用）。

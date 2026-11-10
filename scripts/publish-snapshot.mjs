#!/usr/bin/env node
/**
 * 把数据快照发成一个 GitHub Release，让 CI 打包时能下载到。
 *
 * 为什么走 Release：代码在 git 里、数据在本地 data/jtc.db（59MB，不入库），
 * 而 GitHub Actions 那台机器两者都不齐——所以把 snapshot 产出的 10MB JSON
 * 挂到 Release 附件上，workflow 用 gh api 拉下来再打包。
 *
 * 用法：
 *   npm run snapshot              # 先生成 data/jtc-snapshot.json
 *   npm run snapshot:publish      # 再发 Release（tag 形如 snapshot-20261110-1830）
 *   npm run snapshot:publish -- --keep 5 --prune   # 保留最近 5 个，其余删掉
 *
 * 前提：本机装了 GitHub CLI 且已 gh auth login（或设置了 GH_TOKEN）。
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/** 附件名固定，CI 侧按名字找，不随日期变 */
const ASSET_NAME = "jtc-snapshot.json";
/** tag 前缀固定，workflow 只认这前缀的 release */
const TAG_PREFIX = "snapshot-";

const args = process.argv.slice(2);
const argValue = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const keep = Number(argValue("--keep") ?? 10);
const prune = args.includes("--prune");

const file = resolve(ROOT, args.find((a) => a.endsWith(".json")) ?? "data/jtc-snapshot.json");
if (!existsSync(file)) {
  console.error(`找不到快照：${file}`);
  console.error("先跑：npm run snapshot");
  process.exit(1);
}

function gh(ghArgs) {
  try {
    return execFileSync("gh", ghArgs, { encoding: "utf8" }).trim();
  } catch (error) {
    const detail = String(error.stderr ?? error.message ?? "").trim();
    console.error(`gh ${ghArgs.slice(0, 3).join(" ")} 失败：${detail || "未知错误"}`);
    console.error("检查：gh auth status / 网络");
    process.exit(1);
  }
}

const repo = gh(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]);

const now = new Date();
const stamp = [
  now.getFullYear(),
  String(now.getMonth() + 1).padStart(2, "0"),
  String(now.getDate()).padStart(2, "0"),
].join("");
const tag = `${TAG_PREFIX}${stamp}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;

console.log(`仓库：${repo}`);
console.log(`快照：${file}`);
console.log(`tag：${tag}`);

gh([
  "release",
  "create",
  tag,
  file,
  "--title",
  `数据快照 ${tag}`,
  "--notes",
  `npm run snapshot:publish 生成，供 H5 打包 workflow 下载。\n\n- 附件：${ASSET_NAME}\n- 生成时间：${now.toISOString()}`,
]);

const url = `https://github.com/${repo}/releases/download/${tag}/${ASSET_NAME}`;
console.log(`✓ 已发布：${url}`);

/* 旧快照清理：只碰 snapshot- 前缀，默认只提示不删 */
const list = gh([
  "release",
  "list",
  "--limit",
  "50",
  "--json",
  "tagName",
  "--jq",
  `[.[] | select(.tagName | startswith("${TAG_PREFIX}"))] | .[].tagName`,
])
  .split("\n")
  .filter(Boolean);

if (list.length > keep) {
  const stale = list.slice(keep);
  if (prune) {
    for (const old of stale) {
      gh(["release", "delete", old, "--yes", "--cleanup-tag"]);
      console.log(`- 已删除旧快照 ${old}`);
    }
  } else {
    console.log(`提示：还有 ${stale.length} 个历史快照（${stale.join(", ")}）`);
    console.log("      要清理就加 --prune（只删 snapshot- 前缀的 release）");
  }
}

console.log("\nCI 侧无需配置：h5.yml 会自动找最新的 snapshot- release 下载附件。");

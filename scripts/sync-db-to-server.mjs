#!/usr/bin/env node
/**
 * 把本地 SQLite 业务库同步到线上服务器。
 *
 * 线上库是宿主机文件 `<SITE_DIR>/data/app.db`，容器以卷挂进 /app/data，所以
 * 「发版」不会带数据，改完数据必须单独传一次。手工做是三步（停容器 → scp → chown），
 * 这套流程里最容易忘的是停容器：直接覆盖正在用的 SQLite 有概率把库写成 malformed。
 *
 * 这个脚本把整条链路串起来，出任何错都自动回滚到备份并把容器拉起来：
 *   1. 本地库 VACUUM INTO 临时文件（产出单文件、不带 -wal，避免上传半写状态）
 *   2. PRAGMA integrity_check + 行数核对
 *   3. 线上备份 app.db → app.db.bak-<时间戳>，只留最近 N 份
 *   4. 停容器 → 上传到 /tmp → sudo mv 覆盖 → chown 1001 → 起容器
 *   5. 回查线上行数，跟本地对不上就报错（文件已经换上，只是提醒核对）
 *
 * 用法：
 *   npm run db:sync                 # 交互确认后同步
 *   npm run db:sync -- --dry        # 只打印将要做什么，不连服务器改东西
 *   npm run db:sync -- --yes        # 跳过确认（脚本/定时用）
 *   npm run db:sync -- --file=data/jtc.db   # 换一个本地库文件
 *   npm run db:sync -- --keep=3     # 线上多留几份备份
 *
 * 连接信息来自本地 `.env.deploy`（已 gitignore），走 ~/.ssh 免密。
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline/promises";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry");
const assumeYes = args.includes("--yes");
const fileArg = args.find((a) => a.startsWith("--file="))?.slice("--file=".length);
const KEEP_BACKUPS = Math.max(1, Number(args.find((a) => a.startsWith("--keep="))?.slice("--keep=".length) ?? 5) || 5);

function log(msg) {
  console.log(msg);
}
function fail(msg) {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
}

/** 读 .env.deploy（只有 KEY=VALUE 行，不引第三方依赖） */
function loadEnvDeploy() {
  const file = path.join(process.cwd(), ".env.deploy");
  const out = {};
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m || m[1].startsWith("#")) continue;
    out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

const env = loadEnvDeploy();
const cfg = (key, fallback) => process.env[key] || env[key] || fallback;

const HOST = cfg("DEPLOY_HOST", "");
const USER = cfg("DEPLOY_USER", "ubuntu");
const PORT = cfg("DEPLOY_PORT", "22");
const SITE_DIR = cfg("DEPLOY_SITE_DIR", "/opt/1panel/www/sites/jietingche.shenzjd.com");
const CONTAINER = cfg("DEPLOY_CONTAINER", "jietingche");
const OWNER = cfg("DEPLOY_OWNER", "1001:1001");

if (!HOST) fail("缺 DEPLOY_HOST：请在项目根目录建 .env.deploy（参考 README「部署」一节）");

const target = `${USER}@${HOST}`;
const sshBase = ["-p", PORT, "-o", "BatchMode=yes", "-o", "ConnectTimeout=15", target];
const dataDir = `${SITE_DIR}/data`;
const remoteDb = `${dataDir}/app.db`;

/** 跑一个命令，打印出来（dry 模式只打印） */
function run(bin, argv, { quiet = false, allowEmpty = false } = {}) {
  const pretty = [bin, ...argv].join(" ");
  if (!quiet) log(`  $ ${pretty}`);
  if (dryRun) return "";
  try {
    const out = execFileSync(bin, argv, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return out;
  } catch (err) {
    if (allowEmpty) return err?.stdout?.toString?.() ?? "";
    const stderr = err?.stderr?.toString?.().trim() ?? "";
    throw new Error(`${pretty}\n    ${stderr || err.message}`);
  }
}

const remote = (cmd, opts) => run("ssh", [...sshBase, cmd], opts);

/** 只读查某个库文件的行数：car_parks / packages */
function countRows(file, { local = false } = {}) {
  const code =
    'import sqlite3,sys\n' +
    'c=sqlite3.connect("file:"+sys.argv[1]+"?mode=ro",uri=True)\n' +
    'print(c.execute("select count(*) from car_parks").fetchone()[0])\n' +
    'print(c.execute("select count(*) from packages").fetchone()[0])';
  const out = local
    ? run("sqlite3", [file, "select count(*) from car_parks; select count(*) from packages;"])
    : remote(`python3 -c '${code}' ${file}`);
  const [parks, pkgs] = out.trim().split("\n").map((v) => Number(v.replace(/[^\d]/g, "")));
  return { parks, pkgs };
}

async function main() {
  const dbFile = path.resolve(fileArg ?? path.join("data", "app.db"));
  if (!existsSync(dbFile)) fail(`本地库不存在：${dbFile}`);

  log(`\n=== 本地 → 线上 同步业务库 ===`);
  log(`  本地：${dbFile}（${(statSync(dbFile).size / 1024 / 1024).toFixed(1)} MB）`);
  log(`  线上：${target}:${remoteDb}`);
  log(`  容器：${CONTAINER}（同步期间会短暂停止）\n`);

  // 1. VACUUM INTO：拿到一个没有 -wal 尾巴的干净单文件
  const workDir = mkdtempSync(path.join(tmpdir(), "jtc-db-"));
  const packed = path.join(workDir, "app.db");
  log("[1/6] 打包本地库（VACUUM INTO）");
  try {
    run("sqlite3", [dbFile, `VACUUM INTO '${packed}'`]);
  } catch (err) {
    rmSync(workDir, { recursive: true, force: true });
    fail(`VACUUM 失败，本地库可能被占用或损坏：${err.message}`);
  }

  if (!dryRun) {
    log("[2/6] 校验打包结果");
    const integrity = run("sqlite3", [packed, "PRAGMA integrity_check;"], { quiet: true }).trim();
    const local = countRows(packed, { local: true });
    if (integrity !== "ok") fail(`integrity_check 不通过：${integrity}`);
    if (!local.parks) fail("本地库 car_parks 是空的，拒绝上传（会做出空白站）");
    log(`      integrity=ok  car_parks=${local.parks}  packages=${local.pkgs}`);

    log("[3/6] 核对线上现状");
    const current = countRows(remoteDb);
    log(`      线上现在：car_parks=${current.parks}  packages=${current.pkgs}`);
    if (local.parks < current.parks) {
      log(
        `\n⚠️  本地车场数比线上少 ${current.parks - local.parks} 条——线上可能有关键改动。\n` +
          `   想以线上为准的话，先 npm run db:pull 拉一份再同步。`,
      );
    }

    if (!assumeYes) {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const answer = (await rl.question("\n确认覆盖线上库？(y/N) ")).trim().toLowerCase();
      rl.close();
      if (answer !== "y") fail("已取消，什么都没改");
    }

    // 4. 停容器 + 备份
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "");
    const backup = `${remoteDb}.bak-${stamp}`;
    let stopped = false;
    let replaced = false;
    try {
      log("[4/6] 停容器并备份线上库");
      run("ssh", [...sshBase, `sudo -n docker stop ${CONTAINER} >/dev/null && echo stopped`]);
      stopped = true;
      remote(`sudo -n cp -p ${remoteDb} ${backup} && echo ${backup}`);

      log("[5/6] 上传并换文件");
      const staged = `/tmp/jtc-app-${stamp}.db`;
      run("scp", ["-P", PORT, "-o", "BatchMode=yes", packed, `${target}:${staged}`]);
      remote(
        `sudo -n mv ${staged} ${remoteDb} && sudo -n chown ${OWNER} ${remoteDb} && sudo -n chmod 644 ${remoteDb} && echo replaced`,
      );
      replaced = true;
      // 只保留最近 N 份备份
      remote(
        `ls -1t ${remoteDb}.bak-* 2>/dev/null | tail -n +${KEEP_BACKUPS + 1} | xargs -r sudo -n rm -f`,
        { allowEmpty: true, quiet: true },
      );
    } catch (err) {
      log(`\n✗ 同步中断：${err.message}`);
      if (stopped) {
        if (!replaced) log(`  回滚：库文件没被动过，直接起容器`);
        else log(`  回滚：从 ${backup} 恢复`);
        try {
          if (replaced) remote(`sudo -n cp -p ${backup} ${remoteDb} && sudo -n chown ${OWNER} ${remoteDb}`);
          run("ssh", [...sshBase, `sudo -n docker start ${CONTAINER} >/dev/null && echo started`]);
        } catch (e2) {
          log(`  回滚也失败了，需要人工处理：${e2.message}`);
        }
      }
      rmSync(workDir, { recursive: true, force: true });
      process.exit(1);
    }

    log("[6/6] 起容器并回查");
    run("ssh", [...sshBase, `sudo -n docker start ${CONTAINER} >/dev/null && echo started`]);
    await new Promise((r) => setTimeout(r, 3000));
    const status = remote(`sudo -n docker ps --filter name=^${CONTAINER}$ --format '{{.Status}}'`).trim();
    const after = countRows(remoteDb);
    log(`      容器：${status || "（没看到运行中的容器）"}`);
    log(`      线上：car_parks=${after.parks}  packages=${after.pkgs}`);
    if (after.parks !== local.parks || after.pkgs !== local.pkgs) {
      fail(`行数对不上（本地 ${local.parks}/${local.pkgs}），备份仍在 ${backup}`);
    }
    log(`\n✓ 同步完成，旧库备份：${backup}`);
  } else {
    log("[2/6] 校验打包结果（dry 模式跳过）");
    log("[3/6] 核对线上现状（dry 模式跳过）");
    log("[4/6] 停容器并备份线上库（dry 模式跳过）");
    log("[5/6] 上传并换文件（dry 模式跳过）");
    log("[6/6] 起容器并回查（dry 模式跳过）");
    log(`\n（dry 模式：什么都没改）`);
  }

  rmSync(workDir, { recursive: true, force: true });
}

main().catch((err) => {
  fail(err?.message ?? String(err));
});

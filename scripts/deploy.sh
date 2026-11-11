#!/usr/bin/env bash
#
# 本地发版：Mac 上构建 → rsync 增量同步产物 → 服务器本地组镜像并切换容器。
#
# 为什么不用 GitHub Actions 部署：
#   runner 在境外，到国内广州的实测带宽只有 ~30KB/s（推 80MB 镜像要 45 分钟，
#   服务器反向拉 GHCR 也要 32 分钟才失败）。而 Mac 和服务器都在国内，同样几十 MB
#   的产物几秒钟就过去了。构建放在本地还顺带省掉 Actions 的分钟数。
#
# 用法：
#   npm run deploy               完整：构建 + 同步 + 部署
#   npm run deploy -- --skip-build   只同步并部署（用现有 .next 产物）
#   npm run deploy -- --skip-sync    只跑服务器端构建与切换（产物没变时）
#
# 配置放 .env.deploy（已 gitignore）：
#   DEPLOY_HOST=1.2.3.4
#   DEPLOY_USER=root                需要能 sudo 免密执行 docker
#   DEPLOY_PASSWORD=xxx             用密钥的话改成配 SSH key，密码走 sshpass
#   DEPLOY_PORT=22                  可选
#   DEPLOY_SITE_DIR=/opt/1panel/www/sites/jietingche.shenzjd.com   可选
#   APP_PORT=6715                   可选
set -euo pipefail

cd "$(dirname "$0")/.."

if [ -f .env.deploy ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env.deploy
  set +a
fi

: "${DEPLOY_HOST:?在 .env.deploy 里配置 DEPLOY_HOST}"
: "${DEPLOY_USER:?在 .env.deploy 里配置 DEPLOY_USER}"
: "${DEPLOY_PASSWORD:?在 .env.deploy 里配置 DEPLOY_PASSWORD}"

DEPLOY_PORT="${DEPLOY_PORT:-22}"
DEPLOY_SITE_DIR="${DEPLOY_SITE_DIR:-/opt/1panel/www/sites/jietingche.shenzjd.com}"
APP_PORT="${APP_PORT:-3000}"

SKIP_BUILD=""
SKIP_SYNC=""
for arg in "$@"; do
  case "$arg" in
    --skip-build) SKIP_BUILD=1 ;;
    --skip-sync) SKIP_SYNC=1 ;;
    *) echo "未知参数：$arg"; exit 1 ;;
  esac
done

export SSHPASS="$DEPLOY_PASSWORD"
SSH_OPTS=(-p "$DEPLOY_PORT" -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=15)
remote() { sshpass -e ssh "${SSH_OPTS[@]}" "$DEPLOY_USER@$DEPLOY_HOST" "$@"; }

echo "==> 目标 $DEPLOY_USER@$DEPLOY_HOST:$DEPLOY_SITE_DIR"

if [ -z "$SKIP_BUILD" ]; then
  echo "==> 本地构建"
  NEXT_TELEMETRY_DISABLED=1 npm run build
fi

if [ ! -d .next/standalone ]; then
  echo "❌ 没有 .next/standalone，先跑 npm run build（或去掉 --skip-build）"
  exit 1
fi

echo "==> 组装运行时产物"
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT

cp -R .next/standalone/. "$STAGE/"
mkdir -p "$STAGE/.next"
cp -R .next/static/. "$STAGE/.next/static/"
# 构建期 file tracing 会把本地业务库带进 standalone；运行时由挂卷覆盖，
# 传上去纯属浪费（10MB），而且会让每次同步都因为内容变化而失效。
rm -rf "$STAGE/data"
cp Dockerfile.deploy "$STAGE/Dockerfile"
cp scripts/remote-deploy.sh "$STAGE/remote-deploy.sh"
echo "    产物 $(du -sh "$STAGE" | cut -f1)，其中 node_modules 基本不变，每次只有 .next 会变"

if [ -z "$SKIP_SYNC" ]; then
  echo "==> rsync 同步到服务器（增量）"
  remote "sudo mkdir -p '$DEPLOY_SITE_DIR/release' && sudo chown -R \$(id -u):\$(id -g) '$DEPLOY_SITE_DIR/release'"
  rsync -az --delete -e "sshpass -e ssh ${SSH_OPTS[*]}" \
    "$STAGE/" "$DEPLOY_USER@$DEPLOY_HOST:$DEPLOY_SITE_DIR/release/"
fi

echo "==> 服务器构建镜像并切换容器"
remote "DEPLOY_SITE_DIR='$DEPLOY_SITE_DIR' APP_PORT='$APP_PORT' bash '$DEPLOY_SITE_DIR/release/remote-deploy.sh'"

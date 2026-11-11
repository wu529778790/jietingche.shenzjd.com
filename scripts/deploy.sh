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

# ---- 跨平台原生模块 ----
# 产物是在 Mac 上构建的，node_modules 里只有 darwin 版原生二进制；容器是 alpine
# (x64/musl)，运行时需要对应的 linux 版，否则启动即 MODULE_NOT_FOUND
# （第一个报的是 @libsql/linux-x64-musl，后面还有 sharp）。
# 这里两件事：丢掉 darwin 包（白占 26MB 传输），补上容器真正要的 linux 包。
ensure_native() {
  local name="$1" ver="$2" tmp
  [ -n "$ver" ] || return 0
  [ -d "$STAGE/node_modules/$name" ] && return 0
  tmp=$(mktemp -d)
  if npm pack "$name@$ver" --pack-destination "$tmp" >/dev/null 2>&1; then
    tar -xzf "$tmp"/*.tgz -C "$tmp"
    mkdir -p "$(dirname "$STAGE/node_modules/$name")"
    cp -R "$tmp/package" "$STAGE/node_modules/$name"
    echo "    补齐 $name@$ver"
  else
    echo "⚠️ 取不到 $name@$ver，容器里可能缺原生模块"
  fi
  rm -rf "$tmp"
}

echo "==> 对齐原生模块平台（darwin → linux-x64-musl / glibc）"
find "$STAGE/node_modules" -maxdepth 2 -type d -name "*darwin*" -exec rm -rf {} + 2>/dev/null || true

LIBSQL_VER=$(node -p "require('./node_modules/libsql/package.json').version" 2>/dev/null || true)
ensure_native "@libsql/linux-x64-musl" "$LIBSQL_VER"

if [ -d node_modules/sharp ]; then
  ensure_native "@img/sharp-linux-x64" "$(node -p "require('./node_modules/sharp/package.json').version" 2>/dev/null || true)"
  # libvips 的包版本跟 sharp 不同步，从本地 darwin 包读，保证两边匹配
  VIPS_VER=$(node -p "require('./node_modules/@img/sharp-libvips-darwin-arm64/package.json').version" 2>/dev/null || true)
  ensure_native "@img/sharp-libvips-linux-x64" "$VIPS_VER"
fi

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

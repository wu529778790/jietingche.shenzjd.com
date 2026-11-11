#!/usr/bin/env bash
#
# 服务器端部署脚本：在 $SITE_DIR/release 里把同步过来的产物组成本地镜像，然后切换容器。
#
# 由 scripts/deploy.sh 在本地执行完构建 + rsync 之后，通过 SSH 调用。
# 设计前提：产物已经在本地构建好（Mac 上跑 next build），服务器只做「拼镜像 + 换容器」，
# 所以这里的 docker build 只命中 COPY 层，几秒钟完成，不吃 CPU/内存。
#
# 需要环境变量：DEPLOY_SITE_DIR、APP_PORT（由调用方注入）
set -euo pipefail

SITE_DIR="${DEPLOY_SITE_DIR:?缺少 DEPLOY_SITE_DIR}"
DATA_DIR="$SITE_DIR/data"
ENV_FILE="$DATA_DIR/.env"
UPLOADS_DIR="$DATA_DIR/uploads"
RELEASE_DIR="$SITE_DIR/release"
APP_PORT="${APP_PORT:-3000}"

CONTAINER="jietingche"
IMAGE_TAG="jietingche:latest"
PRECHECK="${CONTAINER}-precheck"

cd "$RELEASE_DIR"

echo "=== 构建镜像（本地 COPY 产物，无跨境传输） ==="
sudo docker build -t "$IMAGE_TAG" -f Dockerfile . 2>&1 | tail -5

echo "=== 准备数据目录 $DATA_DIR ==="
sudo mkdir -p "$UPLOADS_DIR"
# 容器里以 nextjs(1001) 运行，上传目录得让它可写
sudo chown -R 1001:1001 "$UPLOADS_DIR"
# 业务库是宿主机上的 SQLite 文件，挂到容器 /app/data。
# 目录本身要可写：SQLite 要在同目录落 -wal/-journal。
sudo chown 1001:1001 "$DATA_DIR"

if [ ! -s "$DATA_DIR/app.db" ]; then
  echo "❌ 缺少 $DATA_DIR/app.db（本地 SQLite 业务库），中止部署避免上线空白站"
  echo "   在本地跑：npm run db:pull，再 scp data/app.db <user>@<host>:$DATA_DIR/app.db"
  exit 1
fi
sudo chown 1001:1001 "$DATA_DIR/app.db"
echo "业务库 $(du -h "$DATA_DIR/app.db" | cut -f1)"

if [ ! -f "$ENV_FILE" ]; then
  echo "❌ 缺少 $ENV_FILE（运行时配置），中止部署"
  echo "   TURSO_DATABASE_URL / TURSO_AUTH_TOKEN / ADMIN_PASSWORD / ALLOWED_ORIGINS / JTC_SHARE_CODE"
  exit 1
fi
sudo chmod 600 "$ENV_FILE"

echo "=== 环境自检：本地业务库能不能读 ==="
# 先验一遍「读得到 + 有数据」，免得把空库/无权限的目录带上线（那是全站空白，比 500 更难查）。
if ! sudo docker run --rm -v "$DATA_DIR:/app/data" "$IMAGE_TAG" node -e '
  const { createClient } = require("@libsql/client");
  const c = createClient({ url: "file:/app/data/app.db" });
  c.execute("select count(*) n from car_parks")
    .then((r) => {
      const n = Number(r.rows[0].n);
      console.log("car_parks", n);
      if (!n) {
        console.log("空库：先把 data/app.db 传上来");
        process.exit(1);
      }
    })
    .catch((e) => {
      console.log("DB ERROR", e.message);
      process.exit(1);
    });
'; then
  echo "❌ 本地库自检未通过：检查 $DATA_DIR/app.db 是否存在、内容是否为空、权限是否给了 1001"
  exit 1
fi

run_container() {
  sudo docker run -d \
    --name "$CONTAINER" \
    --restart unless-stopped \
    -p "$APP_PORT:3000" \
    -v "$UPLOADS_DIR:/app/public/uploads" \
    -v "$DATA_DIR:/app/data" \
    --env-file "$ENV_FILE" \
    --memory 768m \
    --cpus "2.0" \
    --log-opt max-size=10m \
    --log-opt max-file=3 \
    "$1"
}

# 容器内探活：/api/config 是公开接口，能起服务就一定回 200
health() {
  sudo docker exec "$1" node -e \
    "fetch('http://127.0.0.1:3000/api/config').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" \
    >/dev/null 2>&1
}

wait_healthy() {
  i=0
  while [ "$i" -lt 45 ]; do
    health "$1" && return 0
    i=$((i + 1)); sleep 1
  done
  return 1
}

echo "=== 预检：新镜像先起临时容器（不占对外端口） ==="
sudo docker rm -f "$PRECHECK" >/dev/null 2>&1 || true
# 用业务库的副本做预检：既验证真实数据能读，又不让临时容器和线上容器
# 同时打开同一个 SQLite 文件（DDL/写锁会互相干扰）。
PRECHECK_DIR=$(mktemp -d)
sudo cp "$DATA_DIR/app.db" "$PRECHECK_DIR/app.db"
sudo chown -R 1001:1001 "$PRECHECK_DIR"
sudo docker run -d --name "$PRECHECK" -v "$PRECHECK_DIR:/app/data" --env-file "$ENV_FILE" "$IMAGE_TAG" >/dev/null
if ! wait_healthy "$PRECHECK"; then
  echo "❌ 预检失败，旧容器未动。最近日志："
  sudo docker logs --tail 60 "$PRECHECK" || true
  sudo docker rm -f "$PRECHECK" >/dev/null 2>&1 || true
  sudo rm -rf "$PRECHECK_DIR"
  exit 1
fi
sudo docker rm -f "$PRECHECK" >/dev/null
sudo rm -rf "$PRECHECK_DIR"
echo "预检通过"

echo "=== 记录回滚镜像 ==="
CUR_ID=$(sudo docker inspect -f '{{.Image}}' "$CONTAINER" 2>/dev/null || true)
if [ -n "$CUR_ID" ]; then
  sudo docker tag "$CUR_ID" jietingche:previous && echo "回滚镜像：jietingche:previous"
else
  echo "无运行中的旧容器（首次部署）"
fi

echo "=== 换容器 ==="
sudo docker stop "$CONTAINER" >/dev/null 2>&1 || true
sudo docker rm "$CONTAINER" >/dev/null 2>&1 || true
if ! run_container "$IMAGE_TAG"; then
  echo "❌ 新容器启动失败"
  if sudo docker image inspect jietingche:previous >/dev/null 2>&1; then
    echo "回滚到 jietingche:previous"
    sudo docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
    run_container jietingche:previous || { echo "❌ 回滚也失败，需人工介入"; exit 1; }
  fi
  exit 1
fi

echo "=== 自检 ==="
if ! wait_healthy "$CONTAINER"; then
  echo "❌ 新容器未通过探活，最近日志："
  sudo docker logs --tail 60 "$CONTAINER" || true
  echo "   回滚命令：sudo docker rm -f $CONTAINER"
  exit 1
fi

echo "=== 清理悬空镜像（保留 latest / previous 便于回滚） ==="
sudo docker image prune -f >/dev/null

echo "=== 部署完成 ==="
sudo docker ps | grep "$CONTAINER"

echo "=== 宿主机端口自检（$APP_PORT -> 3000） ==="
HOST_CODE=$(curl -s -o /dev/null -m 5 -w '%{http_code}' "http://127.0.0.1:$APP_PORT/api/config" || echo "000")
if [ "$HOST_CODE" = "200" ]; then
  echo "宿主机 $APP_PORT 对外映射正常"
else
  echo "⚠️ 宿主机 $APP_PORT 返回 $HOST_CODE：映射或防火墙/安全组需人工确认"
  sudo docker port "$CONTAINER" || true
fi

# 落地页缓存护栏：SEO 三页必须始终可被 CDN 缓存。
# 病根：页面一旦引入请求级依赖（cookies/searchParams），Next 会无声下发
# private,no-store，CDN 缓存整个失效且没有任何报错，只有回源变慢。
# 这里从首页→城市页→车场页逐级取真实链接，断言缓存头里有 s-maxage。
echo "=== 落地页缓存头断言（防 no-store 回归） ==="
CITY_ASSERT=$(curl -s -m 5 "http://127.0.0.1:$APP_PORT/" \
  | grep -o 'href="/city/[^"]*"' | head -1 | cut -d'"' -f2)
PARK_ASSERT=$(curl -s -m 5 "http://127.0.0.1:$APP_PORT$CITY_ASSERT" \
  | grep -o 'href="/park/[^"]*"' | head -1 | cut -d'"' -f2)
for p in "/" "$CITY_ASSERT" "$PARK_ASSERT"; do
  if [ -z "$p" ]; then
    echo "❌ 未能解析出落地页链接（首页没给 /city/ 或城市页没给 /park/）"
    exit 1
  fi
  cc=$(curl -s -o /dev/null -D - -m 5 "http://127.0.0.1:$APP_PORT$p" \
    | tr -d '\r' | grep -i '^cache-control:' | head -1)
  case "$cc" in
    *s-maxage*)
      echo "✓ $p → $cc"
      ;;
    *)
      echo "❌ $p 缓存头不含 s-maxage：$cc（页面被改回动态渲染，CDN 会全量回源）"
      exit 1
      ;;
  esac
done

# 自托管部署：多阶段构建，最终镜像只留 standalone 产物
# 业务库是宿主机上的 SQLite 文件（data/app.db），连同 public/uploads 一起挂卷

FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# 仓库里没有 public/，先把目录建出来，next build 与 final 阶段都能拿到
RUN mkdir -p public
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# 把依赖从 standalone 里拆出去，供 runner 阶段单独 COPY 成一层。
# 动机：跨境上行实测只有 ~30KB/s，node_modules 48MB 却和每次都会变的
# .next（4MB）挤在同一层，导致改一行代码也要重传 20MB（约 11 分钟）。
# 拆开后依赖层基本恒定，每次只推 .next 那几 MB（约 2 分钟）。
# 顺带清掉可能被 file tracing 带进来的 data/app.db（运行时由挂卷覆盖，进镜像纯属浪费）。
RUN mv /app/.next/standalone/node_modules /app/standalone-node_modules \
 && rm -rf /app/.next/standalone/data

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

COPY --from=builder --chown=nextjs:nodejs /app/public ./public
# 先放依赖层（稳定），再放业务代码层（每次都变）；顺序不能反，
# 否则依赖会被上层覆盖进「每次变」的那一层，拆层就白做了。
COPY --from=builder --chown=nextjs:nodejs /app/standalone-node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# 上传文件落在 public/uploads，运行时由站点目录的 data/uploads 挂卷覆盖
# /app/data 放 SQLite 业务库，运行时由站点目录的 data 挂卷覆盖
RUN mkdir -p /app/public/uploads /app/data && chown -R nextjs:nodejs /app/public/uploads /app/data

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]

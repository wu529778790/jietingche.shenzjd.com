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

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# 上传文件落在 public/uploads，运行时由站点目录的 data/uploads 挂卷覆盖
# /app/data 放 SQLite 业务库，运行时由站点目录的 data 挂卷覆盖
RUN mkdir -p /app/public/uploads /app/data && chown -R nextjs:nodejs /app/public/uploads /app/data

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]

# ---------- 构建阶段 ----------
FROM node:22-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build && npm run build:server
# 裁剪为生产依赖（后端只需要 express / ws）
RUN npm ci --omit=dev --no-audit --no-fund

# ---------- 运行阶段 ----------
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8100
COPY --from=build /src/node_modules ./node_modules
COPY --from=build /src/dist ./dist
COPY --from=build /src/dist-server ./dist-server
EXPOSE 8100
# 数据目录：挂载卷到 /app/data 可持久化账号
VOLUME ["/app/data"]
CMD ["node", "dist-server/index.js"]

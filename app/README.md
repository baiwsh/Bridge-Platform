# 桥牌汇 BridgeHub · 应用目录

项目说明、功能特性、界面截图与快速开始请见仓库根目录的 [README.md](../README.md)。

本目录要点：

- `src/` —— 前端源码（React 19 + TypeScript + Vite + Tailwind CSS + shadcn/ui）
- `server/` —— 后端源码（Express + ws，REST `/api/*` + WebSocket `/ws`）
- `deploy/` —— 部署资产：`Dockerfile`、`nginx.conf`、`bridgehub.service`、`setup-nginx.sh` 等
- `docs/` —— [部署手册](docs/部署手册.pdf) 与 [用户使用手册](docs/用户使用手册.pdf)（含 Markdown 源文件）
- `DEPLOYMENT.md` —— Ubuntu 裸机 / Docker 部署详细指南

## 常用命令

```bash
npm ci               # 安装依赖（Node.js >= 20）
npm run dev          # 前端开发服务器（Vite）
npm run server       # 后端开发服务（REST + WebSocket，默认 :8100）
npm run build        # 构建前端 -> dist/
npm run build:server # 打包后端 -> dist-server/index.js
npm start            # 生产模式：单进程服务前端 + 后端（默认 :8100）
```

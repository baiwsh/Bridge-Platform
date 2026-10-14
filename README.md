# 桥牌汇 BridgeHub

**在线桥牌活动平台** —— 免下载、打开浏览器即玩。快速匹配、好友约战、人机练习、每日双人赛，支持**精确制**与**自然制**两种叫牌体系，内置标准**双人赛（MP）记分规则**。

[![Version](https://img.shields.io/badge/version-1.0.0-blue)](https://github.com/baiwsh/Bridge-Platform/releases/tag/v1.0.0)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org/)

---

## ✨ 功能特性

| 模块 | 说明 |
| --- | --- |
| 🏠 活动大厅 | 快速匹配、好友约战（约战码四人齐坐开赛）、人机练习桌 |
| 🏆 每日双人赛 | 每天 8 副牌，全场同牌竞技，比赛分（MP）排名，刷新最佳百分比 |
| 🤖 人机练习 | 与 AI 陪练对坐，熟悉精确制 / 自然制叫牌节奏，随时开桌无需等待 |
| 👤 账号体系 | 注册 / 登录，参赛成绩计入个人战绩与排行榜 |
| 📖 两种叫牌体系 | 牌桌可选**精确制（Precision Club）**或**自然制（标准美式 / 二盖一）**，内置完整约定卡速查 |
| 🧮 双人赛记分 | 复式定约计分 + 比赛分（Matchpoints）排名，与线下双人赛规则一致 |
| 📱 多端适配 | 桌面、平板、手机全端自适应，手机端专属叫盘面版与紧凑牌桌 |
| 🔌 联机对战 | WebSocket 实时同步；玩家掉线自动 AI 托管，重连恢复手动 |

## 🖥️ 界面预览

### 桌面端

| 首页 | 联机牌桌 |
| --- | --- |
| ![首页](docs/screenshots/home-desktop.png) | ![牌桌](docs/screenshots/table-desktop.png) |

| 每日双人赛 | 叫牌体系卡 |
| --- | --- |
| ![每日双人赛](docs/screenshots/daily-desktop.png) | ![叫牌体系](docs/screenshots/systems-desktop.png) |

| 双人赛记分规则 |
| --- |
| ![记分规则](docs/screenshots/scoring-desktop.png) |

### 移动端

| 手机首页 | 手机叫盘面版 |
| --- | --- |
| ![手机首页](docs/screenshots/mobile-home.png) | ![手机叫牌](docs/screenshots/mobile-bidding.png) |

## 🏗️ 技术架构

前后端一体应用：

| 部分 | 技术栈 | 说明 |
| --- | --- | --- |
| 前端 | React 19 + TypeScript + Vite + Tailwind CSS + shadcn/ui | SPA，构建产物 `app/dist/` |
| 后端 | Node.js + Express 5 + ws | REST `/api/*`（账号）+ WebSocket `/ws`（牌桌实时同步） |
| 数据 | JSON 文件存储（`server/data/`） | 账号 / 会话 / 每日赛成绩持久化（演示级，可换 SQLite / PostgreSQL） |

后端自带静态托管：生产模式下一个 `node dist-server/index.js` 进程同时服务前端页面、REST 与 WebSocket（默认端口 `8100`），前置 Nginx 做入口代理。

```
Bridge-Platform/
├── app/
│   ├── src/            # 前端源码（页面 / 组件 / 牌局引擎）
│   ├── server/         # 后端源码（Express + ws）
│   ├── deploy/         # 部署资产：Dockerfile / nginx.conf / systemd unit / 部署脚本
│   ├── docs/           # 部署手册 / 用户使用手册（Markdown + PDF）
│   └── DEPLOYMENT.md   # Ubuntu 部署详细指南
└── docs/screenshots/   # README 用截图
```

## 🚀 快速开始（本地开发）

```bash
cd app
npm ci          # 安装依赖（Node.js >= 20）

# 终端 1：后端（REST + WebSocket，默认 :8100）
npm run server

# 终端 2：前端（Vite 开发服务器，默认 :5173）
npm run dev
```

## 📦 生产部署（Ubuntu）

```bash
cd app
npm ci
npm run build          # 构建前端 -> dist/
npm run build:server   # 打包后端 -> dist-server/index.js
PORT=8100 npm start    # 单进程服务前端 + REST + WebSocket
```

完整指南（含 systemd 常驻、Nginx 反代、HTTPS、Docker）请参阅：

- 📘 [Ubuntu 部署指南](app/DEPLOYMENT.md)
- 📕 [部署手册（PDF）](app/docs/部署手册.pdf)
- 📗 [用户使用手册（PDF）](app/docs/用户使用手册.pdf)

## 🃏 叫牌体系与记分

- **自然制**：五张高花开叫、强无将 15–17、2♣ 人为强叫，适合入门到进阶。
- **精确制**：1♣ 人为强开叫（16+），其余开叫均为限定叫（11–15），点力范围窄、信息传递精确。
- **双人赛记分**：复式定约计分后，同方向成绩两两比较——每胜过一对得 2 个比赛分（MP），平局各 1 分，最终按 MP 百分比排名。平台内置定约计分器与 MP 换算演示。

## 📄 许可证

[MIT](LICENSE)

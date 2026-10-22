# 桥牌汇 BridgeHub · Ubuntu 部署指南

## 0. 架构说明

本项目为**前后端一体**应用：

| 部分 | 技术 | 说明 |
| --- | --- | --- |
| 前端 | React + Vite → 静态产物 `dist/` | 浏览器运行的 SPA |
| 后端 | Node + Express + `ws` → `dist-server/index.js` | REST `/api/*`（账号）+ WebSocket `/ws`（牌桌/对局同步） |
| 数据 | JSON 文件（`server/data/users.json`、`daily.json`） | 账号/会话与每日双人赛成绩持久化，演示级；生产可换 SQLite/PostgreSQL |

后端**自带静态托管**：生产模式下 `node dist-server/index.js` 一个进程即可同时服务前端页面、REST 与 WebSocket（默认端口 8100）。前面再套 Nginx 做 80/443 入口和 HTTPS 终止。

> 联机说明：真人同桌对战走 WebSocket，空位由 AI 补位；玩家中途掉线自动 AI 托管，重连后恢复手动。后端不可达时前端自动回退为单机模式（数据存浏览器）。

| 方案 | 适用场景 |
| --- | --- |
| A. 裸机/虚拟机部署（推荐） | 一台 Ubuntu 服务器跑全套 |
| B. Docker | 容器化部署 / CI |

---

## 1. 方案 A：Ubuntu 裸机部署（推荐）

### 1.1 安装依赖

```bash
sudo apt update
# Node.js 22 LTS（构建与运行后端都需要）
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node --version   # 应 >= v20
```

### 1.2 获取代码并构建

```bash
# 方式一：Git 拉取
sudo apt install -y git
git clone <你的仓库地址> /opt/bridgehub
cd /opt/bridgehub/app

# 方式二：本地上传（在本地执行）
#   scp -r Bridge-Platform/app ubuntu@<服务器IP>:/opt/bridgehub-app

cd /opt/bridgehub/app   # 或 /opt/bridgehub-app
npm ci                  # 按 lock 文件安装全部依赖
npm run build           # 构建前端 -> dist/
npm run build:server    # 打包后端 -> dist-server/index.js
npm ci --omit=dev       # 可选：裁掉 devDependencies，运行只需要 express 和 ws
```

### 1.3 用 systemd 常驻后端

创建 `/etc/systemd/system/bridgehub.service`（也可直接复制项目里的 `deploy/bridgehub.service`）：

```ini
[Unit]
Description=BridgeHub 桥牌汇服务
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/bridgehub/app
Environment=PORT=8100
Environment=BRIDGEHUB_DATA=/var/lib/bridgehub
# 位于 Nginx 反代之后时必须启用：否则客户端 IP 全被识别为 127.0.0.1，
# 内置限流会把全体用户挤进同一个配额桶（详见「部署手册」5.4 节）
Environment=TRUST_PROXY=1
ExecStart=/usr/bin/node dist-server/index.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

启动：

```bash
sudo mkdir -p /var/lib/bridgehub
sudo chown -R www-data:www-data /var/lib/bridgehub /opt/bridgehub
sudo systemctl daemon-reload
sudo systemctl enable --now bridgehub
sudo systemctl status bridgehub     # 应显示 active (running)
curl http://localhost:8100/api/health   # {"ok":true,...}
```

此时访问 `http://<服务器IP>:8100/` 已经可用（后端直接托管了前端）。

### 1.4 Nginx 做 80/443 入口（推荐）

```bash
sudo apt install -y nginx
```

`/etc/nginx/sites-available/bridgehub`（项目内模板：`deploy/nginx.conf`）：

```nginx
server {
    listen 80;
    server_name _;                     # 有域名时改为你的域名

    location /assets/ {
        proxy_pass http://127.0.0.1:8100;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }

    # WebSocket 升级（联机对局关键配置）
    location /ws {
        proxy_pass http://127.0.0.1:8100;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 3600s;      # 长连接保活
    }

    location /api/ {
        proxy_pass http://127.0.0.1:8100;
    }

    location / {
        proxy_pass http://127.0.0.1:8100;
    }
}
```

启用：

```bash
sudo ln -sf /etc/nginx/sites-available/bridgehub /etc/nginx/sites-enabled/bridgehub
sudo nginx -t && sudo systemctl reload nginx
sudo ufw allow 'Nginx Full'
```

### 1.5 HTTPS（有域名时）

```bash
sudo sed -i 's/server_name _;/server_name bridge.example.com;/' /etc/nginx/sites-available/bridgehub
sudo systemctl reload nginx
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d bridge.example.com
sudo certbot renew --dry-run
```

### 1.6 日常更新

```bash
cd /opt/bridgehub && git pull
cd app && npm ci && npm run build && npm run build:server
sudo systemctl restart bridgehub      # 静态文件与后端一并更新
```

---

## 2. 方案 B：Docker

`deploy/Dockerfile` 为一体化镜像（构建前端 → 打包后端 → 单容器运行）：

```bash
cd Bridge-Platform/app
sudo docker build -f deploy/Dockerfile -t bridgehub .
sudo docker run -d --name bridgehub -p 80:8100 \
  -v bridgehub-data:/app/data \
  --restart unless-stopped bridgehub
```

- `-v bridgehub-data:/app/data`：账号数据持久化到数据卷，重建容器不丢用户。
- 前面同样可以套 Nginx/Caddy 做 HTTPS。

Docker Compose（可选）：

```yaml
services:
  bridgehub:
    build:
      context: .
      dockerfile: deploy/Dockerfile
    ports:
      - "80:8100"
    volumes:
      - bridgehub-data:/app/data
    restart: unless-stopped
volumes:
  bridgehub-data: {}
```

---

## 3. 验证部署

```bash
curl -s http://<服务器>/api/health                 # {"ok":true,...}
curl -I http://<服务器>/lobby                      # SPA 路由应返回 200
curl -s -N -H "Connection: Upgrade" -H "Upgrade: websocket" \
     -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: x" \
     http://<服务器>/ws                            # 应返回 101 或 426（说明 WS 通道存在）
```

浏览器验证核心流程：注册账号 → 大厅出现「联机模式」徽标 → 入座 → 开始牌局 → 打完一副记分。开两个浏览器/两台设备登录不同账号坐进同一桌，即可真人对战。

项目自带自动化测试可复核：

```bash
npx tsx engine-test.mts        # 引擎回测（240 副守恒校验）
BOT_BID_MS=60 BOT_PLAY_MS=60 TRICK_CLEAR_MS=150 node ws-test.mjs   # 双客户端联机整场
```

## 4. 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` | `8100` | 后端监听端口 |
| `BRIDGEHUB_DATA` | `server/data` | 账号 JSON 数据目录 |
| `BOT_BID_MS` / `BOT_PLAY_MS` / `TRICK_CLEAR_MS` | `650/750/1100` | AI 行动节奏（毫秒），调小可加速测试 |
| `TRUST_PROXY` | 不信任 | **反代部署必须设为 `1`**，否则客户端 IP 恒为 `127.0.0.1`，限流失效且误伤全体用户 |
| `BEHIND_HTTPS` | 不发送 HSTS | 设为 `1` 下发 `Strict-Transport-Security`，确认全站 HTTPS 后再开 |
| `JSON_LIMIT` | `32kb` | REST 请求体上限，超限返回 413 |
| `AUTH_RATE_MAX` / `AUTH_RATE_WINDOW_MS` | `20` / `300000` | 注册/登录的单 IP 配额（5 分钟 20 次） |
| `API_RATE_MAX` / `API_RATE_WINDOW_MS` | `120` / `60000` | 其余 REST 接口的单 IP 配额 |

> v1.7.0 起后端内置 IP 限流、安全响应头与 WebSocket 接入限流（`server/security.ts`，零额外依赖）。
> 反代场景下请务必确认 `TRUST_PROXY=1` 已生效，并且 Nginx 的 `/ws` 块内**重复声明**了
> `X-Forwarded-For`（Nginx 的同名指令继承陷阱）。完整说明见 `docs/部署手册.md` 第 5、7 章。

## 5. 常见问题

| 问题 | 原因与解决 |
| --- | --- |
| 登录提示「操作过于频繁」且**所有人同时**受影响 | `TRUST_PROXY=1` 未生效，后端只看到 `127.0.0.1`；同时检查 Nginx `/ws` 块的转发头 |
| 大厅一直显示「单机模式」 | 前端连不上后端。查 `systemctl status bridgehub` 与 Nginx 的 `/api`、`/ws` 反代 |
| 入座后画面停在「正在连接牌桌」 | WebSocket 没通。确认 Nginx `location /ws` 的 `Upgrade`/`Connection` 头配置 |
| 刷新 404 | 生产模式由后端托管 SPA 无此问题；若自行用 Nginx 托管 `dist/`，需 `try_files $uri $uri/ /index.html;` |
| 数据丢失/迁移 | 账号在 `BRIDGEHUB_DATA/users.json`、每日双人赛成绩在 `BRIDGEHUB_DATA/daily.json`，备份这两个文件即可 |
| 国内服务器 npm 慢 | `npm ci --registry=https://registry.npmmirror.com` |
| 无痕模式/换浏览器要求重登 | 令牌存 localStorage，属预期；账号数据在服务端，重新登录即可恢复 |

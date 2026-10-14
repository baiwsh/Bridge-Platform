#!/usr/bin/env bash
# 桥牌汇一键部署：构建 -> 上传 -> systemd 重启后端 -> 重载 Nginx
# 前提：服务器已装 Node 20+、Nginx；首次先手动完成 DEPLOYMENT.md 1.3/1.4 节
# 用法: ./deploy/deploy.sh <user@服务器IP> [远端目录，默认 /opt/bridgehub]
set -euo pipefail

TARGET="${1:?用法: ./deploy/deploy.sh ubuntu@<服务器IP> [远端目录]}"
REMOTE="${2:-/opt/bridgehub}"
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> 1/5 本地构建前后端"
cd "$APP_DIR"
npm ci --no-audit --no-fund
npm run build
npm run build:server

echo "==> 2/5 同步代码到 $TARGET:$REMOTE"
ssh "$TARGET" "sudo mkdir -p '$REMOTE' && sudo chown -R \$USER '$REMOTE'"
# 不同步 node_modules 与数据目录；package-lock.json 用于远端安装生产依赖
tar czf - --exclude=node_modules --exclude=.git --exclude=data --exclude=shots . | ssh "$TARGET" "tar xzf - -C '$REMOTE'"

echo "==> 3/5 远端安装生产依赖"
ssh "$TARGET" "cd '$REMOTE' && npm ci --omit=dev --no-audit --no-fund"

echo "==> 4/5 配置 Nginx 与 systemd（已存在则跳过）"
scp "$APP_DIR/deploy/nginx.conf" "$TARGET:/tmp/bridgehub-nginx.conf"
scp "$APP_DIR/deploy/bridgehub.service" "$TARGET:/tmp/bridgehub.service"
ssh "$TARGET" "
  [ -f /etc/nginx/sites-available/bridgehub ] || sudo mv /tmp/bridgehub-nginx.conf /etc/nginx/sites-available/bridgehub
  [ -f /etc/systemd/system/bridgehub.service ] || sudo mv /tmp/bridgehub.service /etc/systemd/system/bridgehub.service
  sudo ln -sf /etc/nginx/sites-available/bridgehub /etc/nginx/sites-enabled/bridgehub
  sudo mkdir -p /var/lib/bridgehub && sudo chown -R www-data:www-data /var/lib/bridgehub '$REMOTE'
  sudo systemctl daemon-reload
"

echo "==> 5/5 重启服务并校验"
ssh "$TARGET" "
  sudo systemctl enable --now bridgehub
  sudo systemctl restart bridgehub
  sudo nginx -t && sudo systemctl reload nginx
  sleep 1
  curl -sf http://localhost:8100/api/health
"
echo
echo "完成！访问 http://${TARGET#*@}/"

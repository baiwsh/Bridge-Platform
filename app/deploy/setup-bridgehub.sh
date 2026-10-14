#!/bin/bash
# BridgeHub 一键部署脚本（以 root 身份运行）
set -e

echo "==> [1/5] 安装 Node.js 22 LTS"
if ! command -v node >/dev/null 2>&1; then
  cd /tmp
  F=$(curl -fsSL https://nodejs.org/dist/latest-v22.x/ | grep -oE 'node-v22[0-9.]*-linux-x64\.tar\.xz' | head -1)
  echo "    下载 $F"
  curl -fsSLO "https://nodejs.org/dist/latest-v22.x/$F"
  tar -xJf "$F" -C /usr/local --strip-components=1
fi
node -v

echo "==> [2/5] 解压应用到 /opt/bridgehub/app"
mkdir -p /opt/bridgehub/app /var/lib/bridgehub
tar -xzf /tmp/bridgehub-release.tar.gz -C /opt/bridgehub/app
cd /opt/bridgehub/app
echo "==> [3/5] 安装运行依赖（express + ws）"
npm install --omit=dev --no-audit --no-fund 2>&1 | tail -2

echo "==> [4/5] 配置 systemd 服务"
sed 's|/usr/bin/node|/usr/local/bin/node|' bridgehub.service > /etc/systemd/system/bridgehub.service
chown -R www-data:www-data /opt/bridgehub/app /var/lib/bridgehub
systemctl daemon-reload
systemctl enable bridgehub >/dev/null 2>&1 || true
systemctl restart bridgehub
# 防火墙放行（若启用）
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q 'Status: active'; then
  ufw allow 8100/tcp >/dev/null
  echo "    ufw 已放行 8100/tcp"
fi
sleep 2

echo "==> [5/5] 验证"
systemctl is-active bridgehub
curl -s http://127.0.0.1:8100/api/health
echo
echo "DEPLOY_DONE"

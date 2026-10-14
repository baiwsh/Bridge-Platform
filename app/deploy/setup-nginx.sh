#!/bin/bash
# BridgeHub：安装并切换为 Nginx 80 端口反向代理（以 root 身份运行）
set -e

echo "==> [1/4] 安装 Nginx"
if ! command -v nginx >/dev/null 2>&1; then
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nginx
fi
nginx -v

echo "==> [2/4] 配置站点"
cp /tmp/bridgehub-nginx.conf /etc/nginx/sites-available/bridgehub
ln -sf /etc/nginx/sites-available/bridgehub /etc/nginx/sites-enabled/bridgehub
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable nginx >/dev/null 2>&1 || true
systemctl restart nginx

echo "==> [3/4] 防火墙：放行 9100，收回 8100 对外直连"
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q 'Status: active'; then
  ufw allow 9100/tcp >/dev/null
  ufw delete allow 8100/tcp >/dev/null || true
fi
ufw status | head -8 || true

echo "==> [4/4] 本机验证"
curl -s http://127.0.0.1:9100/api/health
echo
curl -s -o /dev/null -w "port9100 首页 HTTP %{http_code}\n" http://127.0.0.1:9100/
echo "NGINX_DEPLOY_DONE"

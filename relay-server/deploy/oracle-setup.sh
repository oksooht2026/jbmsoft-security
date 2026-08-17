#!/bin/bash
# Oracle Cloud Always Free VM — OKSOOHT 릴레이 24/7 설치 (Ubuntu 22/24)
# 사용: VM SSH 접속 후
#   curl -fsSL https://raw.githubusercontent.com/.../oracle-setup.sh | bash
# 또는 relay-server 폴더에서: bash deploy/oracle-setup.sh

set -e
APP_DIR="${APP_DIR:-$HOME/oksooht-relay}"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-8765}"

echo "=== OKSOOHT Relay 설치 ==="

sudo apt-get update -qq
sudo apt-get install -y curl git ufw

if ! command -v node &>/dev/null || [[ $(node -v 2>/dev/null | cut -d. -f1 | tr -d v) -lt 18 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

mkdir -p "$APP_DIR"
if [ -f "$REPO_DIR/server.js" ]; then
  cp -r "$REPO_DIR/"* "$APP_DIR/"
else
  echo "relay-server 파일을 $APP_DIR 에 직접 복사한 뒤 다시 실행하세요."
  exit 1
fi

cd "$APP_DIR"
npm install --production

sudo ufw allow OpenSSH
sudo ufw allow "$PORT/tcp"
echo "y" | sudo ufw enable || true

sudo tee /etc/systemd/system/oksooht-relay.service > /dev/null <<EOF
[Unit]
Description=OKSOOHT Remote Relay
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$APP_DIR
Environment=PORT=$PORT
Environment=HOST=0.0.0.0
Environment=RELAY_SECRET=oksooht-remote-2026
ExecStart=$(command -v node) server.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable oksooht-relay
sudo systemctl restart oksooht-relay

PUBLIC_IP=$(curl -s ifconfig.me || curl -s icanhazip.com || echo "YOUR_VM_PUBLIC_IP")

echo ""
echo "============================================"
echo " 릴레이 설치 완료 (24/7 systemd)"
echo " VM 공인 IP: $PUBLIC_IP"
echo " HTTP 확인: http://${PUBLIC_IP}:${PORT}/health"
echo ""
echo " ⚠️  관리자 패널(HTTPS)은 wss:// 가 필요합니다."
echo "     다음 중 하나를 실행하세요:"
echo "     bash deploy/cloudflare-tunnel.sh"
echo "     또는 Oracle 방화벽에서 8765 열고 set-relay-url 실행"
echo "============================================"
systemctl status oksooht-relay --no-pager || true

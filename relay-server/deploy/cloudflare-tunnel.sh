#!/bin/bash
# Cloudflare Tunnel — 무료 wss:// 주소 (집·외부 HTTPS 관리자 패널용)
# 사전: cloudflare.com 가입, VM에서 실행

set -e
PORT="${PORT:-8765}"

if ! command -v cloudflared &>/dev/null; then
  curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
  sudo dpkg -i cloudflared.deb
  rm -f cloudflared.deb
fi

echo "Cloudflare 로그인 창이 열립니다 (브라우저 URL 표시)..."
cloudflared tunnel login

read -p "터널 이름 [oksooht-relay]: " TUNNEL_NAME
TUNNEL_NAME=${TUNNEL_NAME:-oksooht-relay}

cloudflared tunnel create "$TUNNEL_NAME" || true
TUNNEL_ID=$(cloudflared tunnel list | grep "$TUNNEL_NAME" | awk '{print $1}' | head -1)

mkdir -p ~/.cloudflared
cat > ~/.cloudflared/config.yml <<EOF
tunnel: $TUNNEL_ID
credentials-file: $HOME/.cloudflared/${TUNNEL_ID}.json

ingress:
  - service: http://127.0.0.1:${PORT}
  - service: http_status:404
EOF

sudo cloudflared service install
sudo systemctl enable cloudflared
sudo systemctl restart cloudflared

echo ""
echo "=== Quick Tunnel (도메인 없이 즉시 wss 테스트) ==="
echo "아래 명령으로 임시 URL 확인 (별도 터미널):"
echo "  cloudflared tunnel --url http://127.0.0.1:${PORT}"
echo ""
echo "고정 wss URL은 Cloudflare Zero Trust → Public Hostname 에서"
echo "  ${TUNNEL_NAME}.yourdomain.com → localhost:${PORT} 연결 후"
echo "  wss://relay.yourdomain.com 형태로 set-relay-url.ps1 에 입력"

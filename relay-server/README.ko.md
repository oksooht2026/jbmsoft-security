# OKSOOHT 원격 릴레이 — 24시간 무료 배포 가이드

## 추천: Oracle Cloud Always Free (진짜 24/7, $0)

| 항목 | 내용 |
|------|------|
| 비용 | **영구 무료** (카드 인증만, 과금 안 됨) |
| 스펙 | ARM 4코어 / 24GB RAM (충분) |
| Render/Fly 무료 | ❌ 15분·슬립 → 원격에 부적합 |
| Oracle | ✅ systemd로 24/7 |

---

## 1단계 — Oracle VM 만들기 (10분, 1회)

1. https://cloud.oracle.com 가입 (카드 인증, Always Free만 쓰면 과금 없음)
2. **Compute → Instances → Create**
   - Image: **Ubuntu 22.04**
   - Shape: **VM.Standard.A1.Flex** (Ampere, Always Free)
   - 1 OCPU, 6GB RAM 정도면 충분
   - SSH 키 등록
3. **Networking** — Public IP 할당
4. **Security List** — Ingress **TCP 8765** 허용 (원격 릴레이)
5. VM 생성 후 **Public IP** 메모

---

## 2단계 — 릴레이 설치 (VM SSH 1회)

로컬 PC에서 relay-server 폴더를 VM에 복사:

```powershell
scp -r D:\JBMSOFT_Security\relay-server ubuntu@VM공인IP:~/
```

VM 접속:

```bash
ssh ubuntu@VM공인IP
cd ~/relay-server
bash deploy/oracle-setup.sh
```

브라우저에서 확인: `http://VM공인IP:8765/health` → `"ok":true`

---

## 3단계 — wss:// (집·HTTPS 관리자용, 무료)

관리자 패널이 HTTPS라 **`wss://` 필수**. Cloudflare Tunnel (무료):

```bash
cd ~/relay-server
bash deploy/cloudflare-tunnel.sh
```

또는 **Quick Tunnel** (테스트용, URL 매번 바뀜):

```bash
cloudflared tunnel --url http://127.0.0.1:8765
# 출력: https://xxxx.trycloudflare.com  →  wss://xxxx.trycloudflare.com
```

고정 URL: Cloudflare Zero Trust에서 `relay.내도메인.com` → localhost:8765

---

## 4단계 — 자동 연동 (직원 PC 입력 없음)

로컬 PC (프로젝트 루트):

```powershell
cd D:\JBMSOFT_Security
.\relay-server\deploy\set-relay-url.ps1 -RelayUrl "wss://relay.내도메인.com"
```

또는:

```powershell
node relay-server/deploy/set-relay-url.js "wss://relay.내도메인.com"
```

**Vercel API** 환경변수 추가 (선택, 이중 안전):

- Project: `oksooht-security-api`
- `RELAY_PUBLIC_URL` = `wss://relay.내도메인.com`
- Redeploy

→ **42대 PC는 5분 이내 자동 연결**, 관리자 패널 Relay 칸 비워도 동작.

---

## 5단계 — 원격 접속

1. 직원 PC 보안 앱 실행 (agent 자동 연결)
2. https://oksooht-security-admin.vercel.app
3. 대시보드 → PC **Online** → **원격 접속**

---

## 대안: Fly.io (~$0~3/월, Oracle 어려울 때)

```powershell
cd D:\JBMSOFT_Security\relay-server
# flyctl install 후
fly launch --name oksooht-relay
fly deploy
fly certs add oksooht-relay.fly.dev
```

URL: `wss://oksooht-relay.fly.dev` → set-relay-url.ps1 실행

---

## 문제 해결

| 증상 | 해결 |
|------|------|
| 원격 접속 버튼 없음 | Relay URL DB 저장 확인, PC Online 확인 |
| PC 오프라인 | 보안 앱·트레이 실행 중인지 |
| wss 연결 실패 | `ws://` 대신 `wss://` 사용 |
| health 안 열림 | Oracle Security List 8765, `systemctl status oksooht-relay` |

---

## 요약

```
Oracle VM (무료 24/7) + Cloudflare wss (무료)
        ↓
set-relay-url.ps1 한 번
        ↓
42대 + 관리자 자동 — 추가 입력 없음
```

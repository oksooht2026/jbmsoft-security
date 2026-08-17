# 당신이 할 일만 (3단계)

나머지(코드, 스크립트, API 연동, PC 자동 설정)는 이미 프로젝트에 준비되어 있습니다.

---

## ① Oracle VM 만들기 (1회, 15분)

1. https://cloud.oracle.com 가입 (카드 인증, Always Free = 과금 없음)
2. **Compute → Instances → Create**
   - Ubuntu 22.04, **VM.Standard.A1.Flex**, 1 OCPU / 6GB
   - Public IP 할당
3. **Security List** → Ingress **TCP 8765** 허용
4. VM **Public IP** 메모 (예: `123.45.67.89`)

---

## ② PowerShell 한 줄 (VM IP만 바꿔서)

```powershell
cd D:\JBMSOFT_Security
.\scripts\relay-one-shot.ps1 -VmIp "123.45.67.89"
```

(끝나면 VM에 SSH 접속해서 아래 한 줄)

```bash
cloudflared tunnel --url http://127.0.0.1:8765
```

출력된 `https://xxxx.trycloudflare.com` 을 **`wss://xxxx.trycloudflare.com`** 로 바꿔서 ③으로.

---

## ③ wss 주소 알려주기

Cursor/채팅에 이렇게만 보내세요:

```
릴레이 URL: wss://xxxx.trycloudflare.com
```

→ DB 등록·정책 반영은 `register-relay-url.ps1` 또는 AI가 처리.

또는 직접:

```powershell
.\scripts\register-relay-url.ps1 -WssUrl "wss://xxxx.trycloudflare.com"
```

---

## 끝

- **직원 42명:** 아무것도 안 함 (앱만 실행)
- **원격:** 관리자 패널 → **원격 접속**

문제 있으면 VM Public IP + cloudflared 출력 URL만 보내주세요.

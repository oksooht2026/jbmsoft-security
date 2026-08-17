# OKSOOHT Security — AI 인수인계 문서

> **갱신일:** 2026-06-29  
> **프로젝트 루트:** `D:\JBMSOFT_Security`  
> **대상:** 다른 PC·다른 AI 세션에서 이어서 작업할 개발자/AI  
> **Git:** `main` · 마지막 커밋 `6e03244` · **로컬 변경 대량 미커밋**

---

## 0. AI에게 — 먼저 읽을 것

1. **운영 가이드(한글):** `D:\JBMSOFT_Security\docs\SECURITY_GUIDE.md`
2. **원격 데스크톱 릴레이(사용자 수동 작업):** `D:\JBMSOFT_Security\DO_THIS_ONLY.md`
3. **이 문서:** 코드 구조·최근 작업·미완료·경로 전체

**한 줄 요약:** 42대 PC용 Electron 보안 클라이언트 + Vercel API + Supabase + 관리자 웹. USB/파일/메일 감사·승인. 메일 로그는 **Chrome 확장 전용**(UIA 비활성). 확장 설치는 **바로가기 `--load-extension` 자동 패치**로 무료 배포 중.

---

## 1. 공식 URL · 인증

| 항목 | 값 |
|------|-----|
| 관리자 패널 | https://oksooht-security-admin.vercel.app |
| API Base | https://oksooht-security-api.vercel.app/api |
| 관리자 비밀번호 | `oksooht2026` |
| API Key | `oksooht-security-2026` (헤더 `x-api-key`) |
| 라이선스 한도 | 42대 |
| Vercel 팀 | `oksooht2026s-projects` |
| Supabase | `https://jswvsywvzfeevaxmthkl.supabase.co` |

### 사용 금지

- `https://jbmsoft-security-admin.vercel.app` — 구버전·배포 실패 프로젝트
- `_vercel_deploy/` — 임시/중복 배포 폴더. **정식 소스는 `server-api/`**

---

## 2. 디렉터리 · 경로 맵

```
D:\JBMSOFT_Security\
├── main.js                          # Electron 메인 (sync, 메일 브리지, 확장 등록)
├── preload.js
├── package.json                     # electron-builder 설정
├── update_db.js                     # Supabase settings 시드
│
├── src\main-window\                 # PC 클라이언트 UI
│   ├── index.html
│   └── js\app.js, i18n.js
│
├── security\                        # 보안 엔진 (핵심)
│   ├── approval-manager.js          # 승인 30분 grant
│   ├── os-engine.js                 # USB
│   ├── file-watcher.js
│   ├── extension-guard.js
│   ├── mail-guard.js                # SMTP/hosts (차단용, 로그는 확장 전용)
│   ├── mail-extension-bridge.js     # localhost HTTP 브리지 (:38471)
│   ├── mail-log-queue.js            # 오프라인 큐
│   ├── mail-extension-installer.js  # 확장 등록 + 바로가기 패치 호출
│   ├── mail-native-registry.js      # Native Messaging 레지스트리
│   ├── server-sync.js               # Vercel API 통신
│   └── security-utils.js
│
├── chrome-extension\                # MV3 메일 감사 확장
│   ├── manifest.json                # key 고정 → ID 고정
│   ├── background.js
│   ├── content.js
│   └── lib\mail-parser.js
│
├── native-host\                     # Chrome Native Messaging
│   ├── OksooMailHost.ps1
│   ├── OksooMailHost.cmd
│   └── com.oksoohitech.security.mail.json
│
├── scripts\
│   ├── install-browser-extension-shortcuts.ps1  # ★ 바로가기 --load-extension
│   ├── install-browser-extension.ps1            # 수동 설치용
│   ├── test-mail-extension-flow.js              # 브리지→서버 통합 테스트
│   ├── relay-one-shot.ps1                       # Oracle VM 릴레이
│   └── register-relay-url.ps1
│
├── server-api\                      # ★ Vercel API 정식 소스
│   ├── api\
│   │   ├── sync.js, dashboard.js, logs.js, approvals.js
│   │   ├── pcs.js                   # GET/PATCH/DELETE (별명)
│   │   ├── register.js, settings.js, admin-login.js
│   │   ├── realtime-config.js, documents.js
│   │   └── lib\
│   │       ├── supabase.js
│   │       ├── notify-admin.js
│   │       └── pc-nickname.js       # 별명 MAC 잠금
│   ├── vercel.json                  # api/*.js 만 함수 (12개 한도)
│   ├── supabase-schema.sql
│   └── .env                         # gitignore (로컬만)
│
├── admin-panel\                     # 관리자 정적 HTML
│   ├── index.html                   # 대시보드·별명 편집·승인
│   ├── config.js                    # API URL
│   ├── deploy-api.ps1               # server-api → Vercel 배포
│   └── deploy.ps1                   # admin-panel → Vercel 배포
│
├── build\
│   └── installer.nsh                # NSIS: shortcut 스크립트 실행
│
├── relay-server\                    # 원격 데스크톱 WebSocket 릴레이 (별도 호스팅)
│
├── docs\
│   └── SECURITY_GUIDE.md            # 운영 가이드 (한글)
│
├── dist\                            # npm run build 산출물
│   ├── OksooSecurity_Setup.exe      # NSIS 설치본
│   └── win-unpacked\
│       └── 옥수하이테크 보안솔루션.exe   # 압축 해제 실행 파일
│
├── HANDOFF.md                       # 이 문서
└── DO_THIS_ONLY.md                  # Oracle VM + cloudflared (사용자 작업)
```

### 런타임 경로 (PC 설치 후)

| 항목 | 경로 |
|------|------|
| 사용자 데이터 | `%APPDATA%\oksoo-security\` |
| 메일 로그 큐 | `%APPDATA%\oksoo-security\mail-log-queue.json` |
| 브리지 env | `%APPDATA%\oksoo-security\mail-bridge.env` |
| 설치본 확장 | `{설치경로}\resources\chrome-extension\` |
| 설치본 Native Host | `{설치경로}\resources\native-host\` |
| shortcut 스크립트(설치본) | `{설치경로}\resources\install-browser-extension-shortcuts.ps1` |

### 개발 시 확장 경로

```
D:\JBMSOFT_Security\chrome-extension
```

---

## 3. 최근 완료 작업 (2026-06 ~ 06-29)

### A. 메일 발송 로그 — Chrome 확장 전용

- **UIA/netstat/창감시 비활성** (`main.js` → `mailGuard.start(..., { extensionOnly: true })`)
- 흐름: 확장 → Native Host → `mail-extension-bridge` → `mail-log-queue` → `POST /api/logs` (`mail_send_audit`)
- **고정 확장 ID:** `keoikkfimipminfdbjlekjhgcjkjolil` (`manifest.json`의 `key`로 고정)

### B. Chrome 확장 무료 자동 설치 — 바로가기 패치

Google이 레지스트리 `path` 방식·`file://` 정책 설치를 막아서, **수동 「압축해제 로드」와 동일 효과**를 프로그램이 대신함:

1. `scripts/install-browser-extension-shortcuts.ps1` — Chrome/Edge/Whale `.lnk`에 `--load-extension="경로"` 추가
2. `security/mail-extension-installer.js` — 앱 실행 시 `registerExtension()` → shortcut 패치 호출
3. `build/installer.nsh` — NSIS 설치 시에도 동일 스크립트 실행
4. `package.json` `extraResources` — shortcut ps1 + chrome-extension + native-host 포함

**제한:** Chrome 내부 「압축해제 로드」 버튼은 API로 대체 불가. **바로가기/작업표시줄로 실행**해야 확장 로드됨. 개발자 모드 배너 가능.

**버그 수정 (06-29):** PowerShell `-or ""`가 Boolean 반환 → `.ToLower()`/`.Trim()` 실패. `[string]$lnk.TargetPath` 방식으로 수정. 테스트 PC에서 바로가기 **13개 패치 성공**.

### C. PC 별명 (관리자)

- `PATCH /api/pcs` — `{ mac_address, username }`
- `server-api/api/lib/pc-nickname.js` — `settings.pc_nickname_locked_macs`로 sync 시 덮어쓰기 방지
- `admin-panel/index.html` — 연필 아이콘 인라인 편집
- **한계:** PC 클라이언트 UI에는 별명 미반영 (서버·대시보드만)

### D. 관리자 대시보드

- PC 목록 비어 보이던 버그 수정 (`fetchDashboard` 시 `renderLicensePcs` 동기화)
- `/pcs` 실패 시 dashboard fallback

### E. API·배포 (이전 세션 포함)

- Vercel Hobby 12함수 한도: `vercel.json` → `api/*.js`만
- `/api/dashboard` 통합, 폴링 제거, Realtime 푸시 구조
- `/api/admin-login` 분리

---

## 4. 아키텍처

```
[Electron PC x42]
  │ USB/파일/승인 + 메일 브리지
  │ POST /sync (5min), /logs, /approvals
  ▼
[Vercel API] ──► [Supabase]
  │                    │ Realtime Broadcast
  ▼                    ▼
[Admin Panel HTML] ◄── push refresh

[Chrome/Edge/Whale + 확장]
  │ Native Messaging
  ▼
[mail-extension-bridge :38471] → mail-log-queue → /api/logs
```

### 메일 로그 상세

```
chrome-extension (webRequest + content.js)
  → OksooMailHost.ps1
  → mail-extension-bridge.js
  → mail-log-queue.js
  → server-sync.sendLogDirect
  → POST /api/logs (event_type: mail_send_audit)
```

---

## 5. API 엔드포인트

| 경로 | 메서드 | 용도 |
|------|--------|------|
| `/api/sync` | POST | 하트비트+정책+승인 |
| `/api/register` | POST | PC 등록 |
| `/api/dashboard` | GET | 관리자 통합 |
| `/api/admin-login` | POST | 관리자 로그인 |
| `/api/approvals` | GET/POST/PUT | 승인 |
| `/api/logs` | GET/POST | 로그 |
| `/api/settings` | GET/PUT | 정책 |
| `/api/pcs` | GET/PATCH/DELETE | PC 목록·별명 |
| `/api/realtime-config` | GET | Realtime 연결 정보 |

---

## 6. 빌드 · 실행 · 배포

### 로컬 개발

```powershell
cd D:\JBMSOFT_Security
npm install
node update_db.js
npm start
```

### 프로덕션 빌드

```powershell
cd D:\JBMSOFT_Security
npm run build
```

| 산출물 | 경로 |
|--------|------|
| 설치 프로그램 | `D:\JBMSOFT_Security\dist\OksooSecurity_Setup.exe` |
| 압축 해제 실행 | `D:\JBMSOFT_Security\dist\win-unpacked\옥수하이테크 보안솔루션.exe` |

> **주의:** `dist\`는 **shortcut 패치 수정 전 빌드**일 수 있음. 최신 shortcut 로직 반영 후 **재빌드 필요**.

### API 배포 (정식)

```powershell
cd D:\JBMSOFT_Security\server-api
npx vercel link --project oksooht-security-api --yes
npx vercel --prod --yes
```

또는:

```powershell
cd D:\JBMSOFT_Security\admin-panel
.\deploy-api.ps1
```

> `deploy-api.ps1`이 `_vercel_deploy`로 가면 **잘못된 경로**. 반드시 `server-api` 프로젝트 링크 확인.

### 관리자 패널 배포

```powershell
cd D:\JBMSOFT_Security\admin-panel
npx vercel link --project oksooht-security-admin --yes
npx vercel --prod --yes
```

### 확장 바로가기만 수동 패치 (테스트)

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "D:\JBMSOFT_Security\scripts\install-browser-extension-shortcuts.ps1" -ExtensionDir "D:\JBMSOFT_Security\chrome-extension"
```

### 메일 파이프라인 통합 테스트

```powershell
cd D:\JBMSOFT_Security
node scripts\test-mail-extension-flow.js
```

---

## 7. 미완료 · 다음 작업

| 우선순위 | 항목 | 조치 |
|:--------:|------|------|
| 높음 | **앱 재빌드** | shortcut ps1 버그 수정 반영 → `npm run build` → Setup 배포 |
| 높음 | **Chrome E2E 수동 확인** | 작업표시줄 Chrome 실행 → `chrome://extensions` → 확장 표시 → 네이버 메일 발송 → 대시보드 `mail_send_audit` |
| 중간 | **Git 커밋/푸시** | 대량 미커밋 변경 정리 |
| 중간 | **Realtime anon key** | `server-api/setup-realtime.js` + Vercel env `SUPABASE_ANON_KEY` |
| 중간 | **SECURITY_GUIDE §6 갱신** | 바로가기 `--load-extension` 방식 문서화 (현재는 레지스트리 위주 설명 잔존) |
| 낮음 | **웹스토어 $5 일부공개** | 프로덕션 정석 (`ExtensionInstallForcelist` + CRX URL) |
| 낮음 | **원격 데스크톱 relay** | `DO_THIS_ONLY.md` — Oracle VM + cloudflared (사용자 작업 대기) |
| 낮음 | **PC 앱에 별명 표시** | sync 응답 username → 클라이언트 UI (미구현) |

### Chrome 확장 설치 방식 비교

| 방식 | 상태 |
|------|------|
| 레지스트리 `path` | 등록만 됨, Chrome **무시** (최신 정책) |
| `file://` Forcelist | 일반 PC에서 **실패** |
| 수동 압축해제 로드 | 동작함, PC마다 수동 |
| **바로가기 `--load-extension`** | **구현 완료**, 무료 자동화 |
| 웹스토어 일부공개 ($5) | 권장 프로덕션 경로 (미진행) |

---

## 8. 알려진 이슈 · 주의사항

1. **Vercel Hobby:** Serverless Function 최대 12개, Edge Request 한도 — `api/lib/`은 함수로 빌드되면 안 됨
2. **`_vercel_deploy/`:** 중복/실험 폴더. 정식은 `server-api/`
3. **ProgramData 시작 메뉴 바로가기:** 관리자 권한 없으면 shortcut 패치 실패 (일반 사용자 바탕화면·작업표시줄은 OK)
4. **메일 UIA:** `mail-uia-test/` 폴더 별도 — 본체와 동기화·재빌드 필요 시 확인
5. **등록 PC (API 기준 예시):** DESKTOP-L9DP202, DESKTOP-CFQOPOM — 테스트 중 별명 변경됨

---

## 9. 테스트 체크리스트

- [ ] https://oksooht-security-admin.vercel.app 로그인
- [ ] PC 목록·별명 연필 수정 → 저장
- [ ] USB 승인 → 30분 허용
- [ ] `npm start` 또는 `dist\win-unpacked\*.exe` 실행
- [ ] 작업표시줄 Chrome → `chrome://extensions`에 확장 표시
- [ ] 웹메일 발송 → 대시보드 `mail_send_audit`
- [ ] `node scripts\test-mail-extension-flow.js` 성공
- [ ] (선택) Realtime 설정 후 승인 시 자동 갱신

---

## 10. Realtime 1회 설정 (미완)

```powershell
cd D:\JBMSOFT_Security\server-api
node setup-realtime.js "SUPABASE_ANON_KEY_붙여넣기"
npx vercel env add SUPABASE_ANON_KEY production
# 이후 API 재배포
```

---

## 11. 후속 AI에게 한 줄 지시 예시

> `D:\JBMSOFT_Security` OKSOOHT 보안솔루션. `HANDOFF.md`와 `docs\SECURITY_GUIDE.md` 읽고 이어서 작업. 메일 로그는 Chrome 확장 전용, 확장은 `install-browser-extension-shortcuts.ps1`로 바로가기 자동 패치. 다음: **재빌드 + Chrome E2E 확인** 또는 **Realtime anon key**.

---

*옥수하이테크(JBMSOFT) · Copyright © 2026*

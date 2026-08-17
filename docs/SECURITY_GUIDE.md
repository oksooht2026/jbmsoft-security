# 옥수하이테크 보안솔루션 — 운영 가이드

> **버전:** 1.0 · **최종 갱신:** 2026-06-26  
> **관리자:** https://oksooht-security-admin.vercel.app  
> **API:** https://oksooht-security-api.vercel.app/api

---

## 목차

1. [시스템 개요](#1-시스템-개요)
2. [PC 별명 (닉네임)](#2-pc-별명-닉네임)
3. [메일 발송 로그](#3-메일-발송-로그)
4. [USB · 파일이동 · 승인](#4-usb--파일이동--승인)
5. [로그 · API · 대시보드](#5-로그--api--대시보드)
6. [설치 · 확장 프로그램 배포](#6-설치--확장-프로그램-배포)
7. [현재 설정 요약](#7-현재-설정-요약)

---

## 1. 시스템 개요

```
┌─────────────────────────────────────────────────────────────────┐
│                     PC 클라이언트 (Electron)                      │
│  트레이 상주 · USB/파일 감시 · Chrome 확장 연동 · 서버 동기화      │
└────────────────────────────┬────────────────────────────────────┘
                             │ HTTPS (x-api-key)
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│              Vercel API + Supabase                               │
│  /sync  /logs  /approvals  /pcs  /settings  /dashboard           │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│              관리자 대시보드 (웹)                                  │
│  PC 목록 · 별명 · 승인 대기열 · 보안 로그 · 정책 설정              │
└─────────────────────────────────────────────────────────────────┘
```

| 구성요소 | 역할 |
|----------|------|
| **Electron 앱** | USB 차단·승인, 파일 감시, Chrome 확장 ↔ 서버 중계 |
| **Chrome 확장** | 웹메일 발송 HTTP 요청 캡처 → Native Messaging |
| **서버 API** | PC 등록, 로그 저장, 승인 처리, 정책 배포 |
| **관리자 패널** | PC·별명·승인·로그 조회 및 설정 |

---

## 2. PC 별명 (닉네임)

### 관리자에서 설정하면 어디에 반영되나?

| 구분 | 반영 | 설명 |
|------|:----:|------|
| 관리자 대시보드 PC 목록 | ✅ | 「별명 (닉네임)」 컬럼, 연필 아이콘으로 수정 |
| 서버 DB `pcs.username` | ✅ | PATCH `/api/pcs` 저장 |
| 클라이언트 앱 화면 | ❌ | Windows 로그인명 표시 (자동 동기화 없음) |
| 승인 요청 requester | ❌ | Windows 사용자명 사용 |
| 서버 동기화 덮어쓰기 방지 | ✅ | MAC 잠금 목록으로 관리자 별명 보호 |

### 동작 흐름

```
[관리자] "영업1팀-김대리" 저장
        ↓
서버 pcs.username = "영업1팀-김대리"
settings.pc_nickname_locked_macs ← MAC 추가
        ↓
[PC] 5분마다 sync → username: "jaewon" (Windows명) 전송
        ↓
서버: MAC 잠금 → "영업1팀-김대리" 유지 ✅
        ↓
[PC 앱 UI] Windows명 그대로 표시 ❌
```

> **정리:** 별명은 **관리자·서버 식별용**입니다. PC 앱에도 표시하려면 sync 응답에 username을 포함하는 추가 개발이 필요합니다.

### 별명 수정 방법 (관리자)

1. 대시보드 → **활성 디바이스 현황** 또는 **라이선스** 탭
2. 별명 옆 **연필 아이콘** → 입력 → **저장**
3. 비우고 저장하면 잠금 해제 → 이후 PC Windows명으로 복원

---

## 3. 메일 발송 로그

> **현재 정책:** Chrome/Edge/Whale **확장 프로그램 전용** (UIA·netstat·창감시 비활성)

### 전체 흐름

```
브라우저에서 웹메일 발송 (네이버/Gmail/그룹웨어 등)
        ↓
┌───────────────────────────────────────────┐
│  OKSOOHT Mail Logger (Chrome 확장 MV3)     │
│  ① webRequest — POST body 감시            │
│  ② content.js — fetch/XHR 후킹            │
└───────────────────┬───────────────────────┘
                    │ Native Messaging
                    ▼
┌───────────────────────────────────────────┐
│  OksooMailHost.ps1 (Native Host)          │
│  stdin/stdout JSON → HTTP localhost       │
└───────────────────┬───────────────────────┘
                    ▼
┌───────────────────────────────────────────┐
│  Electron mail-extension-bridge (:38471)  │
│  → mail-log-queue.json (오프라인 큐)      │
│  → serverSync.sendLogDirect               │
└───────────────────┬───────────────────────┘
                    ▼
        POST /api/logs  (mail_send_audit)
                    ▼
           관리자 대시보드 로그 목록
```

### 수집 데이터

| 필드 | 설명 |
|------|------|
| `browser` | Chrome / Edge / Whale |
| `mail_host` | mail.naver.com 등 |
| `sender` | 보낸 사람 |
| `recipients` | 수신자 배열 |
| `subject` / `title` | 메일 제목 |
| `bodyPreview` | 본문 앞부분 (최대 8,000자) |
| `attachments` | 첨부 파일명 |
| `pageUrl` | 발송 페이지 URL |
| `source` | `chrome_extension` |

### 서버 로그 형식

```json
{
  "event_type": "mail_send_audit",
  "severity": "info",
  "message": "[메일 발송] naver — 제목 예시",
  "details": {
    "source": "chrome_extension",
    "browser": "Chrome",
    "mail_host": "mail.naver.com",
    "recipients": ["user@example.com"],
    "subject": "제목 예시",
    "bodyPreview": "본문...",
    "provider": "naver"
  }
}
```

### 오프라인 · 재전송

| 항목 | 값 |
|------|-----|
| 큐 파일 | `%APPDATA%\oksoo-security\mail-log-queue.json` |
| 재시도 주기 | 30초 |
| 최대 재시도 | 20회 |

### 확장 프로그램 ID (고정)

```
keoikkfimipminfdbjlekjhgcjkjolil
```

---

## 4. USB · 파일이동 · 승인

### 시스템 구조

```
┌──────────────┬──────────────┬──────────────┬─────────────────┐
│  os-engine   │ extension-   │ file-watcher │ approval-       │
│  USB 연결    │ guard        │ 폴더 감시     │ manager         │
│  차단·감시   │ 실행 차단    │              │ 승인 워크플로   │
└──────┬───────┴──────┬───────┴──────┬───────┴────────┬────────┘
       └──────────────┴──────────────┴────────────────┘
                              ↓
              POST /api/logs  +  POST /api/approvals
                              ↓
                    관리자 대시보드
```

---

### A. USB 연결

| 단계 | 동작 |
|:----:|------|
| 1 | `os-engine` — USB 드라이브 2초 폴링 |
| 2 | icacls로 드라이브 접근 차단 (`usbGuard` ON) |
| 3 | `usb_connect` 승인 요청 → 서버 |
| 4 | PC 트레이·앱 「승인 대기」 알림 |
| 5 | 관리자 대시보드에서 승인/거부 |
| 6 | 1~2분 내 sync → 드라이브 **30분** 허용 |

---

### B. USB 파일 이동 (USB로 복사)

| 단계 | 동작 |
|:----:|------|
| 1 | USB 드라이브 chokidar 감시 |
| 2 | 파일 **격리 폴더**로 이동 |
| 3 | `usb_file_transfer` 승인 요청 |
| 4 | 로그: `usb_file_pending` (warning) |
| 5 | 관리자 승인 → 격리 파일 USB 경로 **복원** + 30분 허용 |

```
USB에 report.pdf 복사 시도
  → USB에서 파일 사라짐 (격리)
  → [승인 대기] 알림
  → 관리자 승인
  → 파일 USB로 복원
```

---

### C. 일반 파일 감시

| 기능 | 모듈 | 동작 |
|------|------|------|
| 중요 폴더 감시 | `file-watcher` | Downloads, Desktop 등 |
| 차단 확장자 | `extension-guard` | exe, pdf, hwp 등 — **로컬 로그만** |
| 실행 차단 | `extension-guard` | 차단 확장자 프로세스 강제 종료 |

---

### D. 승인 워크플로

```
[PC] USB 연결 / USB 파일 / 메일 / 파일 이동
        ↓
approvalManager.createRequest()
        ↓
POST /api/approvals  (status: pending)
        ↓
[관리자] 승인 / 거부
        ↓
PUT /api/approvals?id=...
        ↓
[PC] sync (5분) 또는 승인 폴링 (2분, 대기 중)
        ↓
grant() → USB 허용 / 파일 복원
        ↓
트레이 알림 「✅ USB 연결 승인됨」
```

| 승인 유형 | 트리거 | 승인 후 |
|-----------|--------|---------|
| `usb_connect` | USB 꽂음 | 드라이브 30분 사용 |
| `usb_file_transfer` | USB 파일 복사 | 파일 복원 + 30분 허용 |
| `file_transfer` | 일반 파일 이동 | 30분 허용 |
| `mail_send` | 외부 메일 (차단 모드) | 수신자 30분 허용 |
| `webmail_access` | 웹메일 접속 (차단 모드) | 서비스 30분 허용 |

**동기화 주기**

| 항목 | 주기 |
|------|------|
| 하트비트 · 정책 | 5분 |
| 승인 대기 폴링 | 2분 (대기 중일 때) |
| 승인 유효 시간 | 30분 |

---

## 5. 로그 · API · 대시보드

### 주요 API

| API | 용도 | 호출 주체 |
|-----|------|-----------|
| `POST /api/sync` | 하트비트, 정책, 승인 동기화 | PC 클라이언트 |
| `POST /api/logs` | 보안·메일 로그 저장 | PC 클라이언트 |
| `POST /api/approvals` | 승인 요청 | PC 클라이언트 |
| `PUT /api/approvals` | 승인/거부 | 관리자 |
| `PATCH /api/pcs` | PC 별명 수정 | 관리자 |
| `GET /api/dashboard` | 통합 대시보드 | 관리자 |

**인증:** `x-api-key: oksooht-security-2026`

### 대시보드 표시

| 데이터 | 화면 |
|--------|------|
| `logs` | 최근 위협 및 보안 로그 |
| `approvals` | USB 승인 대기열 |
| `pcs` | 활성 디바이스 + 별명 |

> 로그 목록은 `message` 문자열 위주 표시. `details` JSON은 목록에서 펼치지 않음.

### 주요 event_type

| event_type | severity | 설명 |
|------------|----------|------|
| `mail_send_audit` | info | 웹메일 발송 (확장) |
| `usb_file_pending` | warning | USB 파일 승인 대기 |
| `usb_file_event` | info | USB 파일 변경 |
| `engine_paused` | warning | 엔진 일시 중지 |
| `app_start` / `app_stop` | info | 앱 시작/종료 |

---

## 6. 설치 · 확장 프로그램 배포

### NSIS 설치 시 자동 처리

| 순서 | 작업 | 담당 |
|:----:|------|------|
| 1 | Chrome/Edge/Whale 확장 레지스트리 등록 | NSIS `customInstall` |
| 2 | Native Messaging Host 등록 | Electron 첫 실행 |
| 3 | localhost 브리지 기동 | Electron 트레이 실행 |

### 설치 후 사용자 안내

1. **보안솔루션 앱** 트레이 실행 (설치 시 자동)
2. **Chrome/Edge/Whale 재시작** → 확장 자동 활성화
3. 웹메일 발송 → 관리자 대시보드에서 `mail_send_audit` 확인

### 수동 설치 (개발·테스트)

```powershell
# 확장 + Native Host
cd d:\JBMSOFT_Security\scripts
.\install-browser-extension.ps1 -ResourcesDir "d:\JBMSOFT_Security"

# Electron 앱 실행
cd d:\JBMSOFT_Security
npm start
```

### 파일 위치 (설치 후)

| 항목 | 경로 |
|------|------|
| 확장 프로그램 | `{설치경로}\resources\chrome-extension\` |
| Native Host | `{설치경로}\resources\native-host\` |
| 메일 큐 | `%APPDATA%\oksoo-security\mail-log-queue.json` |
| 브리지 토큰 | `%APPDATA%\oksoo-security\mail-bridge.token` |

### 빌드

```powershell
npm run build
```

| 산출물 | 설명 |
|--------|------|
| `OksooSecurity_Setup.exe` | NSIS 설치 (확장 자동 등록) |
| `OksooSecurity_Portable.exe` | 무설치 포터블 |

---

## 7. 현재 설정 요약

| 기능 | 상태 |
|------|------|
| 메일 차단 | **OFF** |
| 메일 발송 로그 | **SSL 복호화 프록시 + UIA 스크래핑** |
| UIA 메일 감사 | **ON** |
| USB 차단 · 승인 | **ON** |
| PC 별명 (관리자) | 서버·대시보드 ✅ / PC 앱 ❌ |
| 파일 감시 | 로컬 로그만 |

---

## 부록 — 관련 소스 파일

| 파일 | 역할 |
|------|------|
| `chrome-extension/` | 웹메일 HTTP 캡처 확장 |
| `native-host/` | Native Messaging Host |
| `security/mail-extension-bridge.js` | Electron HTTP 브리지 |
| `security/mail-log-queue.js` | 오프라인 재전송 큐 |
| `security/mail-extension-installer.js` | 확장 레지스트리 등록 |
| `security/approval-manager.js` | 승인 워크플로 |
| `security/os-engine.js` | USB 엔진 |
| `server-api/api/logs.js` | 로그 API |
| `admin-panel/index.html` | 관리자 대시board |

---

*옥수하이테크(JBMSOFT) 보안솔루션 · Copyright © 2026*

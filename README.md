# JBMSOFT Security 🛡️

**사내 보안 관리 시스템 v1.0** — Electron.js 기반 데스크톱 보안 프로그램

---

## 주요 기능

| 기능 | 설명 |
|------|------|
| 🛡️ 파일 보안 | 클립보드 복사 차단, USB 차단, 지정 폴더 감시 |
| 📧 메일 보안 | 첨부파일 전송 차단, 화이트리스트 관리 |
| 🖥️ 허용 PC 관리 | MAC/IP 기반 허용 PC 등록·관리 |
| ✅ 관리자 승인 | 파일 전송 예외 승인/거부 큐 |
| 📋 보안 로그 | 모든 이벤트 이력 기록·검색·내보내기 |
| 🌐 한/영 지원 | 한국어/영어 UI 전환 |
| 🔔 시스템 트레이 | 백그라운드 상주, 트레이 아이콘 |
| 💫 스플래시 화면 | 앱 시작 시 로딩 애니메이션 |

---

## 실행 방법

### 1. 사전 준비 (최초 1회)

```bash
# 의존성 설치
npm install

# Supabase DB 설정 동기화 (라이선스 42대, 정책 등)
node update_db.js

# API 서버 Vercel 배포 (/sync API 포함)
cd server-api
vercel --prod
```

### 2. 클라이언트 테스트 (개발)

**PowerShell을 관리자 권한으로** 실행:

```bash
cd D:\JBMSOFT_Security
npm start
```

> 관리자 권한 필수 — USB 차단, hosts 파일 수정, 방화벽 규칙 적용에 필요합니다.

### 3. 설치 파일 빌드 (42대 배포용)

```bash
npm run build
# → dist/OksooSecurity_Setup.exe 생성
```

생성된 설치 파일을 각 PC에 배포합니다.

### 4. 관리자 패널

브라우저에서 `admin-panel/index.html` 열기 (또는 admin-panel Vercel 배포 URL)

| 메뉴 | 용도 |
|------|------|
| 관제 대시보드 | PC 현황, 승인 요청, 보안 로그 |
| 결재 / 승인함 | USB·메일·파일 승인/거부 |
| 글로벌 정책 | USB, 메일, 확장자, 사이트 차단 설정 |
| 라이선스 | 등록 PC 수 / 42대 한도 관리 |
| 설치 · 테스트 | 상세 가이드 |

**로그인:** 마스터 비밀번호 (기본 `oksooht2026`)

> `license-manager.html` 은 관리자 패널 **라이선스** 탭으로 통합되었습니다.

### 5. 기능 테스트 체크리스트

- [ ] USB 꽂기 → 차단 → 관리자 패널에서 승인 → 사용 가능
- [ ] `test.pdf` 복사 → 격리 → 승인 → 파일 복원
- [ ] 메일 발송 시도 → 차단 → 승인 → 발송 허용
- [ ] `mail.naver.com` 브라우저 접속 차단 확인
- [ ] 관리자 패널에 PC **Online** 표시 (5분 이내)

---

## 디렉토리 구조

```
JBMSOFT_Security/
├── main.js              # Electron 메인 프로세스
├── preload.js           # IPC 브리지
├── src/
│   ├── splash/          # 스플래시 화면
│   ├── main-window/     # 메인 설정 창 (7개 탭)
│   └── assets/          # 로고, 아이콘
├── security/            # 보안 모듈 (파일감시, PC등록)
└── data/                # 암호화 설정 DB
```

---

## 기술 스택

- **Electron.js** v28 — 데스크톱 앱 프레임워크
- **electron-store** v5 — 로컬 설정 영속성
- **chokidar** v3 — 파일 시스템 감시
- **Noto Sans KR** + **JetBrains Mono** — 한글/코드 폰트

---

© 2025 JBMSOFT. All Rights Reserved.

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

```bash
# 의존성 설치
npm install

# 앱 실행
npm start
```

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

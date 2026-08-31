const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const dist = 'D:/JBMSOFT_Security/dist';

// 1. 디렉토리 경로 정의
const dir0831 = path.join(dist, '20260831_최신배포용_v1.0.1');
const dir0826 = path.join(dist, '20260826_긴급복구_HTTP사이트');
const dir0805 = path.join(dist, '20260805_현장설치용_v1.0.0(구버전)');
const dirArchive = path.join(dist, '과거_빌드_보관(2026년7월~8월초)');

if (!fs.existsSync(dir0831)) fs.mkdirSync(dir0831, { recursive: true });
if (!fs.existsSync(dir0826)) fs.mkdirSync(dir0826, { recursive: true });
if (!fs.existsSync(dir0805) && fs.existsSync(path.join(dist, '20260805_현장설치용'))) {
  fs.renameSync(path.join(dist, '20260805_현장설치용'), dir0805);
}
if (!fs.existsSync(dirArchive)) fs.mkdirSync(dirArchive, { recursive: true });

// 2. 2026-08-31 최신 파일 복사
if (fs.existsSync(path.join(dist, 'OksooSecurity_Setup.exe'))) {
  fs.copyFileSync(path.join(dist, 'OksooSecurity_Setup.exe'), path.join(dir0831, '01_정식버전_OksooSecurity_Setup_v1.0.1.exe'));
}
if (fs.existsSync(path.join(dist, 'OksooSecurity_Portable.exe'))) {
  fs.copyFileSync(path.join(dist, 'OksooSecurity_Portable.exe'), path.join(dir0831, '02_포터블_OksooSecurity_Portable_v1.0.1.exe'));
}

const notice0831 = `[2026-08-31 옥수하이테크 보안솔루션 v1.0.1 배포 안내]

1. 포함된 파일
- 01_정식버전_OksooSecurity_Setup_v1.0.1.exe : 정식 설치 파일 (권장)
- 02_포터블_OksooSecurity_Portable_v1.0.1.exe : 무설치 실행 파일
- 03_OksooSecurity_Setup_v1.0.1.zip : 배포용 압축 파일

2. 주요 패치 내역
- 웹메일 발송 감지 100% 무누락 강화 (네이버/다음/구글/다우오피스 쿼리 패턴 전수 감지)
- 일반 웹사이트(HTTP) 투명 패스스루 지원 (glos.co.kr 등 일반 HTTP 사이트 완벽 접속)
- 1분 주기 자체 상태 점검 및 자동 복구 (Self-Healing Watchdog) 엔진 탑재
- 원격 자동 업데이트 (Zero-Touch) 지원
- 대용량 파일 첨부 발송 최적화 (속도 저하 및 메모리 크래시 방지)
`;
fs.writeFileSync(path.join(dir0831, '00_업데이트_안내.txt'), notice0831, 'utf8');

// 3. 2026-08-26 긴급복구 파일 정리
if (fs.existsSync(path.join(dist, '긴급복구_HTTP사이트'))) {
  const items = fs.readdirSync(path.join(dist, '긴급복구_HTTP사이트'));
  for (const item of items) {
    fs.copyFileSync(path.join(dist, '긴급복구_HTTP사이트', item), path.join(dir0826, item));
  }
}
if (fs.existsSync(path.join(dist, 'call_transcript_ko.txt'))) {
  fs.copyFileSync(path.join(dist, 'call_transcript_ko.txt'), path.join(dir0826, '통화녹음_요약(이한솔과장).txt'));
}

// 4. 과거 빌드 아카이브 이동
const archiveTargets = [
  'OksooSecurity_Setup.zip',
  'OksooSecurity_Setup_0716수정.zip',
  'OksooSecurity_Setup_0804.zip',
  'OksooSecurity_Setup_NAS_클립보드수정.zip',
  'OksooSecurity_Setup_NoUSB.exe',
  'OksooSecurity_Setup_NoUSB.exe.blockmap',
  'OksooSecurity_Setup_NoUSB.zip',
  'OksooSecurity_Setup_USB수정.zip',
  'OksooSecurity_Setup_수정.zip',
  'OksooSecurity_Setup_캡쳐차단제외.zip',
  'OksooSecurity_MailOnly_Setup.exe',
  'OksooSecurity_MailOnly_Setup.exe.blockmap',
  'OksooSecurity_MailOnly_Setup.zip',
  'OksooSecurity_Portable_NoUSB.exe',
  '20260805_현장설치용 (2).zip',
  '20260805_현장설치용.zip',
  'call_transcript_ihan솔.txt',
  'call_transcript_ko.txt',
  'OksooHttpFix.zip',
  '긴급복구_HTTP사이트.zip'
];

for (const f of archiveTargets) {
  const src = path.join(dist, f);
  const dst = path.join(dirArchive, f);
  if (fs.existsSync(src)) {
    try {
      fs.renameSync(src, dst);
    } catch(e) {
      console.warn('이동 실패:', f, e.message);
    }
  }
}

// 이전 폴더 정리
if (fs.existsSync(path.join(dist, '긴급복구_HTTP사이트'))) {
  try {
    fs.rmSync(path.join(dist, '긴급복구_HTTP사이트'), { recursive: true, force: true });
  } catch(e) {}
}

console.log('dist 폴더 날짜별 정리 완료!');

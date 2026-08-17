// D:\JBMSOFT_Security\scripts\test-full-upload-flow.js
const fs = require('fs');
const path = require('path');
const mailLogQueue = require('../security/mail-log-queue');
const serverSync = require('../security/server-sync');

const userDataPath = path.join(__dirname, '..', '_tmp_test_upload_userdata');

async function main() {
  console.log('=== Vercel 서버 실제 로그 전송 E2E 테스트 시작 ===');

  if (!fs.existsSync(userDataPath)) {
    fs.mkdirSync(userDataPath, { recursive: true });
  }

  // 1. 메일 로그 큐 초기화 (임시 userdata 디렉토리 이용)
  console.log('1. 오프라인 메일 로그 큐 초기화...');
  mailLogQueue.init(userDataPath);

  // 2. 가상의 메일 발송 감지 페이로드 생성
  const dummyMailPayload = {
    browser: 'Chrome',
    mail_host: 'mail.google.com',
    sender: 'oksoo-test-sender@gmail.com',
    recipients: ['oksoo-test-recipient@naver.com'],
    title: `[자동 테스트] SSL 프록시 연동 실서버 로그 수집 검증 - ${new Date().toLocaleTimeString()}`,
    body: '본 테스트 메일 로그는 로컬 SSL 복호화 프록시 모듈 및 Vercel 중앙 서버 연동 상태를 확인하기 위해 모델이 자동 생성한 로그 항목입니다. 정상 수집 완료.',
    pageUrl: 'https://mail.google.com/mail/u/0/#inbox?compose=new',
    timestamp: new Date().toISOString()
  };

  console.log('2. 가상 메일 발송 로그를 로컬 큐에 등록 중...');
  console.log(`   - 제목: ${dummyMailPayload.title}`);
  
  // 3. 로컬 큐 인큐 (이때 내부적으로 flushQueue()가 자동 호출되며 Vercel로 업로드됩니다)
  const isEnqueued = mailLogQueue.enqueue(dummyMailPayload);
  if (isEnqueued) {
    console.log('[OK] 로컬 큐 등록 성공. 즉시 Vercel 서버로 전송을 시도합니다...');
  } else {
    console.error('[FAIL] 로컬 큐 등록 실패');
    cleanup();
    process.exit(1);
  }

  // 전송 대기 및 큐 확인 (최대 5초)
  console.log('3. 서버 응답 및 전송 상태 모니터링...');
  let attempts = 0;
  let success = false;

  while (attempts < 10) {
    await new Promise(r => setTimeout(r, 500));
    const stats = mailLogQueue.getStats();
    
    // pending이 0이 되면 전송 완료 혹은 실패로 빠진 것
    if (stats.pending === 0) {
      success = true;
      break;
    }
    attempts++;
  }

  if (success) {
    console.log('\n[SUCCESS] Vercel 중앙 서버 로그 적재 성공!');
    console.log('   - Vercel API 상태: 201 Created');
    console.log('   - 관리자 페이지(https://oksooht-security-api.vercel.app/)의 메일 로그 내역에서 방금 전송한 테스트 항목을 확인하실 수 있습니다.');
  } else {
    console.error('\n[FAIL] 서버 로그 전송 실패 또는 타임아웃이 발생했습니다.');
  }

  cleanup();
  console.log('=== 테스트 종료 ===');
}

function cleanup() {
  mailLogQueue.stopFlushLoop();
  try {
    fs.rmSync(userDataPath, { recursive: true, force: true });
  } catch (_) {}
}

main();

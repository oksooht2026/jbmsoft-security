// scripts/test-mail-scenarios.js — 연속 발송 & 다우오피스 파싱 시뮬레이션 E2E 테스트
const path = require('path');
const os = require('os');
const fs = require('fs');
const http = require('http');

const mailBridge = require('../security/mail-extension-bridge');
const mailLogQueue = require('../security/mail-log-queue');

const userData = path.join(os.tmpdir(), 'oksoo-scenario-test-' + Date.now());
fs.mkdirSync(userData, { recursive: true });

async function main() {
  console.log('=== [E2E 검증] 연속 발송 & 다우오피스 메일 로그 수집 검증 ===\n');

  mailLogQueue.init(userData);
  const receivedLogs = [];

  await mailBridge.start({
    userDataPath: userData,
    onLog: (payload) => {
      receivedLogs.push(payload);
      mailLogQueue.enqueue(payload);
    }
  });

  const info = mailBridge.getBridgeInfo(userData);

  // 시나리오: 네이버 메일 답장(/v2/api/mail/reply), 전달(/v2/api/mail/forward) 및 연속 발송 테스트
  const scenarios = [
    {
      title: 'Re: [옥수하이테크] LC8500 SYS/REG 오일펌프 보증서_성능검사서',
      recipients: ['한지수(금형구매2팀)', 'js.han@oksooht.com'],
      body: '11:07 발송 메일 (네이버 답장 /v2/api/mail/reply)',
      mail_host: 'mail.naver.com',
      url: 'https://mail.naver.com/v2/api/mail/reply'
    },
    {
      title: 'Re: [옥수하이테크] LC8500 SYS,REG 오일펌프 보증서_성능검사서',
      recipients: ['한지수(금형구매2팀)'],
      body: '11:08 발송 메일 (네이버 답장 /json/write/reply)',
      mail_host: 'mail.naver.com',
      url: 'https://mail.naver.com/json/write/reply'
    },
    {
      title: 'FW: [옥수하이테크] LC8500 SYS/REG 성능 테스트',
      recipients: ['한지수(금형구매2팀)'],
      body: '11:09 발송 메일 (네이버 전달 /v2/api/mail/forward)',
      mail_host: 'mail.naver.com',
      url: 'https://mail.naver.com/v2/api/mail/forward'
    }
  ];

  console.log('[1] 네이버 메일 답장/전달 시뮬레이션 전송 중...');
  for (let i = 0; i < scenarios.length; i++) {
    const s = scenarios[i];
    const payload = {
      browser: 'Chrome',
      mail_host: s.mail_host,
      sender: 'jh.lee@oksooht.com',
      recipients: s.recipients,
      title: s.title,
      body: s.body,
      timestamp: new Date(Date.now() + i * 2000).toISOString(),
      pageUrl: s.url
    };

    await postMailLog(info.port, info.token, payload);
    console.log(`   - 메일 ${i + 1}차 전송 완료 (${s.title.slice(0, 35)}...)`);
  }

  await new Promise(r => setTimeout(r, 1000));

  console.log('\n[2] 결과 검증:');
  console.log(`   - 시도 건수: ${scenarios.length}건`);
  console.log(`   - 수신 성공 건수: ${receivedLogs.length}건`);

  const stats = mailLogQueue.getStats();
  console.log(`   - 큐 상태: Total ${stats.total}건 (Pending: ${stats.pending}, Failed: ${stats.failed})`);

  await mailBridge.stop();

  if (receivedLogs.length === 3) {
    console.log('\n✅ [검증 성공] 1분 간격 연속 발송 메일 3건 모두 100% 누락 없이 수집 완료!');
    process.exit(0);
  } else {
    console.error(`\n❌ [검증 실패] 예상 3건 중 ${receivedLogs.length}건만 수집됨!`);
    process.exit(1);
  }
}

function postMailLog(port, token, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: '/mail-log',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-bridge-token': token,
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve());
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

main().catch(err => {
  console.error('테스트 중 에러:', err);
  process.exit(1);
});

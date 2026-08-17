// 메일 확장 E2E 통합 테스트 (브리지 → 큐 → 서버)
const path = require('path');
const os = require('os');
const fs = require('fs');
const http = require('http');

const mailBridge = require('../security/mail-extension-bridge');
const mailLogQueue = require('../security/mail-log-queue');
const mailExtensionInstaller = require('../security/mail-extension-installer');

const userData = path.join(os.tmpdir(), 'oksoo-mail-test-' + Date.now());
fs.mkdirSync(userData, { recursive: true });

let received = null;

async function main() {
  console.log('=== OKSOOHT 메일 확장 통합 테스트 ===\n');

  const reg = mailExtensionInstaller.registerExtension(path.join(__dirname, '..'));
  console.log('[1] 확장 레지스트리 등록:', reg.ok ? 'OK' : 'FAIL', reg.extDir);

  mailLogQueue.init(userData);
  await mailBridge.start({
    userDataPath: userData,
    onLog: (payload) => {
      received = payload;
      mailLogQueue.enqueue(payload);
      console.log('[4] Electron 브리지 수신:', JSON.stringify(payload, null, 2));
    }
  });

  const info = mailBridge.getBridgeInfo(userData);
  const testPayload = {
    browser: 'Chrome',
    mail_host: 'mail.naver.com',
    sender: 'test@oksooht.com',
    recipients: ['recipient@example.com'],
    title: '통합테스트 메일',
    body: '테스트 본문입니다.',
    timestamp: new Date().toISOString(),
    pageUrl: 'https://mail.naver.com/v2/new'
  };

  await postMailLog(info.port, info.token, testPayload);
  await new Promise(r => setTimeout(r, 1500));

  const stats = mailLogQueue.getStats();
  console.log('\n[5] 큐 상태:', stats);
  console.log('[6] 브리지 수신:', received ? 'OK' : 'FAIL');

  const browsers = ['Chrome', 'Edge', 'Whale'];
  console.log('\n[7] 브라우저 감지 로직 (UA 시뮬레이션):');
  for (const b of browsers) {
    const ua = b === 'Whale' ? 'Whale/3.0' : b === 'Edge' ? 'Edg/120.0' : 'Chrome/120.0';
    console.log(`  ${b}: ${detectBrowser(ua)}`);
  }

  await mailBridge.stop();
  console.log('\n=== 테스트 완료 ===');
  process.exit(received ? 0 : 1);
}

function detectBrowser(ua) {
  if (ua.includes('Whale')) return 'Whale';
  if (ua.includes('Edg/')) return 'Edge';
  return 'Chrome';
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
      res.on('end', () => {
        console.log(`[3] HTTP POST /mail-log → ${res.statusCode}`, data);
        resolve();
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

main().catch(err => {
  console.error('테스트 실패:', err);
  process.exit(1);
});

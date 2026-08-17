// D:\JBMSOFT_Security\scripts\test-mail-proxy-flow.js
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const net = require('net');
const tls = require('tls');
const { execSync } = require('child_process');
const mailProxyServer = require('../security/mail-proxy-server');

const userDataPath = path.join(__dirname, '..', '_tmp_test_userdata');

async function main() {
  console.log('=== SSL 복호화 프록시 통합 테스트 시작 ===');

  if (!fs.existsSync(userDataPath)) {
    fs.mkdirSync(userDataPath, { recursive: true });
  }

  // 1. 프록시 서버 기동
  console.log('1. 프록시 가동 시도...');
  let loggedEvent = null;

  try {
    await mailProxyServer.start({
      userDataPath,
      onLog: (log) => {
        console.log('[Test Log Received]:', log);
        loggedEvent = log;
      }
    });
    console.log('[OK] 프록시 가동 성공');
  } catch (err) {
    console.error('[FAIL] 프록시 가동 실패:', err);
    process.exit(1);
  }

  // 2. Windows System Proxy 설정 조회 검증
  console.log('2. 레지스트리 상태 체크...');
  try {
    const output = execSync('reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyEnable', { encoding: 'utf8', windowsHide: true });
    if (output.includes('0x1')) {
      console.log('[OK] ProxyEnable이 1(활성) 상태로 정상 설정되었습니다.');
    } else {
      console.error('[FAIL] ProxyEnable이 활성화되지 않았습니다. 결과:', output);
      process.exit(1);
    }
  } catch (e) {
    console.error('[FAIL] 레지스트리 조회 실패:', e.message);
    process.exit(1);
  }

  // 3. HTTPS 복호화 통신 시뮬레이션
  console.log('3. 감시 도메인(mail.naver.com) 복호화 CONNECT 및 POST 테스트...');
  const postData = 'to=target%40example.com&subject=TestSubject&body=TestBodyHTML&from=sender%40example.com';

  const socket = net.connect(38472, '127.0.0.1', () => {
    socket.write('CONNECT mail.naver.com:443 HTTP/1.1\r\nHost: mail.naver.com:443\r\n\r\n');
  });

  socket.on('data', (chunk) => {
    const responseStr = chunk.toString('utf8');
    if (responseStr.includes('200 Connection Established')) {
      console.log('CONNECT 터널 개설 완료, TLS 핸드셰이크 진행 중...');
      
      const secureSocket = tls.connect({
        socket: socket,
        servername: 'mail.naver.com',
        rejectUnauthorized: false
      }, () => {
        console.log('TLS 핸드셰이크 성공! 복호화 POST 요청 발송...');
        secureSocket.write(
          `POST /write/send HTTP/1.1\r\n` +
          `Host: mail.naver.com\r\n` +
          `User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Whale/3.24.223.21\r\n` +
          `Content-Type: application/x-www-form-urlencoded\r\n` +
          `Content-Length: ${Buffer.byteLength(postData)}\r\n\r\n` +
          postData
        );
      });

      secureSocket.on('data', (d) => {
        console.log('서버로부터 복호화된 응답 수신:', d.toString('utf8').split('\r\n')[0]);
      });

      secureSocket.on('error', (err) => {
        console.warn('TLS 소켓 경고 (대상 서버 응답 유무 등):', err.message);
      });
    }
  });

  socket.on('error', (e) => {
    console.error('[FAIL] 소켓 통신 에러:', e.message);
  });

  // 로그 수신 대기 (최대 3초)
  await new Promise(r => setTimeout(r, 2000));

  if (loggedEvent) {
    console.log('\n[SUCCESS] 메일 감시 로그가 정상 수집되었습니다!');
    console.log(`- 브라우저: ${loggedEvent.browser}`);
    console.log(`- 수신자: ${loggedEvent.recipients.join(', ')}`);
    console.log(`- 제목: ${loggedEvent.title}`);
    console.log(`- 본문: ${loggedEvent.body}`);
  } else {
    console.error('\n[FAIL] 메일 전송 시뮬레이션 로그가 수집되지 않았습니다.');
    await cleanup();
    process.exit(1);
  }

  await cleanup();
  console.log('=== 테스트 정상 종료 ===');
}

async function cleanup() {
  console.log('4. 프록시 종료 및 리소스 정리...');
  await mailProxyServer.stop();
  try {
    fs.rmSync(userDataPath, { recursive: true, force: true });
  } catch (_) {}
}

main();

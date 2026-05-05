// security/server-sync.js
// JBMSOFT Security - 서버 동기화 모듈
// Electron 앱이 중앙 서버(Vercel + Supabase)와 통신하는 핵심 모듈

const os = require('os');
const https = require('https');
const http = require('http');

const API_BASE = 'https://oksooht-security-api.vercel.app/api';
const API_SECRET = 'oksooht-security-2026';

let currentNickname = '';

function setNickname(name) {
    currentNickname = name;
}

// 현재 PC의 고유 식별 정보 수집
function getPCInfo() {
  const interfaces = os.networkInterfaces();
  let macAddress = '';
  let ipAddress = '';

  for (const ifaces of Object.values(interfaces)) {
    for (const iface of ifaces) {
      if (iface.family === 'IPv4' && !iface.internal) {
        ipAddress = iface.address;
        macAddress = iface.mac;
        break;
      }
    }
    if (macAddress) break;
  }

  return {
    hostname: os.hostname(),
    mac_address: macAddress || 'unknown-' + Math.random().toString(36).substr(2, 9),
    ip_address: ipAddress,
    os_version: `${os.platform()} ${os.release()}`,
    username: currentNickname || os.userInfo().username,
    app_version: '1.0.0'
  };
}

// HTTP 요청 헬퍼 (네이티브 모듈 사용 - 추가 의존성 없음)
function apiRequest(path, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(API_BASE + path);
    const isHttps = url.protocol === 'https:';
    const client = isHttps ? https : http;

    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_SECRET
      },
      timeout: 10000
    };

    const bodyStr = body ? JSON.stringify(body) : null;
    if (bodyStr) {
      options.headers['Content-Length'] = Buffer.byteLength(bodyStr);
    }

    const req = client.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// PC 등록 또는 하트비트 전송
async function registerOrHeartbeat() {
  const pcInfo = getPCInfo();
  try {
    const result = await apiRequest('/register', 'POST', pcInfo);
    if (result.status === 200 || result.status === 201) {
      const pc = result.data;
      console.log(`[ServerSync] PC 등록/하트비트 성공: ${pc.id || 'ok'}`);
      return pc.id || pc.pc?.id || null;
    }
    if (result.status === 403 && result.data && result.data.error === 'LICENSE_LIMIT_EXCEEDED') {
        throw new Error('LICENSE_LIMIT_EXCEEDED');
    }
    console.warn('[ServerSync] 등록 응답:', result.status, result.data);
    return null;
  } catch (err) {
    if (err.message === 'LICENSE_LIMIT_EXCEEDED') throw err;
    console.error('[ServerSync] 서버 연결 실패 (오프라인 모드):', err.message);
    return null;
  }
}

// 보안 로그 전송
async function sendLog(eventType, severity, message, details = {}) {
  const pcInfo = getPCInfo();
  const logEntry = {
    hostname: pcInfo.hostname,
    mac_address: pcInfo.mac_address,
    event_type: eventType,
    severity, // 'info' | 'warning' | 'critical'
    message,
    details
  };

  try {
    const result = await apiRequest('/logs', 'POST', logEntry);
    if (result.status === 201) {
      console.log(`[ServerSync] 로그 전송: [${severity}] ${eventType}`);
      return true;
    }
    return false;
  } catch (err) {
    console.warn('[ServerSync] 로그 전송 실패 (로컬 저장):', err.message);
    return false;
  }
}

// 파일 전송 승인 요청
async function requestApproval(fileName, destination, reason) {
  const pcInfo = getPCInfo();
  const body = {
    hostname: pcInfo.hostname,
    mac_address: pcInfo.mac_address,
    file_name: fileName,
    destination,
    reason
  };

  try {
    const result = await apiRequest('/approvals', 'POST', body);
    if (result.status === 201) {
      console.log(`[ServerSync] 승인 요청 전송: ${fileName}`);
      return result.data;
    }
    return null;
  } catch (err) {
    console.error('[ServerSync] 승인 요청 실패:', err.message);
    return null;
  }
}

// 보안 정책 가져오기
async function fetchPolicy() {
  try {
    const result = await apiRequest('/settings', 'GET');
    if (result.status === 200) {
      console.log('[ServerSync] 보안 정책 수신 완료');
      return result.data;
    }
    return null;
  } catch (err) {
    console.warn('[ServerSync] 정책 수신 실패 (로컬 설정 사용):', err.message);
    return null;
  }
}

module.exports = {
  getPCInfo,
  registerOrHeartbeat,
  sendLog,
  requestApproval,
  fetchPolicy,
  setNickname
};

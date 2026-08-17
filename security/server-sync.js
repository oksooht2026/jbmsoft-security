// security/server-sync.js
// JBMSOFT Security - 서버 동기화 모듈
// Electron 앱이 중앙 서버(Vercel + Supabase)와 통신하는 핵심 모듈

const os = require('os');
const https = require('https');
const http = require('http');

const API_BASE = 'https://oksooht-security-api.vercel.app/api';
const API_SECRET = 'oksooht-security-2026';

let currentNickname = '';
let currentAppVersion = '1.0.0';

function setNickname(name) {
    currentNickname = name;
}

function setAppVersion(version) {
    if (version) currentAppVersion = version;
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
    app_version: currentAppVersion
  };
}

// HTTP 요청 헬퍼 (네이티브 모듈 사용 - 추가 의존성 없음)
function apiRequest(path, method = 'GET', body = null, timeoutMs = 10000) {
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
        'Content-Type': 'application/json; charset=utf-8',
        'x-api-key': API_SECRET
      },
      timeout: timeoutMs
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

// PC 등록 또는 하트비트 전송 (레거시 — syncWithServer 권장)
async function registerOrHeartbeat() {
  const pcInfo = getPCInfo();
  try {
    const result = await apiRequest('/register', 'POST', pcInfo);
    if (result.status === 200 || result.status === 201) {
      const pc = result.data;
      console.log(`[ServerSync] PC 등록/하트비트 성공: ${pc.pc?.id || pc.id || 'ok'}`);
      return pc.pc?.id || pc.id || null;
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

// 통합 동기화 — 하트비트 + 정책(변경 시만) + 승인(필요 시만) + 원격 업데이트 상태 보고
async function syncWithServer({ policyVersion = 0, needsApprovals = false, updateStatus = null } = {}) {
  const pcInfo = getPCInfo();
  try {
    const result = await apiRequest('/sync', 'POST', {
      ...pcInfo,
      policy_version: policyVersion,
      needs_approvals: needsApprovals,
      update_status: updateStatus
    });
    if (result.status === 403 && result.data?.error === 'LICENSE_LIMIT_EXCEEDED') {
      throw new Error('LICENSE_LIMIT_EXCEEDED');
    }
    if (result.status === 200) {
      return result.data;
    }
    console.warn('[ServerSync] sync 응답:', result.status);
    return null;
  } catch (err) {
    if (err.message === 'LICENSE_LIMIT_EXCEEDED') throw err;
    console.warn('[ServerSync] sync 실패 (오프라인):', err.message);
    return null;
  }
}

// 서버 로그 전송 — Vercel 무료 한도 절약 (로컬 UI 로그는 main.js store 유지)
const SERVER_INFO_EVENTS = new Set(['app_start', 'app_stop']);
const MAIL_AUDIT_EVENTS = new Set(['mail_send_audit', 'mail_compose_audit', 'webmail_access_audit']);
// 파일/USB 감시 로그 — 관리자 /file-logs 페이지에서 조회 (info여도 서버 전송)
const FILE_LOG_EVENTS = new Set([
  'file_movement', 'file_event', 'usb_file_event',
  'extension_exec_blocked', 'usb_detected', 'usb_existing_detected'
]);
const logDedupe = new Map();
let lastLogPostAt = 0;
// [메일 감사 로그] isDuplicateMailLog / recentMailLogs 제거 — 메일 로그는 절대 중복 필터링하지 않음

async function sendLog(eventType, severity, message, details = {}) {
  const isMail = MAIL_AUDIT_EVENTS.has(eventType);
  const isFile = FILE_LOG_EVENTS.has(eventType);
  if (severity === 'info' && !SERVER_INFO_EVENTS.has(eventType) && !isMail && !isFile) return false;

  // 메일·파일 감사: 레이트리밋 없이 즉시 전송 (짧은 중복만 완화)
  if (isMail || isFile) {
    if (isFile) {
      const dedupeKey = `${eventType}:${message}`;
      const now = Date.now();
      if (logDedupe.get(dedupeKey) && now - logDedupe.get(dedupeKey) < 5000) return false;
      logDedupe.set(dedupeKey, now);
    }
    return sendLogDirect(eventType, severity, message, details);
  }

  const dedupeKey = `${eventType}:${message}`;
  const now = Date.now();
  if (logDedupe.get(dedupeKey) && now - logDedupe.get(dedupeKey) < 10000) return false;
  logDedupe.set(dedupeKey, now);
  if (now - lastLogPostAt < 3000) return false;

  return sendLogDirect(eventType, severity, message, details);
}

/** 큐 재전송·확장 프로그램용 — dedupe/레이트리밋 없이 직접 POST */
async function sendLogDirect(eventType, severity, message, details = {}) {
  // 메일·파일 감사는 필터 없이 무조건 통과

  const pcInfo = getPCInfo();
  const logEntry = {
    hostname: pcInfo.hostname,
    mac_address: pcInfo.mac_address,
    event_type: eventType,
    severity,
    message,
    details
  };

  try {
    lastLogPostAt = Date.now();
    const result = await apiRequest('/logs', 'POST', logEntry);
    if (result.status === 201) {
      console.log(`[ServerSync] 로그 전송: [${severity}] ${eventType}`);
      return true;
    }
    return false;
  } catch (err) {
    console.warn('[ServerSync] 로그 전송 실패:', err.message);
    return false;
  }
}

// 파일 전송 / USB / 메일 승인 요청
async function requestApproval(fileNameOrPayload, destination, reason) {
  const pcInfo = getPCInfo();
  let body;

  if (typeof fileNameOrPayload === 'object' && fileNameOrPayload !== null) {
    body = {
      hostname: pcInfo.hostname,
      pc_name: fileNameOrPayload.pc_name || pcInfo.hostname,
      mac_address: pcInfo.mac_address,
      request_type: fileNameOrPayload.request_type,
      filename: fileNameOrPayload.filename,
      file_name: fileNameOrPayload.filename,
      recipient: fileNameOrPayload.recipient,
      requester: fileNameOrPayload.requester || pcInfo.username,
      requested_by: fileNameOrPayload.requester || pcInfo.username,
      reason: fileNameOrPayload.reason || ''
    };
  } else {
    body = {
      hostname: pcInfo.hostname,
      pc_name: pcInfo.hostname,
      mac_address: pcInfo.mac_address,
      file_name: fileNameOrPayload,
      filename: fileNameOrPayload,
      recipient: destination,
      requester: pcInfo.username,
      reason: reason || ''
    };
  }

  try {
    const result = await apiRequest('/approvals', 'POST', body);
    if (result.status === 201) {
      console.log(`[ServerSync] 승인 요청 전송: ${body.filename}`);
      return result.data;
    }
    console.warn('[ServerSync] 승인 요청 거부:', result.status, result.data);
    return null;
  } catch (err) {
    console.error('[ServerSync] 승인 요청 실패:', err.message);
    return null;
  }
}

// 승인 요청 목록 조회 (서버 동기화)
async function fetchApprovals(status) {
  try {
    const pcInfo = getPCInfo();
    const query = `?mac_address=${pcInfo.mac_address}${status ? `&status=${status}` : ''}`;
    const result = await apiRequest(`/approvals${query}`, 'GET');
    if (result.status === 200) return result.data;
    return [];
  } catch (err) {
    console.warn('[ServerSync] 승인 목록 조회 실패:', err.message);
    return [];
  }
}

async function resolveApproval(id, approved) {
  try {
    const result = await apiRequest(`/approvals?id=${id}`, 'PUT', { approved });
    return result.status === 200 ? result.data : null;
  } catch (err) {
    console.warn('[ServerSync] 승인 처리 실패:', err.message);
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

async function uploadDocumentPreview(payload) {
  const pcInfo = getPCInfo();
  const body = {
    hostname: pcInfo.hostname,
    mac_address: pcInfo.mac_address,
    document_name: payload.document_name,
    application: payload.application,
    process: payload.process,
    window_title: payload.window_title,
    file_path: payload.file_path,
    file_base64: payload.file_base64 || null,
    file_size: payload.file_size || 0,
    mime_type: payload.mime_type || 'application/octet-stream'
  };

  try {
    const result = await apiRequest('/documents', 'POST', body, 120000);
    if (result.status === 201) {
      console.log(`[ServerSync] 문서 미리보기 등록: ${payload.document_name}`);
      return result.data;
    }
    return null;
  } catch (err) {
    console.warn('[ServerSync] 문서 미리보기 실패:', err.message);
    return null;
  }
}

module.exports = {
  getPCInfo,
  registerOrHeartbeat,
  syncWithServer,
  sendLog,
  sendLogDirect,
  requestApproval,
  fetchApprovals,
  resolveApproval,
  fetchPolicy,
  uploadDocumentPreview,
  setNickname,
  setAppVersion
};

// security/approval-manager.js
// 승인 기반 보안 워크플로 — USB / 메일 / 파일 이동·복사
const fs = require('fs');
const path = require('path');
const serverSync = require('./server-sync');
const os = require('os');

const GRANT_TTL_MS = 30 * 60 * 1000; // 승인 후 30분 허용

// grants: Map<key, expiresAt>
const grants = new Map();
// pending: Map<localId, { type, data, serverId? }>
const pending = new Map();

let onApprovalUpdate = null; // (request) => void — UI 갱신
let onGrantApplied = null;   // (type, data) => void — 가드에 허용 적용

function setCallbacks({ onUpdate, onGrant }) {
  if (onUpdate) onApprovalUpdate = onUpdate;
  if (onGrant) onGrantApplied = onGrant;
}

function grantKey(type, id) {
  return `${type}:${id}`;
}

function grant(type, id, data = {}, ttlMs = GRANT_TTL_MS) {
  const key = grantKey(type, id);
  grants.set(key, Date.now() + ttlMs);
  console.log(`[ApprovalManager] 승인 허용: ${key} (${ttlMs / 60000}분)`);
  if (onGrantApplied) onGrantApplied(type, { id, ...data });
  return true;
}

function isGranted(type, id) {
  const key = grantKey(type, id);
  const exp = grants.get(key);
  if (!exp) return false;
  if (Date.now() > exp) {
    grants.delete(key);
    return false;
  }
  return true;
}

function parseMeta(recipient) {
  try {
    if (recipient && recipient.startsWith('{')) return JSON.parse(recipient);
  } catch (_) {}
  return {};
}

function typeLabel(type) {
  const labels = {
    usb_file_transfer: 'USB 파일 이동',
    usb_connect: 'USB 연결',
    mail_send: '메일 발송',
    file_transfer: '파일 이동/복사'
  };
  return labels[type] || '보안 요청';
}

function typeIcon(type) {
  const icons = {
    usb_file_transfer: '🔌',
    usb_connect: '🔌',
    mail_send: '📧',
    file_transfer: '📄'
  };
  return icons[type] || '📋';
}

// ─── 승인 요청 생성 ───
async function createRequest(type, data) {
  // 1. 메모리 대기 목록에서 중복 체크
  const existingMem = [...pending.values()].find(p => p.type === type && (
    type === 'usb_connect' ? String(p.data.drive).toUpperCase() === String(data.drive).toUpperCase() :
    (type === 'usb_file_transfer' || type === 'file_transfer') ? p.data.filePath === data.filePath : false
  ));
  if (existingMem) {
    console.log(`[ApprovalManager] 이미 대기 중인 승인 요청이 있습니다 (Memory): ${type}`);
    return existingMem.request;
  }

  // 2. 로컬 스토어 대기 목록에서 중복 체크 (앱 재시작 및 레이스 컨디션 방어)
  try {
    const Store = require('electron-store');
    const localStore = new Store({ name: 'jbmsoft-security-config' });
    const requests = localStore.get('approvalRequests', []);
    const existingStore = requests.find(r => r.request_type === type && r.status === 'pending' && (
      type === 'usb_connect' ? parseMeta(r.recipient).drive === data.drive :
      (type === 'usb_file_transfer' || type === 'file_transfer') ? parseMeta(r.recipient).filePath === data.filePath : false
    ));
    if (existingStore) {
      const ageMs = Date.now() - new Date(existingStore.timestamp).getTime();
      const isExpired = ageMs > 30 * 60 * 1000; // 30분 초과 시 만료로 취급
      if (!isExpired && existingStore.serverId) {
        console.log(`[ApprovalManager] 이미 대기 중인 유효한 승인 요청이 있습니다 (Store): ${type}`);
        // 메모리에 로드해두어 추후 완료 처리 가능하도록 복구
        const localId = existingStore.id;
        pending.set(localId, { type, data, request: existingStore, serverId: existingStore.serverId });
        if (onApprovalUpdate) onApprovalUpdate(existingStore);
        return existingStore;
      } else {
        console.log(`[ApprovalManager] 오래되거나 서버 식별자가 없는 대기 요청 제거 후 새로 생성: ${type}`);
        const filtered = requests.filter(r => r.id !== existingStore.id);
        localStore.set('approvalRequests', filtered);
      }
    }
  } catch (e) {
    console.warn('[ApprovalManager] 로컬 스토어 중복 체크 실패:', e.message);
  }


  const localId = Date.now().toString() + Math.random().toString(36).slice(2, 7);
  const username = os.userInfo().username;
  const hostname = os.hostname();

  let filename = '';
  let recipient = '';
  let reason = '';

  switch (type) {
    case 'usb_connect':
      filename = `[USB] ${data.drive}: 드라이브 연결 요청`;
      recipient = JSON.stringify({ type, drive: data.drive, fs: data.fs || '' });
      reason = `USB 저장장치(${data.drive}:) 사용 승인 요청`;
      break;
    case 'mail_send':
      filename = `[MAIL] ${data.email || '외부 수신자'}`;
      recipient = JSON.stringify({ type, email: data.email, subject: data.subject || '', attachment: data.attachment || '' });
      reason = `메일 발송 승인 요청 → ${data.email}`;
      break;
    case 'webmail_access':
      filename = `[MAIL] ${data.provider || '웹메일'} 접속 요청`;
      recipient = JSON.stringify({ type, provider: data.provider, domains: data.domains || [] });
      reason = `웹메일(${data.provider}) 접속 승인 요청`;
      break;
    case 'usb_file_transfer':
      filename = `[USB] ${data.filename || path.basename(data.filePath || '')}`;
      recipient = JSON.stringify({
        type,
        filePath: data.filePath,
        quarantinedTo: data.quarantinedTo,
        ext: data.ext,
        drive: data.drive || '',
        destination: data.destination || 'USB 복사'
      });
      reason = data.reason || `USB 파일 이동 승인 요청 — ${data.filename || path.basename(data.filePath || '')}`;
      break;
    case 'file_transfer':
      filename = `[FILE] ${data.filename || path.basename(data.filePath || '')}`;
      recipient = JSON.stringify({
        type,
        filePath: data.filePath,
        quarantinedTo: data.quarantinedTo,
        ext: data.ext,
        destination: data.destination || ''
      });
      reason = data.reason || `파일 이동/복사 승인 요청 (.${data.ext || '?'})`;
      break;
    default:
      filename = data.filename || '보안 요청';
      recipient = JSON.stringify({ type: 'file_transfer', ...data });
  }

  const request = {
    id: localId,
    request_type: type,
    filename,
    recipient,
    requester: username,
    pc_name: hostname,
    reason,
    data,
    timestamp: new Date().toISOString(),
    status: 'pending'
  };

  pending.set(localId, { type, data, request });

  // 서버 전송
  try {
    const serverResult = await serverSync.requestApproval({
      request_type: type,
      filename,
      recipient,
      requester: username,
      reason,
      pc_name: hostname
    });
    if (serverResult && serverResult.id) {
      pending.get(localId).serverId = serverResult.id;
      request.serverId = serverResult.id;
    }
  } catch (_) {}

  if (onApprovalUpdate) onApprovalUpdate(request);
  console.log(`[ApprovalManager] 승인 요청 생성: ${type} — ${filename}`);
  return request;
}

// ─── 승인/거부 처리 (로컬 또는 서버 동기화) ───
function resolveRequest(id, approved, source = 'local') {
  let entry = pending.get(id);
  if (!entry) {
    for (const [lid, p] of pending.entries()) {
      if (p.serverId === id) { entry = p; id = lid; break; }
    }
  }
  if (!entry) return null;

  const { type, data, request } = entry;
  pending.delete(id);

  if (approved) {
    switch (type) {
      case 'usb_connect':
        grant('usb_connect', data.drive.toUpperCase().replace(':', ''), data);
        break;
      case 'mail_send':
        grant('mail_send', (data.email || '').toLowerCase(), data);
        break;
      case 'webmail_access':
        grant('webmail_access', data.provider || 'webmail', data);
        break;
      case 'usb_file_transfer':
      case 'file_transfer': {
        const grantType = type === 'usb_file_transfer' ? 'usb_file_transfer' : 'file_transfer';
        grant(grantType, data.filePath || data.filename, data);
        if (data.quarantinedTo && data.filePath && fs.existsSync(data.quarantinedTo)) {
          try {
            fs.mkdirSync(path.dirname(data.filePath), { recursive: true });
            fs.renameSync(data.quarantinedTo, data.filePath);
            console.log(`[ApprovalManager] 파일 복원: ${data.filePath}`);
          } catch (e) {
            console.warn('[ApprovalManager] 파일 복원 실패:', e.message);
          }
        }
        break;
      }
    }
  }

  const resolved = {
    ...request,
    id,
    status: approved ? 'approved' : 'rejected',
    resolvedAt: new Date().toISOString(),
    resolvedBy: source
  };
  if (onApprovalUpdate) onApprovalUpdate(resolved);
  return resolved;
}

// ─── 서버 승인 목록 동기화 (관리자 웹에서 승인 시) ───
function processServerApprovals(serverList) {
  if (!Array.isArray(serverList)) return;

  serverList.forEach(srv => {
    if (srv.status === 'pending') return;

    for (const [localId, entry] of pending.entries()) {
      if (entry.serverId !== srv.id) continue;
      if (entry.resolved) continue;

      const approved = srv.status === 'approved';
      entry.resolved = true;
      resolveRequest(localId, approved, 'server');
    }
  });
}

// 서버 목록을 로컬 UI 형식으로 변환
function normalizeServerApproval(srv) {
  const details = srv.details || {};
  const meta = parseMeta(srv.recipient || details.recipient);
  const type = srv.request_type || meta.type || (srv.filename?.startsWith('[USB]') ? 'usb_connect'
    : srv.filename?.startsWith('[MAIL]') ? (meta.type === 'webmail_access' ? 'webmail_access' : 'mail_send') : 'file_transfer');

  return {
    id: srv.id,
    serverId: srv.id,
    request_type: type,
    filename: srv.filename || details.filename || buildFilenameFromType(type, meta, details),
    recipient: srv.recipient || details.recipient || JSON.stringify({ type, ...meta }),
    requester: srv.requester || srv.requested_by || details.requester,
    status: srv.status,
    timestamp: srv.timestamp || srv.created_at,
    resolvedAt: srv.resolved_at || srv.approved_at
  };
}

function buildFilenameFromType(type, meta, details) {
  if (type === 'usb_connect') return `[USB] ${meta.drive || details.drive || ''}`.trim();
  if (type === 'webmail_access') return `[MAIL] ${meta.provider || details.provider || '웹메일'} 접속 요청`;
  if (type === 'mail_send') return `[MAIL] ${meta.email || details.email || '외부 수신자'}`;
  return `[FILE] ${meta.filename || details.filename || '파일 요청'}`;
}

function getPendingCount() {
  return pending.size;
}

/**
 * USB가 물리적으로 분리되었을 때 해당 드라이브의 pending 승인 요청을
 * 메모리(Map)와 로컬 스토어(Store) 양쪽에서 모두 제거합니다.
 * 이렇게 해야 재삽입 시 createRequest()가 중복으로 오판하지 않고
 * 새 승인 요청을 정상적으로 생성합니다.
 */
function clearPendingForDrive(driveLetter) {
  const letter = driveLetter.replace(':', '').toUpperCase();

  // 1. 메모리 pending Map 정리
  for (const [localId, entry] of pending.entries()) {
    if (entry.type === 'usb_connect') {
      const drive = (entry.data?.drive || '').replace(':', '').toUpperCase();
      if (drive === letter) {
        pending.delete(localId);
        console.log(`[ApprovalManager] USB 분리 → pending 정리: usb_connect:${letter} (id=${localId})`);
      }
    }
  }

  // 2. 로컬 스토어 pending 정리
  try {
    const Store = require('electron-store');
    const localStore = new Store({ name: 'jbmsoft-security-config' });
    const requests = localStore.get('approvalRequests', []);
    const filtered = requests.filter(r => {
      if (r.request_type !== 'usb_connect' || r.status !== 'pending') return true;
      const meta = parseMeta(r.recipient);
      const drive = (meta.drive || '').replace(':', '').toUpperCase();
      return drive !== letter;
    });
    if (filtered.length !== requests.length) {
      localStore.set('approvalRequests', filtered);
      console.log(`[ApprovalManager] USB 분리 → 스토어 pending ${requests.length - filtered.length}건 정리: ${letter}:`);
    }
  } catch (e) {
    console.warn('[ApprovalManager] 스토어 pending 정리 실패:', e.message);
  }
}

module.exports = {
  createRequest,
  resolveRequest,
  grant,
  isGranted,
  clearPendingForDrive,
  processServerApprovals,
  normalizeServerApproval,
  parseMeta,
  typeLabel,
  typeIcon,
  getPendingCount,
  setCallbacks,
  GRANT_TTL_MS
};

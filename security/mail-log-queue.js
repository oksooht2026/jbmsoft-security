// security/mail-log-queue.js — 메일 로그 오프라인 큐 (JSON 파일 기반, 재전송)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const serverSync = require('./server-sync');

const MAX_QUEUE = 500;
const MAX_BODY = 8000;
const RETRY_INTERVAL_MS = 30 * 1000;
const MAX_ATTEMPTS = 20;

let queuePath = null;
let flushTimer = null;
let flushing = false;

function init(userDataPath) {
  queuePath = path.join(userDataPath, 'mail-log-queue.json');
  ensureFile();
  startFlushLoop();
  flushQueue().catch(() => {});
}

function ensureFile() {
  if (!queuePath) return;
  const dir = path.dirname(queuePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(queuePath)) {
    fs.writeFileSync(queuePath, JSON.stringify({ items: [] }, null, 0), 'utf8');
  }
}

function readQueue() {
  ensureFile();
  try {
    const raw = fs.readFileSync(queuePath, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.items) ? parsed.items : [];
  } catch (_) {
    return [];
  }
}

function writeQueue(items) {
  ensureFile();
  const trimmed = items.slice(-MAX_QUEUE);
  fs.writeFileSync(queuePath, JSON.stringify({ items: trimmed }), 'utf8');
}

function hashPayload(payload) {
  const key = [
    payload.mail_host || '',
    payload.title || '',
    (payload.recipients || []).join(','),
    payload.timestamp || ''
  ].join('|');
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);
}

function normalizeExtensionPayload(raw) {
  const recipients = Array.isArray(raw.recipients)
    ? raw.recipients.filter(Boolean)
    : raw.recipients ? [String(raw.recipients)] : [];

  const title = String(raw.title || raw.subject || '').trim();
  const body = String(raw.body || raw.bodyPreview || '').slice(0, MAX_BODY);
  const browser = raw.browser || 'Chrome';
  const mailHost = raw.mail_host || raw.mailHost || '';
  const sender = raw.sender || '';
  const timestamp = raw.timestamp || new Date().toISOString();
  const pageUrl = raw.pageUrl || raw.page_url || '';

  let provider = raw.provider || '';
  if (!provider) {
    const hostLower = mailHost.toLowerCase();
    
    // Check custom groupware domains from store
    let store;
    try {
      const Store = require('electron-store');
      store = new Store({ name: 'jbmsoft-security-config' });
    } catch (_) {}
    const netSettings = store ? (store.get('network') || {}) : {};
    const groupwareDomains = (netSettings.groupwareDomains || []).map(d => String(d).trim().toLowerCase());
    
    if (groupwareDomains.some(d => hostLower === d || hostLower.endsWith('.' + d)) ||
        hostLower.includes('daou') || 
        hostLower.includes('daouoffice') || 
        hostLower.includes('groupware')) {
      provider = 'groupware';
    } else if (hostLower.includes('naver') || hostLower.includes('worksmobile')) {
      provider = 'naver';
    } else if (hostLower.includes('google') || hostLower.includes('gmail')) {
      provider = 'gmail';
    } else if (hostLower.includes('daum') || hostLower.includes('kakao')) {
      provider = 'daum';
    } else if (hostLower.includes('outlook') || hostLower.includes('office') || hostLower.includes('hotmail')) {
      provider = 'outlook';
    } else {
      provider = 'webmail';
    }
  }

  const pcInfo = serverSync.getPCInfo();
  const agentId = raw.agent_id || pcInfo.mac_address;
  const source = raw.source || 'network_proxy';

  const message = title
    ? `[메일 발송] ${provider} — ${title}`
    : `[메일 발송] ${provider}${recipients.length ? ' → ' + recipients.slice(0, 2).join(', ') : ''}`;

  return {
    eventType: 'mail_send_audit',
    severity: 'info',
    message,
    details: {
      source,
      agent_id: agentId,
      browser,
      mail_host: mailHost,
      sender,
      recipients,
      subject: title,
      bodyPreview: body,
      pageUrl,
      provider,
      channel: provider,
      timestamp,
      attachments: raw.attachments || []
    },
    _meta: { hash: hashPayload({ mail_host: mailHost, title, recipients, timestamp }) }
  };
}

function enqueue(rawPayload) {
  if (!queuePath) return false;
  const normalized = normalizeExtensionPayload(rawPayload);
  const items = readQueue();
  // [메일 로그] hash 기반 중복 차단 제거 — 모든 메일 발송 요청을 빠짐없이 기록

  items.push({
    id: crypto.randomUUID(),
    hash: normalized._meta.hash,
    status: 'pending',
    attempts: 0,
    enqueued_at: new Date().toISOString(),
    last_attempt_at: null,
    eventType: normalized.eventType,
    severity: normalized.severity,
    message: normalized.message,
    details: normalized.details
  });

  writeQueue(items);
  flushQueue().catch(() => {});
  return true;
}

async function flushQueue() {
  if (flushing || !queuePath) return;
  flushing = true;
  try {
    let items = readQueue();
    let changed = false;

    for (const item of items) {
      if (item.status !== 'pending') continue;
      if (item.attempts >= MAX_ATTEMPTS) {
        item.status = 'failed';
        changed = true;
        continue;
      }

      item.attempts += 1;
      item.last_attempt_at = new Date().toISOString();
      changed = true;

      const ok = await serverSync.sendLogDirect(
        item.eventType,
        item.severity,
        item.message,
        item.details
      );

      if (ok) {
        item.status = 'sent';
        item.sent_at = new Date().toISOString();
      }
    }

    items = items.filter(i => i.status === 'pending' || (i.status === 'sent' && Date.now() - new Date(i.sent_at).getTime() < 86400000));
    if (changed) writeQueue(items);
  } finally {
    flushing = false;
  }
}

function startFlushLoop() {
  if (flushTimer) return;
  flushTimer = setInterval(() => {
    flushQueue().catch(() => {});
  }, RETRY_INTERVAL_MS);
}

function stopFlushLoop() {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
}

function getStats() {
  const items = readQueue();
  return {
    pending: items.filter(i => i.status === 'pending').length,
    failed: items.filter(i => i.status === 'failed').length,
    total: items.length
  };
}

module.exports = {
  init,
  enqueue,
  flushQueue,
  stopFlushLoop,
  getStats,
  normalizeExtensionPayload
};

// security/mail-uia-monitor.js — 발송 신호 → 보낸편지함/완료 화면 급속 스크래핑
const { execFile } = require('child_process');
const path = require('path');
const serverSync = require('./server-sync');

const SCRAPE_PS1 = path.join(__dirname, 'mail-uia-scrape.ps1');
const IDLE_MS = 2000;
const COMPOSE_WATCH_MS = 600;
const BURST_MS = 400;
const BURST_DURATION_MS = 20000;
const NAVER_BURST_MS = 35000;
const SCRAPE_TIMEOUT_MS = 14000;

const SEND_TITLE_RE = /보낸\s*편지|보낸\s*메일|sent\s*mail|#sent|발송\s*함|발송\s*완료|전송\s*완료|메일을\s*보냈|성공적으로\s*보냈|보냈습니다|message\s*sent|mail\s*sent/i;
const SEND_BODY_RE = /메일을\s*성공적으로\s*보냈|성공적으로\s*보냈|message\s*has\s*been\s*sent|mail\s*sent|메일이\s*전송|메시지를\s*보냈|메일을\s*보냈|전송되었습니다/i;
const GMAIL_TOAST_RE = /메일보러가기|메일이\s*전송|메시지를\s*보냈|메일을\s*보냈|message\s*sent|view\s*message|your\s*message\s*has\s*been\s*sent/i;
const GROUPWARE_TOAST_RE = /발송\s*되었|발송\s*하였|전송\s*되었|메일을\s*보냈|메일\s*발송|성공적으로\s*발송|메일\s*전송|보내기\s*완료/i;
const SEND_TOAST_RE = /메일보러가기|메일이\s*전송|메시지를\s*보냈|메일을\s*보냈|message\s*sent|view\s*message|발송\s*되었|발송\s*하였|전송\s*되었|메일\s*발송|보내기\s*완료/i;
const COMPOSE_PROVIDERS = new Set(['gmail', 'groupware']);

const PROVIDER_PATTERNS = [
  { provider: 'groupware', re: /daou|daouoffice|oksooht\.daouoffice/i },
  { provider: 'naver', re: /naver|nmail|네이버/i },
  { provider: 'gmail', re: /gmail|google mail/i },
  { provider: 'daum', re: /daum|hanmail|다음|카카오/i },
  { provider: 'outlook', re: /outlook|office 365/i }
];

let pollTimer = null;
let isRunning = false;
let scrapeInFlight = false;
let onSecurityEvent = null;

let burstUntil = 0;
let burstProvider = null;
let burstBest = null;
let burstSamples = 0;
let composeWatchUntil = 0;

const composeCache = new Map();
const composeState = new Map();
const knownSessions = new Map();

function setEventCallback(cb) { onSecurityEvent = cb; }

function isUrlLike(text) {
  const t = String(text || '').trim();
  if (!t || t.length < 2) return true;
  if (/^(https?|devtools|chrome|edge|about):\/\//i.test(t)) return true;
  if (/mail\.google\.com|mail\.naver|mail\.daum|daouoffice|#inbox|#compose|\/gw\/app\/mail/i.test(t)) return true;
  // .app/.io/.vercel 등 URL처럼 생긴 도메인 필터 추가
  if (/^[\w.-]+\.(com|net|org|co\.kr|io|app|vercel\.app|dev|cloud|site)(\/[^\s]*)?$/i.test(t)) return true;
  if (t.length > 60 && /[#/?=&\\]/.test(t) && !/\s/.test(t)) return true;
  return false;
}

function isGarbageSubject(text) {
  const t = String(text || '').trim();
  if (!t || t.length > 200) return true;
  if (/메일\s*쓰기|네이버\s*메일|^받은|^보낸|Chrome|Gmail|Edge|Whale|정보킹|내정보|네이버톡|알림\d|in:sent|sent\s*mail/i.test(t)) return true;
  return isUrlLike(t);
}

function isGarbageBody(text) {
  const t = String(text || '').trim();
  if (!t) return true;
  if (t.length > 600) return true;
  if (/Toolbar|SmartEditor|DEXT5|비활성화|gecko|Oracle Cloud|MYBOX/i.test(t)) return true;
  return isUrlLike(t);
}

function stripDisclaimer(body) {
  if (!body || typeof body !== 'string') return '';
  const patterns = [
    /이\s*(이)?메일은\s*(지정된\s*)?수신자/i,
    /본\s*메일은\s*(지정된\s*)?수신/i,
    /이\s*메일에\s*포함된/i,
    /수신자만을\s*위한/i,
    /기밀\s*정보가\s*포함/i,
    /transmitted\s*copy\s*is\s*intended/i,
    /this\s*email\s*is\s*intended/i,
    /this\s*message\s*contains\s*confidential/i
  ];
  
  let earliestIndex = -1;
  for (const pattern of patterns) {
    const match = body.match(pattern);
    if (match && match.index !== undefined) {
      if (earliestIndex === -1 || match.index < earliestIndex) {
        earliestIndex = match.index;
      }
    }
  }

  if (earliestIndex !== -1) {
    return body.substring(0, earliestIndex).trim();
  }
  return body.trim();
}

function sanitizeSnapshot(raw) {
  let subject = isGarbageSubject(raw.subject) ? '' : (raw.subject || '').trim();
  let bodyPreview = isGarbageBody(raw.bodyPreview) ? '' : (raw.bodyPreview || '').trim();
  bodyPreview = stripDisclaimer(bodyPreview);
  let recipients = (raw.recipients || []).filter(e => e && !isUrlLike(e));
  const attachments = (raw.attachments || []).filter(a => a && !isUrlLike(a));
  const sentRows = (raw.sentRows || []).filter(r => r && !isUrlLike(r));

  if (raw.naverFirstMail) {
    if (raw.naverFirstMail.recipient) recipients = [raw.naverFirstMail.recipient];
    if (raw.naverFirstMail.subject) subject = raw.naverFirstMail.subject;
  }

  return { ...raw, subject, bodyPreview, recipients, attachments, sentRows };
}

function detectProvider(title, pageUrl = '') {
  const hay = `${title || ''} ${pageUrl || ''}`;
  for (const p of PROVIDER_PATTERNS) {
    if (p.re.test(hay)) return p.provider;
  }
  if (/mail\.naver\.com/i.test(pageUrl || '')) return 'naver';
  if (/mail\.google\.com/i.test(pageUrl || '')) return 'gmail';
  if (/daouoffice\.com/i.test(pageUrl || '')) return 'groupware';
  return 'webmail';
}

function payloadScore(s) {
  let n = 0;
  if (s.recipients && s.recipients.length) n += 3;
  if (s.subject && s.subject.length > 1) n += 4;
  if (s.bodyPreview && s.bodyPreview.length > 15) n += 3;
  if (s.attachments && s.attachments.length) n += 2;
  if (s.sentRows && s.sentRows.length) n += 2;
  if (s.isSentFolder) n += 2;
  if (s.isNaverSentFolder) n += 5;
  if (s.naverFirstMail && s.naverFirstMail.subject) n += 4;
  if (s.isSuccessPage) n += 1;
  if (s.isNaverSendDone) n += 2;
  if (s.isNaverReadMail) n += 6;
  if (s.isGmailSendToast || s.isSendToast) n += 3;
  if (s.isGroupwarePopup) n += 2;
  if (s.hasComposePopup) n += 1;
  return n;
}

function hasMeaningfulPayload(snapshot) {
  if (snapshot.isNaverSendDone) return true;
  if (snapshot.isSendToast || snapshot.isGmailSendToast) return true;
  return payloadScore(snapshot) >= 4;
}

function mergeBest(a, b) {
  if (!a) return sanitizeSnapshot(b);
  if (!b) return sanitizeSnapshot(a);
  const A = sanitizeSnapshot(a);
  const B = sanitizeSnapshot(b);
  return sanitizeSnapshot({
    provider: B.provider || A.provider,
    title: B.title || A.title,
    recipients: (B.recipients && B.recipients.length) ? B.recipients : A.recipients,
    subject: (B.subject && B.subject.length >= (A.subject || '').length) ? B.subject : (A.subject || B.subject),
    bodyPreview: (B.bodyPreview && B.bodyPreview.length >= (A.bodyPreview || '').length) ? B.bodyPreview : (A.bodyPreview || B.bodyPreview),
    attachments: [...new Set([...(A.attachments || []), ...(B.attachments || [])])].slice(0, 30),
    sentRows: (B.sentRows && B.sentRows.length) ? B.sentRows : A.sentRows,
    naverFirstMail: B.naverFirstMail || A.naverFirstMail,
    pageUrl: B.pageUrl || A.pageUrl,
    isNaverSentFolder: B.isNaverSentFolder || A.isNaverSentFolder,
    isNaverSendDone: B.isNaverSendDone || A.isNaverSendDone,
    isNaverReadMail: B.isNaverReadMail || A.isNaverReadMail,
    isSentFolder: B.isSentFolder || A.isSentFolder,
    isSuccessPage: B.isSuccessPage || A.isSuccessPage,
    isGmailSendToast: B.isGmailSendToast || A.isGmailSendToast,
    isSendToast: B.isSendToast || A.isSendToast,
    isGroupwarePopup: B.isGroupwarePopup || A.isGroupwarePopup,
    hasComposePopup: B.hasComposePopup || A.hasComposePopup,
    sendToastTexts: (B.sendToastTexts && B.sendToastTexts.length) ? B.sendToastTexts : A.sendToastTexts,
    gmailToastTexts: (B.gmailToastTexts && B.gmailToastTexts.length) ? B.gmailToastTexts : A.gmailToastTexts
  });
}

function sessionKey(win) {
  return `${win.process || ''}:${win.hwnd || 0}`;
}

function updateComposeCache(win) {
  if (!COMPOSE_PROVIDERS.has(win.provider) || !win.hasComposePopup) return;
  const key = sessionKey(win);
  if (!win.recipients?.length && !win.subject && !(win.bodyPreview?.length > 5)) return;
  composeCache.set(key, {
    recipients: win.recipients || [],
    subject: win.subject || '',
    bodyPreview: win.bodyPreview || '',
    attachments: win.attachments || [],
    at: Date.now()
  });
}

function mergeComposeCache(win) {
  const cached = composeCache.get(sessionKey(win));
  if (!cached || Date.now() - cached.at > 120000) return win;
  return sanitizeSnapshot({
    ...win,
    recipients: (win.recipients && win.recipients.length) ? win.recipients : cached.recipients,
    subject: (win.subject && win.subject.length >= (cached.subject || '').length) ? win.subject : (cached.subject || win.subject),
    bodyPreview: (win.bodyPreview && win.bodyPreview.length >= (cached.bodyPreview || '').length) ? win.bodyPreview : (cached.bodyPreview || win.bodyPreview),
    attachments: [...new Set([...(cached.attachments || []), ...(win.attachments || [])])].slice(0, 30)
  });
}

function checkComposeVanish(win) {
  const key = sessionKey(win);
  const wasComposing = composeState.get(key);
  const nowComposing = Boolean(win.hasComposePopup);
  composeState.set(key, nowComposing);
  if (!COMPOSE_PROVIDERS.has(win.provider) || nowComposing || !wasComposing) return false;
  const cached = composeCache.get(key);
  return Boolean(cached && Date.now() - cached.at < 20000);
}

function isSendSignal(win) {
  // 보낸 편지함(Sent Folder) 열람은 발송 신호가 아님
  if (win.isSentFolder || win.isNaverSentFolder) return false;
  if (/in:sent|보낸\s*편지함|보낸\s*메일함|sent\s*mail/i.test(win.title || '')) return false;
  if (/mail\.google\.com\/mail\/u\/\d+\/#(sent|search\/in%3Asent)/i.test(win.pageUrl || '')) return false;

  if (win.isSendToast || win.isGmailSendToast) return true;
  const toasts = win.sendToastTexts || win.gmailToastTexts || [];
  if (toasts.some(t => SEND_TOAST_RE.test(t))) return true;
  if (win.isNaverSendDone) return true;
  if (/mail\.naver\.com\/v2\/(new|sent)\/done/i.test(win.pageUrl || '')) return true;
  if (win.isSuccessPage) return true;
  
  // 단순히 보낸 편지함 폴더를 열어둔 경우는 발송 신호에서 제외 (중복/더미 감지 방지)
  const SEND_SUCCESS_TITLE_RE = /발송\s*완료|전송\s*완료|메일을\s*보냈|성공적으로\s*보냈|보냈습니다|message\s*sent|mail\s*sent/i;
  if (SEND_SUCCESS_TITLE_RE.test(win.title || '')) return true;
  if (SEND_BODY_RE.test(win.bodyPreview || '')) return true;
  return false;
}

// 메일 발송 감사는 0% 누락이 요구사항 — 제목/첨부가 같더라도(다른 수신자·연속 발송 등) 절대 드롭하지 않음
function emitAuditEvent(type, message, details = {}) {
  serverSync.sendLog(type, 'info', message, details).catch(() => {});
  if (onSecurityEvent) onSecurityEvent({ type: 'info', message, details });
}

function recordMailSend(snapshot, reason) {
  const clean = sanitizeSnapshot(snapshot);
  
  // 수신자 이메일 정보가 수집되지 않은 UIA 로그는 노이즈로 간주하고 차단
  if (!clean.recipients || clean.recipients.length === 0) return;
  if (!hasMeaningfulPayload(clean) && !SEND_BODY_RE.test(clean.bodyPreview || '')) return;

  const provider = clean.provider || burstProvider || 'webmail';
  const subject = (!isGarbageSubject(clean.subject) && clean.subject)
    || (clean.naverFirstMail && clean.naverFirstMail.subject)
    || '(제목 미확인)';
  emitAuditEvent('mail_send_audit', `[메일 발송] ${provider} — ${subject}`, {
    channel: provider,
    provider,
    recipients: clean.recipients || [],
    subject: (!isGarbageSubject(clean.subject) && clean.subject) || (clean.naverFirstMail && clean.naverFirstMail.subject) || '',
    bodyPreview: clean.bodyPreview || '',
    attachments: clean.attachments || [],
    sentRows: clean.sentRows || [],
    naverFirstMail: clean.naverFirstMail || null,
    pageUrl: clean.pageUrl || '',
    source: 'uia_burst',
    detectReason: reason,
    burstSamples,
    windowTitle: clean.title || ''
  });
}

function runScrape(mode) {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRAPE_PS1, '-Mode', mode],
      { windowsHide: true, timeout: SCRAPE_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8' },
      (err, stdout) => {
        if (err || !stdout) {
          resolve({ windows: [], error: err ? (err.message || String(err)) : 'empty output' });
          return;
        }
        try {
          const data = JSON.parse(stdout.trim());
          resolve({ windows: Array.isArray(data.windows) ? data.windows : [], mode: data.mode, at: data.at });
        } catch {
          resolve({ windows: [], error: 'JSON parse failed' });
        }
      }
    );
  });
}

function enrichWindow(raw) {
  const pageUrl = raw.pageUrl || '';
  const provider = detectProvider(raw.title, pageUrl);
  const isNaverSendDone = Boolean(raw.isNaverSendDone) || /mail\.naver\.com\/v2\/(new|sent)\/done/i.test(pageUrl);
  const isNaverSentFolder = Boolean(raw.isNaverSentFolder) || /mail\.naver\.com\/v2\/folders?\/1/i.test(pageUrl) || /보낸\s*메일/.test(raw.title || '');
  const isSendToast = Boolean(raw.isSendToast || raw.isGmailSendToast) ||
    (raw.sendToastTexts || raw.gmailToastTexts || []).some(t => SEND_TOAST_RE.test(t));
  const win = sanitizeSnapshot({
    ...raw,
    provider,
    pageUrl,
    isNaverSendDone,
    isNaverSentFolder,
    isSendToast,
    isGmailSendToast: isSendToast,
    isSuccessPage: Boolean(raw.isSuccessPage) || isNaverSendDone || isSendToast || SEND_BODY_RE.test(raw.bodyPreview || ''),
    isSentFolder: Boolean(raw.isSentFolder) || isNaverSentFolder || Boolean(raw.isGmailSentFolder) || /보낸\s*편지|sent\s*mail|#sent/i.test(raw.title || '')
  });
  return mergeComposeCache(win);
}

function startBurst(win) {
  const duration = (win.provider === 'naver' || win.isNaverSendDone) ? NAVER_BURST_MS : BURST_DURATION_MS;
  burstUntil = Date.now() + duration;
  burstProvider = win.provider || detectProvider(win.title, win.pageUrl);
  burstBest = enrichWindow(win);
  burstSamples = 1;
}

function finalizeBurst() {
  burstUntil = 0;
  if (burstBest) recordMailSend(burstBest, 'sent_folder_burst');
  burstBest = null;
  burstSamples = 0;
}

function processBurstWindows(windows) {
  for (const raw of windows) {
    const win = enrichWindow(raw);
    if (burstProvider === 'naver') {
      if (win.provider !== 'naver') continue;
    } else if (win.provider !== burstProvider && burstProvider !== 'webmail') {
      continue;
    }
    burstBest = mergeBest(burstBest, win);
    burstSamples += 1;
  }
}

function trackComposeWindows(windows) {
  let composing = false;
  let vanishedWin = null;
  const seen = new Set();

  for (const raw of windows) {
    const win = enrichWindow(raw);
    const key = sessionKey(win);
    seen.add(key);
    updateComposeCache(win);
    if (checkComposeVanish(win)) vanishedWin = win;
    if (COMPOSE_PROVIDERS.has(win.provider) && win.hasComposePopup) composing = true;
    knownSessions.set(key, {
      hasCompose: Boolean(win.hasComposePopup),
      isGroupwarePopup: Boolean(win.isGroupwarePopup),
      provider: win.provider,
      at: Date.now()
    });
  }

  for (const [key, prev] of knownSessions) {
    if (seen.has(key)) continue;
    if (!prev.isGroupwarePopup || Date.now() - prev.at > 30000) {
      knownSessions.delete(key);
      continue;
    }
    const cached = composeCache.get(key);
    if (cached) {
      vanishedWin = mergeComposeCache({
        provider: 'groupware',
        process: key.split(':')[0],
        hwnd: Number(key.split(':')[1]) || 0,
        hasComposePopup: false,
        isGroupwarePopup: true,
        recipients: cached.recipients,
        subject: cached.subject,
        bodyPreview: cached.bodyPreview,
        attachments: cached.attachments
      });
    }
    knownSessions.delete(key);
  }

  if (composing) composeWatchUntil = Date.now() + 90000;
  return vanishedWin;
}

function processIdleWindows(windows) {
  const vanishedWin = trackComposeWindows(windows);
  if (vanishedWin) {
    startBurst(vanishedWin);
    return true;
  }
  for (const raw of windows) {
    const win = enrichWindow(raw);
    if (isSendSignal(win)) {
      startBurst(win);
      return true;
    }
  }
  return false;
}

async function tick() {
  if (!isRunning || scrapeInFlight) return;
  scrapeInFlight = true;
  const inBurst = Date.now() < burstUntil;

  try {
    const result = await runScrape(inBurst ? 'Full' : 'Signal');
    const windows = result.windows || [];

    if (inBurst) {
      processBurstWindows(windows);
      trackComposeWindows(windows);
      if (Date.now() >= burstUntil) finalizeBurst();
    } else {
      const triggered = processIdleWindows(windows);
      if (triggered) {
        const full = await runScrape('Full');
        processBurstWindows(full.windows || []);
      }
    }
  } finally {
    scrapeInFlight = false;
  }
}

function scheduleNext() {
  if (!isRunning) return;
  const inBurst = Date.now() < burstUntil;
  const inComposeWatch = Date.now() < composeWatchUntil;
  const delay = inBurst ? BURST_MS : (inComposeWatch ? COMPOSE_WATCH_MS : IDLE_MS);
  pollTimer = setTimeout(async () => {
    await tick();
    scheduleNext();
  }, delay);
}

function start() {
  if (isRunning) return;
  isRunning = true;
  burstUntil = 0;
  burstBest = null;
  tick().then(scheduleNext);
  console.log('[MailUIA] 발송 신호 → 급속 스크래핑 (네이버 URL / Gmail·그룹웨어 팝업·토스트)');
}

function stop() {
  isRunning = false;
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  burstUntil = 0;
  burstBest = null;
  console.log('[MailUIA] UIA 메일 감사 중지');
}

function getStatus() {
  return {
    isRunning,
    mode: Date.now() < burstUntil ? 'burst' : 'idle',
    burstRemainingMs: Math.max(0, burstUntil - Date.now()),
    idleMs: IDLE_MS,
    burstMs: BURST_MS
  };
}

module.exports = {
  start,
  stop,
  setEventCallback,
  getStatus
};

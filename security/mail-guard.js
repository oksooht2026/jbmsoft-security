// security/mail-guard.js
// 메일 수·발신 차단 가드 — 방화벽 + 포트 감시 + 화이트/블랙리스트 + 웹메일 차단
const { exec } = require('child_process');
const dns = require('dns').promises;
const serverSync = require('./server-sync');
const approvalManager = require('./approval-manager');
const mailUiaMonitor = require('./mail-uia-monitor');
const { execAsync, extractEmails, isEmailAllowed, isEmailBlocked, parseMailAuditContext } = require('./security-utils');

const FW_RULE_PREFIX = 'OKSOOHT-MailGuard';
const DEFAULT_MAIL_PORTS = [25, 465, 587, 110, 143, 993, 995];
const DEFAULT_WEBMAIL_DOMAINS = [
  'mail.google.com', 'gmail.com',
  'outlook.live.com', 'outlook.office.com', 'outlook.office365.com',
  'mail.naver.com', 'mail2.naver.com', 'm.mail.naver.com', 'nmail.naver.com',
  'mail.daum.net', 'hanmail.net', 'mail.kakao.com',
  'smtp.naver.com', 'smtp.daum.net', 'smtp.hanmail.net',
  'pop.naver.com', 'pop.daum.net', 'imap.naver.com', 'imap.daum.net',
  'mail.yahoo.com', 'mail.proton.me', 'mail.zoho.com'
];

const DEFAULT_GROUPWARE_DOMAINS = [
  'oksooht.daouoffice.com'
];

let monitorInterval = null;
let clipboardInterval = null;
let isRunning = false;
let onSecurityEvent = null;

let currentPolicy = {
  enabled: false,
  auditOnly: true,
  smtpPorts: DEFAULT_MAIL_PORTS,
  emailWhitelist: [],
  emailBlacklist: [],
  allowedMailServers: [],
  blockWebmail: true,
  groupwareDomains: [...DEFAULT_GROUPWARE_DOMAINS]
};

let knownConnections = new Set();
let lastClipboard = '';
let pendingMailApprovals = new Set();
let webmailMonitorInterval = null;
// 동일 창 제목이 여러 폴링 주기에 걸쳐 그대로 떠 있을 때만 중복 처리를 막는 짧은 TTL 캐시.
// 영구 Set이면 같은 제목 문자열의 실제로 다른 발송 이벤트까지 영구히 누락되므로 TTL로 제한.
let pendingWebmailApprovals = new Map();
const WEBMAIL_TITLE_DEDUPE_MS = 60 * 1000;
let onWebmailBlockNeeded = null;

function setWebmailBlockCallback(cb) {
  onWebmailBlockNeeded = cb;
}

const WEBMAIL_BY_PROVIDER = {
  naver: ['mail.naver.com', 'mail2.naver.com', 'm.mail.naver.com', 'nmail.naver.com', 'smtp.naver.com', 'imap.naver.com'],
  gmail: ['mail.google.com', 'gmail.com', 'accounts.google.com', 'myaccount.google.com', 'googlemail.com'],
  daum: ['mail.daum.net', 'hanmail.net', 'mail.kakao.com', 'smtp.daum.net', 'imap.daum.net'],
  groupware: [...DEFAULT_GROUPWARE_DOMAINS]
};

const WEBMAIL_TITLE_PATTERNS = [
  { provider: 'gmail', re: /gmail|google mail/i, domains: WEBMAIL_BY_PROVIDER.gmail },
  { provider: 'naver', re: /naver\s*mail|네이버\s*메일|nmail/i, domains: WEBMAIL_BY_PROVIDER.naver },
  { provider: 'daum', re: /daum\s*mail|hanmail|다음\s*메일|카카오\s*메일/i, domains: WEBMAIL_BY_PROVIDER.daum },
  { provider: 'groupware', re: /daou\s*office|다우오피스|daouoffice|oksooht\.daouoffice/i, domains: WEBMAIL_BY_PROVIDER.groupware }
];

const COMPOSE_TITLE_RE = /메일\s*쓰기|메일쓰기|새\s*메일|mail\s*compose|compose|작성/i;
const SEND_TITLE_RE = /보낸\s*편지함|발송\s*완료|전송\s*완료|메일을\s*보냈|sent\s*mail|mail\s*sent/i;
const lastComposeByProvider = new Map();
const COMPOSE_CACHE_MS = 15 * 60 * 1000;

function getAllowedMailDomains() {
  return [...new Set([
    ...DEFAULT_WEBMAIL_DOMAINS,
    ...(currentPolicy.groupwareDomains || DEFAULT_GROUPWARE_DOMAINS)
  ])];
}

function getTitlePatterns() {
  const patterns = [...WEBMAIL_TITLE_PATTERNS];
  for (const domain of (currentPolicy.groupwareDomains || [])) {
    const esc = domain.replace(/\./g, '\\.');
    if (patterns.some(p => p.provider === 'groupware' && p.re.test(domain))) continue;
    patterns.push({
      provider: 'groupware',
      re: new RegExp(esc, 'i'),
      domains: currentPolicy.groupwareDomains
    });
  }
  return patterns;
}

function tryRecordMailSend(provider, title) {
  if (!SEND_TITLE_RE.test(title)) return false;
  const { clipboard } = require('electron');
  const clipCtx = parseMailAuditContext(clipboard.readText() || '');
  const cached = lastComposeByProvider.get(provider);
  const ctx = (cached && Date.now() - cached.at < COMPOSE_CACHE_MS) ? cached.ctx : clipCtx;

  emitAuditEvent('mail_send_audit',
    `[메일 발송] ${provider} — ${ctx.subject || title.slice(0, 80)}`,
    {
      channel: provider,
      provider,
      recipients: ctx.emails,
      subject: ctx.subject,
      bodyPreview: ctx.bodyPreview,
      attachments: ctx.attachments,
      title,
      groupware_url: provider === 'groupware' ? (currentPolicy.groupwareDomains[0] || 'oksooht.daouoffice.com') : undefined
    }
  );
  lastComposeByProvider.delete(provider);
  return true;
}

function setEventCallback(cb) {
  onSecurityEvent = cb;
  mailUiaMonitor.setEventCallback(cb);
}

// 메일 발송 감사는 0% 누락이 요구사항 — 제목/이메일이 같더라도(연속 발송 등) 절대 드롭하지 않음
function emitAuditEvent(type, message, details = {}) {
  serverSync.sendLog(type, 'info', message, details).catch(() => {});
  if (onSecurityEvent) {
    onSecurityEvent({ type: 'info', message, details });
  }
}

function emitEvent(type, severity, message, details = {}) {
  serverSync.sendLog(type, severity, message, details).catch(() => {});
  if (onSecurityEvent) {
    onSecurityEvent({ type: severity === 'critical' ? 'blocked' : 'warning', message, details });
  }
}

function updatePolicy(networkConfig, mailGuardEnabled) {
  currentPolicy.enabled = mailGuardEnabled === true;
  if (!networkConfig) return;

  if (Array.isArray(networkConfig.smtpPorts) && networkConfig.smtpPorts.length > 0) {
    currentPolicy.smtpPorts = networkConfig.smtpPorts;
  }
  if (Array.isArray(networkConfig.emailWhitelist)) {
    currentPolicy.emailWhitelist = networkConfig.emailWhitelist;
  }
  if (Array.isArray(networkConfig.emailBlacklist)) {
    currentPolicy.emailBlacklist = networkConfig.emailBlacklist;
  }
  if (Array.isArray(networkConfig.allowedMailServers)) {
    currentPolicy.allowedMailServers = networkConfig.allowedMailServers;
  }
  if (networkConfig.blockWebmail !== undefined) {
    currentPolicy.blockWebmail = networkConfig.blockWebmail;
  }
  if (Array.isArray(networkConfig.groupware_domains) && networkConfig.groupware_domains.length > 0) {
    currentPolicy.groupwareDomains = networkConfig.groupware_domains;
    WEBMAIL_BY_PROVIDER.groupware = [...networkConfig.groupware_domains];
    const gw = WEBMAIL_TITLE_PATTERNS.find(p => p.provider === 'groupware');
    if (gw) gw.domains = currentPolicy.groupwareDomains;
  } else if (Array.isArray(networkConfig.groupwareDomains) && networkConfig.groupwareDomains.length > 0) {
    currentPolicy.groupwareDomains = networkConfig.groupwareDomains;
    WEBMAIL_BY_PROVIDER.groupware = [...networkConfig.groupwareDomains];
  }

  if (isRunning) {
    if (!currentPolicy.enabled) {
      removeFirewallRules().catch(() => {});
    } else {
      applyFirewallRules().catch(() => {});
    }
  }
}

// ─── Windows 방화벽: 메일 포트 아웃바운드 차단 ───
async function applyFirewallRules() {
  await removeFirewallRules();

  if (!currentPolicy.enabled) return;

  const ports = currentPolicy.smtpPorts.join(',');
  const blockCmd = `netsh advfirewall firewall add rule name="${FW_RULE_PREFIX}-Block" dir=out action=block protocol=TCP localport=any remoteport=${ports} enable=yes`;
  await execAsync(blockCmd);

  // 화이트리스트 메일 서버 IP 허용
  const allowedHosts = [
    ...currentPolicy.allowedMailServers,
    ...currentPolicy.emailWhitelist
      .filter(w => !w.startsWith('@') && w.includes('.'))
      .map(w => w.replace(/^@/, ''))
  ];

  for (const host of [...new Set(allowedHosts)]) {
    try {
      const cleanHost = host.replace(/^@/, '').trim();
      if (!cleanHost || cleanHost.startsWith('@')) continue;
      const { address } = await dns.lookup(cleanHost).catch(() => ({ address: null }));
      if (address) {
        await execAsync(
          `netsh advfirewall firewall add rule name="${FW_RULE_PREFIX}-Allow-${cleanHost.replace(/[^a-zA-Z0-9]/g, '')}" dir=out action=allow protocol=TCP remoteip=${address} remoteport=${ports} enable=yes`
        );
      }
    } catch (_) {}
  }

  console.log(`[MailGuard] 방화벽 규칙 적용 — 포트 ${ports} 차단`);
}

async function removeFirewallRules() {
  await execAsync(`netsh advfirewall firewall delete rule name="${FW_RULE_PREFIX}-Block"`);
  const { stdout } = await execAsync('netsh advfirewall firewall show rule name=all');
  const lines = stdout.split('\n');
  for (const line of lines) {
    const m = line.match(/Rule Name:\s+(OKSOOHT-MailGuard-Allow-.+)/i);
    if (m) await execAsync(`netsh advfirewall firewall delete rule name="${m[1].trim()}"`);
  }
}

// ─── 웹메일 차단 도메인 목록 반환 (main.js에서 site-blocker와 병합) ───
function getWebmailBlockDomains() {
  if (!currentPolicy.enabled || !currentPolicy.blockWebmail) return [];

  const whitelistDomains = currentPolicy.emailWhitelist
    .map(w => w.replace(/^@/, '').toLowerCase())
    .filter(Boolean);

  return [...new Set([
    ...currentPolicy.emailBlacklist.map(b => b.replace(/^@/, '').toLowerCase()),
    ...DEFAULT_WEBMAIL_DOMAINS.filter(d => !whitelistDomains.some(wl => d.endsWith(wl) || d === wl))
  ])];
}

// ─── netstat 기반 메일 포트 연결 감시 ───
function startConnectionMonitor() {
  if (monitorInterval) clearInterval(monitorInterval);

  monitorInterval = setInterval(async () => {
    if (!currentPolicy.enabled && !currentPolicy.auditOnly) return;

    const ports = currentPolicy.smtpPorts;
    const { stdout } = await execAsync('netstat -ano');
    if (!stdout.trim()) return;

    stdout.split('\n').forEach(line => {
      if (!line.includes('ESTABLISHED')) return;
      const parts = line.trim().split(/\s+/);
      if (parts.length < 5 || parts[0] !== 'TCP') return;

      const foreign = parts[2] || '';
      const pid = parts[4];
      const portMatch = foreign.match(/:(\d+)$/);
      if (!portMatch) return;
      const port = parseInt(portMatch[1], 10);
      if (!ports.includes(port)) return;

      const connKey = `${foreign}-${pid}`;
      if (knownConnections.has(connKey)) return;
      knownConnections.add(connKey);
      if (knownConnections.size > 2000) knownConnections.clear();

      exec(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, { windowsHide: true }, async (err, procOut) => {
        const procName = err ? 'unknown' : (procOut.match(/"([^"]+)"/)?.[1] || 'unknown');

        const { clipboard } = require('electron');
        const clipText = clipboard.readText() || '';
        const ctx = parseMailAuditContext(clipText);
        const targetEmail = ctx.emails[0] || 'external@unknown';

        if (currentPolicy.auditOnly && !currentPolicy.enabled) {
          // 실제 이메일 주소가 클립보드에 없으면 오탐 방지를 위해 로그 생략
          // (서버 API 통신, vercel.app 등 비메일 연결이 잘못 감지되는 경우 차단)
          if (ctx.emails.length === 0) return;
          emitAuditEvent('mail_send_audit',
            `[메일 발송] ${targetEmail} — ${ctx.subject || '제목 없음'}`,
            {
              email: targetEmail,
              recipients: ctx.emails,
              subject: ctx.subject,
              bodyPreview: ctx.bodyPreview,
              attachments: ctx.attachments,
              pid, port, foreign, process: procName
            }
          );
          return;
        }

        const approvalKey = `${targetEmail}-${pid}`;
        if (!pendingMailApprovals.has(approvalKey)) {
          pendingMailApprovals.add(approvalKey);
        }

        emitEvent('mail_blocked', 'warning',
          `[차단] 메일 발송 차단 — ${targetEmail}`,
          { pid, port, foreign, process: procName, email: targetEmail, ...ctx }
        );

        exec(`taskkill /PID ${pid} /F`, { windowsHide: true }, () => {
          console.log(`[MailGuard] 메일 발송 승인 대기 — 연결 차단: ${procName} PID ${pid}`);
        });
      });
    });
  }, 20000);
}

// ─── 클립보드/Outlook 임시파일에서 이메일 주소 감시 ───
function startEmailContentMonitor() {
  if (clipboardInterval) clearInterval(clipboardInterval);

  const { clipboard } = require('electron');

  clipboardInterval = setInterval(() => {
    if (!currentPolicy.enabled && !currentPolicy.auditOnly) return;

    const text = clipboard.readText();
    if (!text || text === lastClipboard) return;
    lastClipboard = text;

    const emails = extractEmails(text);
    const ctx = parseMailAuditContext(text);

    // UIA가 메일 작성창을 직접 읽음 — 클립보드 작성 감사는 비활성
    if (currentPolicy.auditOnly && !currentPolicy.enabled) return;

    emails.forEach(email => {
      if (currentPolicy.emailBlacklist.length > 0 && isEmailBlocked(email, currentPolicy.emailBlacklist)) {
        clipboard.clear();
        lastClipboard = '';
        emitEvent('mail_address_blocked', 'critical',
          `[메일 차단] 블랙리스트 수신자/발신자 감지 및 클립보드 차단: ${email}`,
          { email, action: 'clipboard_clear' }
        );
        return;
      }

      if (currentPolicy.emailWhitelist.length > 0 && !isEmailAllowed(email, currentPolicy.emailWhitelist)) {
        emitEvent('mail_address_warning', 'warning',
          `[메일 경고] 화이트리스트 외 이메일 주소 감지: ${email}`,
          { email }
        );
      }
    });
  }, 2000);
}

function getWebmailDomainsForEmail(email) {
  if (!email) return [];
  const e = email.toLowerCase();
  if (e.includes('@naver.') || e.includes('@nate.com')) return WEBMAIL_BY_PROVIDER.naver;
  if (e.includes('@gmail.') || e.includes('@googlemail.')) return WEBMAIL_BY_PROVIDER.gmail;
  if (e.includes('@daum.') || e.includes('@hanmail.') || e.includes('@kakao.')) return WEBMAIL_BY_PROVIDER.daum;
  return [];
}

function startWebmailWindowMonitor() {
  if (webmailMonitorInterval) clearInterval(webmailMonitorInterval);

  webmailMonitorInterval = setInterval(() => {
    if (!currentPolicy.enabled && !currentPolicy.auditOnly) return;
    if (currentPolicy.enabled && !currentPolicy.blockWebmail) return;

    exec('powershell -NoProfile -Command "Get-Process | Where-Object { $_.MainWindowTitle -ne \'\' } | Select-Object -ExpandProperty MainWindowTitle"',
      { windowsHide: true, timeout: 6000 },
      async (err, stdout) => {
        if (err || !stdout) return;
        const titles = stdout.split('\n').map(t => t.trim()).filter(Boolean);

        for (const title of titles) {
          for (const pat of getTitlePatterns()) {
            if (!pat.re.test(title)) continue;
            const dedupeKey = `mail:${pat.provider}:${title.slice(0, 80)}`;
            const lastSeenAt = pendingWebmailApprovals.get(dedupeKey);
            if (lastSeenAt && Date.now() - lastSeenAt < WEBMAIL_TITLE_DEDUPE_MS) continue;
            pendingWebmailApprovals.set(dedupeKey, Date.now());
            if (pendingWebmailApprovals.size > 500) pendingWebmailApprovals.clear();

            if (currentPolicy.auditOnly && !currentPolicy.enabled) {
              const { clipboard } = require('electron');
              if (COMPOSE_TITLE_RE.test(title)) {
                lastComposeByProvider.set(pat.provider, {
                  ctx: parseMailAuditContext(clipboard.readText() || ''),
                  at: Date.now()
                });
                break;
              }
              if (tryRecordMailSend(pat.provider, title)) break;
              // 그룹웨어는 접속 로그 생략 (발송 시에만 기록 → 서버 부하 절감)
              if (pat.provider === 'groupware') break;
              const ctx = parseMailAuditContext(title);
              emitAuditEvent('webmail_access_audit',
                `[웹메일] ${pat.provider} — ${title.slice(0, 120)}`,
                { provider: pat.provider, title, subject: ctx.subject || title, attachments: ctx.attachments }
              );
              break;
            }

            if (onWebmailBlockNeeded) onWebmailBlockNeeded(pat.domains);
            emitEvent('webmail_blocked', 'warning',
              `[차단] ${pat.provider} 웹메일 접속 차단`,
              { provider: pat.provider, title }
            );
            break;
          }
        }
      }
    );
  }, 15000);
}

async function start(networkConfig, mailGuardEnabled, auditOnly = true, options = {}) {
  isRunning = true;
  const extensionOnly = options.extensionOnly === true;
  currentPolicy.auditOnly = auditOnly !== false;
  currentPolicy.extensionOnly = extensionOnly;
  updatePolicy(networkConfig, mailGuardEnabled === true);
  await removeFirewallRules().catch(() => {});

  if (!currentPolicy.enabled && !currentPolicy.auditOnly) {
    console.log('[MailGuard] 비활성');
    return;
  }

  if (currentPolicy.enabled) {
    await applyFirewallRules();
    console.log('[MailGuard] 차단 모드 — 방화벽·포트·웹메일 차단');
  } else if (extensionOnly) {
    console.log('[MailGuard] 감사 모드 — Chrome 확장 프로그램 전용 (UIA/netstat/창감시 비활성)');
    return;
  } else {
    console.log('[MailGuard] 감사 모드 — 메일 차단 없음, 발송·접속 기록만 서버 전송');
  }

  startConnectionMonitor();
  startEmailContentMonitor();
  if (currentPolicy.auditOnly && !currentPolicy.enabled) {
    mailUiaMonitor.start();
  } else {
    startWebmailWindowMonitor();
  }
}

async function stop() {
  isRunning = false;
  mailUiaMonitor.stop();
  if (monitorInterval) { clearInterval(monitorInterval); monitorInterval = null; }
  if (clipboardInterval) { clearInterval(clipboardInterval); clipboardInterval = null; }
  if (webmailMonitorInterval) { clearInterval(webmailMonitorInterval); webmailMonitorInterval = null; }
  knownConnections.clear();
  await removeFirewallRules();
  console.log('[MailGuard] 중지 — 방화벽 규칙 제거');
}

function getStatus() {
  return { isRunning, ...currentPolicy, uia: mailUiaMonitor.getStatus() };
}

module.exports = {
  start, stop, updatePolicy, setEventCallback, setWebmailBlockCallback, getStatus,
  applyFirewallRules, removeFirewallRules, getWebmailBlockDomains, getWebmailDomainsForEmail,
  getAllowedMailDomains,
  DEFAULT_WEBMAIL_DOMAINS,
  DEFAULT_GROUPWARE_DOMAINS,
  requestMailSendApproval: () => Promise.resolve(null)
};

// security/mail-proxy-server.js — 로컬 SSL 복호화 프록시 (Selective MITM Proxy)
const http = require('http');
const https = require('https');
const net = require('net');
const tls = require('tls');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');
const forge = require('node-forge');
let serverSync = null;
try { serverSync = require('./server-sync'); } catch (_) {}
function _debugLog(entry) {
  if (serverSync && typeof serverSync.sendMailDebugLog === 'function') {
    serverSync.sendMailDebugLog(entry).catch(() => {});
  }
}

const PROXY_PORT = 38472;
let proxyServer = null;
let localTlsServer = null;
let localTlsPort = 0;
let onMailLog = null;
let proxyRefreshTimer = null;
let debugLogPath = null;

// === 프록시 디버그 로그 (파일 기록) ===
function proxyDebugLog(tag, msg, extra = '') {
  const line = `[${new Date().toISOString()}] [${tag}] ${msg}${extra ? ' | ' + extra : ''}\n`;
  console.log('[MailProxy]', tag, msg, extra || '');
  if (debugLogPath) {
    try { fs.appendFileSync(debugLogPath, line, 'utf8'); } catch (_) {}
  }
}

// 공통 Host Key Pair (성능 최적화: 99%의 CPU 절약)
let hostKeyPair = null;
let caCert = null;
let caKey = null;

const INTERCEPT_DOMAINS = [
  'mail.naver.com',
  'mail.google.com',
  'mail.daum.net',
  'mail.kakao.com',
  'outlook.live.com',
  'outlook.office.com',
  'outlook.office365.com',
  'daouoffice.com'
];

function getInterceptDomains() {
  let store;
  try {
    const Store = require('electron-store');
    store = new Store({ name: 'jbmsoft-security-config' });
  } catch (_) {
    // electron-store가 로드되지 않는 독립 테스트 환경 처리
  }
  
  const netSettings = store ? (store.get('network') || {}) : {};
  const groupware = netSettings.groupwareDomains || [];
  const customDomains = groupware.map(d => String(d).trim().toLowerCase()).filter(Boolean);
  return [...INTERCEPT_DOMAINS, ...customDomains];
}

function shouldIntercept(host) {
  if (!host) return false;
  const cleanHost = host.split(':')[0].toLowerCase();
  const domains = getInterceptDomains();
  return domains.some(d => cleanHost === d || cleanHost.endsWith('.' + d));
}

// === Root CA 생성 및 등록 ===
function initCA(userDataPath) {
  const caDir = path.join(userDataPath, 'ca');
  if (!fs.existsSync(caDir)) fs.mkdirSync(caDir, { recursive: true });

  const certPath = path.join(caDir, 'ca.crt');
  const keyPath = path.join(caDir, 'ca.key');

  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    const certPem = fs.readFileSync(certPath, 'utf8');
    const keyPem = fs.readFileSync(keyPath, 'utf8');
    caCert = forge.pki.certificateFromPem(certPem);
    caKey = forge.pki.privateKeyFromPem(keyPem);
    console.log('[MailProxy] 기존 Root CA 인증서 로드 성공');
  } else {
    console.log('[MailProxy] 신규 Root CA 인증서 생성 중...');
    const keys = forge.pki.rsa.generateKeyPair(1024);
    const cert = forge.pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = '01' + forge.util.bytesToHex(forge.random.getBytesSync(8));
    cert.validity.notBefore = new Date();
    cert.validity.notBefore.setDate(cert.validity.notBefore.getDate() - 1); // 어제 날짜로 설정 (클럭 불일치 방지)
    cert.validity.notAfter = new Date();
    cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 10); // 10년

    const attrs = [
      { name: 'commonName', value: 'OKSOOHT Security Local CA' },
      { name: 'organizationName', value: 'OKSOOHT' },
      { name: 'organizationalUnitName', value: 'Security Agent' }
    ];
    cert.setSubject(attrs);
    cert.setIssuer(attrs);
    cert.setExtensions([
      { name: 'basicConstraints', cA: true, pathLenConstraint: 0 },
      { name: 'keyUsage', keyCertSign: true, digitalSignature: true, nonRepudiation: true }
    ]);

    cert.sign(keys.privateKey, forge.md.sha256.create());

    const certPem = forge.pki.certificateToPem(cert);
    const keyPem = forge.pki.privateKeyToPem(keys.privateKey);

    fs.writeFileSync(certPath, certPem, 'utf8');
    fs.writeFileSync(keyPath, keyPem, 'utf8');

    caCert = cert;
    caKey = keys.privateKey;
    console.log('[MailProxy] 신규 Root CA 인증서 생성 완료');
  }

  // Windows 신뢰할 수 있는 루트 저장소 등록 (로컬 컴퓨터 우선 -> 일반 권한 실행 시 현재 사용자 예외 대응)
  try {
    execSync(`certutil -f -addstore root "${certPath}"`, { stdio: 'ignore', windowsHide: true });
    console.log('[MailProxy] Windows Root Certificate Store(Local Machine) 등록 완료 (팝업 없음)');
  } catch (err) {
    console.warn('[MailProxy] Windows Root Certificate Store(Local Machine) 실패, User 저장소 시도:', err.message);
    try {
      execSync(`certutil -addstore -user root "${certPath}"`, { stdio: 'ignore', windowsHide: true });
      console.log('[MailProxy] Windows Root Certificate Store(Current User) 등록 완료');
    } catch (err2) {
      console.error('[MailProxy] Windows Root Certificate Store 최종 등록 실패:', err2.message);
    }
  }

  // 공통 호스트 키 페어 사전 생성 (인쇄 최적화)
  console.log('[MailProxy] 공통 호스트 Key Pair 생성 중...');
  hostKeyPair = forge.pki.rsa.generateKeyPair(1024);
  console.log('[MailProxy] 공통 호스트 Key Pair 생성 완료');
}

// === 임시 도메인 인증서 동적 서명 ===
const certCache = new Map();
const MAX_CERT_CACHE_SIZE = 200;

function getOrCreateHostCert(servername) {
  if (certCache.has(servername)) {
    return certCache.get(servername);
  }

  const pki = forge.pki;
  const cert = pki.createCertificate();
  cert.publicKey = hostKeyPair.publicKey;
  cert.serialNumber = forge.util.bytesToHex(forge.random.getBytesSync(8));
  cert.validity.notBefore = new Date();
  cert.validity.notBefore.setDate(cert.validity.notBefore.getDate() - 1);
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 2); // 2년

  cert.setSubject([{ name: 'commonName', value: servername }]);
  cert.setIssuer(caCert.subject.attributes);
  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
    { name: 'extKeyUsage', serverAuth: true, clientAuth: true },
    { name: 'subjectAltName', altNames: [{ type: 2, value: servername }] }
  ]);

  cert.sign(caKey, forge.md.sha256.create());

  const credentials = {
    key: pki.privateKeyToPem(hostKeyPair.privateKey),
    cert: pki.certificateToPem(cert)
  };

  if (certCache.size >= MAX_CERT_CACHE_SIZE) {
    const oldestKey = certCache.keys().next().value;
    if (oldestKey) certCache.delete(oldestKey);
  }

  certCache.set(servername, credentials);
  return credentials;
}

// === 메일 POST body 파싱 및 RFC 2047 / MIME 처리 유틸리티 ===
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

const RECIPIENT_KEYS = [
  'to', 'cc', 'bcc', 'recipient', 'recipients', 'receiver', 'receivers',
  'toList', 'to_list', 'toAddress', 'to_address', 'toAddr', 'rcpt', 'rcptTo',
  'mailTo', 'mail_to', 'target', 'targets', 'receiverList', 'receiver_list',
  '수신', '받는사람', '받는 사람', '참조', 'toUser', 'toUsers'
];
const SUBJECT_KEYS = ['subject', 'title', 'mailSubject', 'mail_subject', 'subj', 'topic', '제목', 'mailTitle'];
const BODY_KEYS = ['body', 'content', 'message', 'text', 'html', 'htmlBody', 'contents', '본문', 'editorContent'];
const SENDER_KEYS = ['from', 'sender', 'fromAddress', 'from_address', '보낸사람'];

function decodeRFC2047(str) {
  if (typeof str !== 'string') return str;
  const pattern = /=\?([^?]+)\?([BQbq])\?([^?]+)\?=/g;
  return str.replace(pattern, (match, charset, encoding, text) => {
    try {
      const enc = encoding.toUpperCase();
      let buf;
      if (enc === 'B') {
        buf = Buffer.from(text, 'base64');
      } else if (enc === 'Q') {
        const qpText = text.replace(/_/g, ' ');
        buf = Buffer.from(
          qpText.replace(/=([0-9A-F]{2})/gi, (m, hex) => String.fromCharCode(parseInt(hex, 16))),
          'binary'
        );
      } else {
        return match;
      }
      const cs = charset.toLowerCase();
      if (cs === 'utf-8' || cs === 'utf8') {
        return buf.toString('utf8');
      } else if (cs === 'euc-kr' || cs === 'euckr') {
        try {
          return new TextDecoder('euc-kr').decode(buf);
        } catch (_) {
          return buf.toString('utf8');
        }
      } else {
        return buf.toString('utf8');
      }
    } catch (e) {
      return match;
    }
  });
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

function parseMimeMessage(text) {
  const found = { recipients: [], subject: '', body: '', sender: '', attachments: [] };
  const lines = text.split(/\r?\n/);
  let inHeaders = true;
  const headerLines = [];
  const bodyLines = [];
  for (const line of lines) {
    if (inHeaders) {
      if (line.trim() === '') {
        inHeaders = false;
      } else {
        headerLines.push(line);
      }
    } else {
      bodyLines.push(line);
    }
  }
  const headers = {};
  let currentKey = null;
  for (const line of headerLines) {
    if (/^\s/.test(line) && currentKey) {
      headers[currentKey] += ' ' + line.trim();
    } else {
      const colonIdx = line.indexOf(':');
      if (colonIdx !== -1) {
        currentKey = line.substring(0, colonIdx).trim().toLowerCase();
        headers[currentKey] = line.substring(colonIdx + 1).trim();
      }
    }
  }
  if (headers['to']) found.recipients.push(...extractEmails(headers['to']));
  if (headers['cc']) found.recipients.push(...extractEmails(headers['cc']));
  if (headers['bcc']) found.recipients.push(...extractEmails(headers['bcc']));
  if (headers['subject']) found.subject = decodeRFC2047(headers['subject']);
  if (headers['from']) found.sender = firstString(extractEmails(headers['from'])[0] || '');
  
  const rawBody = bodyLines.join('\n').trim();
  found.body = stripHtml(rawBody.replace(/^[a-zA-Z0-9+/=]{40,}$/gm, ''));
  return found;
}

function stripHtml(html) {
  if (!html || typeof html !== 'string') return '';
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<\/p>|<\/div>|<br\s*\/?>|<\/tr>|<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function extractEmails(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val.flatMap(extractEmails);
  const s = typeof val === 'object' ? JSON.stringify(val) : String(val);
  return [...new Set(s.match(EMAIL_RE) || [])];
}

function firstString(val) {
  if (val == null) return '';
  if (typeof val === 'string') return val.trim();
  if (typeof val === 'number') return String(val);
  if (Array.isArray(val)) {
    for (const item of val) {
      const s = firstString(item);
      if (s) return s;
    }
    return '';
  }
  if (typeof val === 'object') {
    for (const k of ['email', 'address', 'addr', 'value', 'name']) {
      if (val[k]) return firstString(val[k]);
    }
  }
  return String(val).trim();
}

function walkObject(obj, depth, found) {
  if (!obj || depth > 10) return;

  if (typeof obj === 'string') {
    const trimmed = obj.trim();
    // 1. 만약 문자열 내부가 JSON 형태라면 재귀 파싱 시도
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        const parsed = JSON.parse(trimmed);
        walkObject(parsed, depth + 1, found);
        return;
      } catch (_) {}
    }
    
    // 2. 이메일 감지 (Gmail의 키가 없는 수신자 목록 대응)
    const emailTestRe = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
    if (emailTestRe.test(trimmed)) {
      const emails = extractEmails(trimmed);
      for (const email of emails) {
        if (!found.recipients.includes(email)) {
          found.recipients.push(email);
        }
      }
    }
    // 3. 본문 감지 (HTML 태그가 있거나 150자 이상인 경우)
    else if (trimmed.length > 150 && (trimmed.includes(' ') || trimmed.includes('<'))) {
      const cleanBody = stripHtml(trimmed);
      if (cleanBody.length > (found.body || '').length) {
        found.body = cleanBody;
      }
    }
    // 4. 제목 감지 (3자 이상 150자 미만이며 공백 포함, 특수 기호 최소화된 경우)
    else if (trimmed.length > 3 && trimmed.length < 150 && trimmed.includes(' ') && !trimmed.includes('/') && !trimmed.includes('\\') && !trimmed.includes('=')) {
      const cleanSubj = stripHtml(trimmed);
      if (!found.subject || cleanSubj.length > found.subject.length) {
        found.subject = cleanSubj;
      }
    }
    return;
  }

  if (typeof obj !== 'object') return;

  if (Array.isArray(obj)) {
    obj.forEach(v => walkObject(v, depth + 1, found));
    return;
  }

  for (const [key, val] of Object.entries(obj)) {
    const lk = key.toLowerCase();
    
    // 중첩된 JSON 문자열 감지 및 재귀 파싱
    if (typeof val === 'string') {
      const trimmed = val.trim();
      if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
        try {
          const parsed = JSON.parse(trimmed);
          walkObject(parsed, depth + 1, found);
          continue;
        } catch (_) {}
      }
    }

    // Gmail base64url-encoded MIME 메일 처리
    if (lk === 'raw' && typeof val === 'string') {
      try {
        let base64 = val.replace(/-/g, '+').replace(/_/g, '/');
        while (base64.length % 4) base64 += '=';
        const decoded = Buffer.from(base64, 'base64').toString('utf8');
        if (decoded.includes('To:') || decoded.includes('Subject:')) {
          const mimeFound = parseMimeMessage(decoded);
          found.recipients.push(...mimeFound.recipients);
          if (mimeFound.subject) found.subject = mimeFound.subject;
          if (mimeFound.body) found.body = mimeFound.body;
          if (mimeFound.sender) found.sender = mimeFound.sender;
        }
      } catch (_) {}
    }

    if (RECIPIENT_KEYS.some(k => lk.includes(k.toLowerCase()))) {
      const extracted = extractEmails(val).concat(extractEmails(firstString(val)));
      if (extracted.length > 0) {
        found.recipients.push(...extracted);
      } else {
        const fsVal = firstString(val);
        if (fsVal && fsVal.length > 1 && !fsVal.includes('{') && !fsVal.includes('<') && !fsVal.includes('/')) {
          found.recipients.push(fsVal.trim());
        }
      }
    }
    if (SUBJECT_KEYS.some(k => lk.includes(k.toLowerCase()))) {
      if (!found.subject) found.subject = firstString(val);
    }
    if (BODY_KEYS.some(k => lk.includes(k.toLowerCase()))) {
      const isExcluded = ['sign', 'sig', 'footer', 'tail', 'template', 'disclaimer', 'header', 'style', 'css', 'banner', 'attach'].some(ex => lk.includes(ex));
      if (!isExcluded) {
        const body = firstString(val);
        if (body.length > (found.body || '').length) found.body = body;
      }
    }
    if (SENDER_KEYS.some(k => lk.includes(k.toLowerCase()))) {
      if (!found.sender) found.sender = firstString(val);
    }
    if (ATTACHMENT_KEYS.some(k => lk.includes(k))) {
      extractAttachmentsFromVal(val, found);
    }
    walkObject(val, depth + 1, found);
  }
}

const ATTACHMENT_KEYS = ['file', 'attach', 'upload', 'filename', '첨부'];

function extractAttachmentsFromVal(val, found) {
  if (!val) return;
  if (typeof val === 'string') {
    val = decodeRFC2047(val.trim());
    if ((val.startsWith('[') && val.endsWith(']')) || (val.startsWith('{') && val.endsWith('}'))) {
      try {
        const parsed = JSON.parse(val);
        extractAttachmentsFromVal(parsed, found);
        return;
      } catch (_) {}
    }
    if (val.length > 3 && val.length < 255 && /\.[a-zA-Z0-9]{2,5}$/.test(val)) {
      const isDomain = /\.(com|net|org|co\.kr|io|gov|gov\.kr|kr|ne\.kr)$/i.test(val) || val.includes('mail.') || val.includes('google') || val.includes('naver');
      if (!isDomain && !val.includes('@') && !val.includes('/') && !val.includes('\\') && !val.includes('&') && !val.includes('=')) {
        if (!found.attachments.some(att => att.filename === val)) {
          found.attachments.push({ filename: val, size: 0 });
        }
      }
    }
  } else if (Array.isArray(val)) {
    val.forEach(item => extractAttachmentsFromVal(item, found));
  } else if (typeof val === 'object') {
    // 대소문자 구분 없이 첨부파일 이름과 크기 필드 검색
    const nameKeys = ['filename', 'name', 'realname', 'originname', 'title'];
    const sizeKeys = ['size', 'length', 'filesize', 'file_size'];
    
    let name = '';
    let size = 0;
    
    for (const [k, v] of Object.entries(val)) {
      const lk = k.toLowerCase();
      if (nameKeys.some(nk => lk.includes(nk)) && typeof v === 'string') {
        name = v;
      }
      if (sizeKeys.some(sk => lk.includes(sk)) && (typeof v === 'number' || typeof v === 'string')) {
        size = Number(v) || 0;
      }
    }
    
    if (name) {
      name = decodeRFC2047(name);
      if (name.includes('.')) {
        const cleanName = name.trim();
        if (!found.attachments.some(att => att.filename === cleanName)) {
          found.attachments.push({ filename: cleanName, size });
        }
      }
    } else {
      for (const v of Object.values(val)) {
        extractAttachmentsFromVal(v, found);
      }
    }
  }
}

function parseMultipartFormData(text, contentType = '') {
  const found = { recipients: [], subject: '', body: '', sender: '', attachments: [] };
  if (!text) return found;

  // Content-Type 헤더가 주어지면 boundary 값을 정밀 추출하고, 없으면 본문에서 자동 매칭
  let boundary = '';
  if (contentType.includes('boundary=')) {
    const match = contentType.match(/boundary=([^;\s]+)/i);
    if (match) {
      boundary = '--' + match[1];
    }
  }
  if (!boundary) {
    const boundaryMatch = text.match(/--[^\r\n]+/);
    if (!boundaryMatch) return found;
    boundary = boundaryMatch[0];
  }
  
  const parts = text.split(boundary);
  for (const part of parts) {
    if (!part || part.trim() === '--' || !part.includes('Content-Disposition:')) continue;
    
    const headerEndIdx = part.indexOf('\r\n\r\n');
    if (headerEndIdx === -1) continue;
    const headers = part.substring(0, headerEndIdx);
    const body = part.substring(headerEndIdx + 4).trim();
    
    const nameMatch = headers.match(/name="([^"]+)"/i);
    if (!nameMatch) continue;
    const name = nameMatch[1];
    
    // RFC 2047 디코딩 지원 및 대소문자 무관 검색
    const filenameMatch = headers.match(/filename="?([^";\r\n]+)"?/i);
    // RFC 2231 (filename*=UTF-8'') 디코딩 지원
    const rfc2231Match = headers.match(/filename\*=([^\s;]+)/i);
    
    let filename = '';
    if (filenameMatch) {
      filename = decodeRFC2047(filenameMatch[1].trim());
    } else if (rfc2231Match) {
      const parts = rfc2231Match[1].split("'");
      const encodedText = parts[parts.length - 1];
      try {
        filename = decodeURIComponent(encodedText);
      } catch (_) {}
    }

    if (filename && filename.includes('.')) {
      if (!found.attachments.some(att => att.filename === filename)) {
        found.attachments.push({ filename, size: Buffer.byteLength(body) });
      }
    } else {
      walkObject({ [name]: body }, 0, found);
    }
  }
  return found;
}

const uploadCache = [];

function addToUploadCache(filename, size) {
  const now = Date.now();
  const tenMinsAgo = now - 600000;
  while (uploadCache.length > 0 && uploadCache[0].timestamp < tenMinsAgo) {
    uploadCache.shift();
  }
  uploadCache.push({ filename, size, timestamp: now });
}

function getRecentUploads(count) {
  const now = Date.now();
  const tenMinsAgo = now - 600000;
  const valid = uploadCache.filter(item => item.timestamp >= tenMinsAgo);
  return valid.slice(-count);
}

const SEND_URL_RE = /\/(send|compose|mail\/send|mail\/write|smtp|delivery|dispatch|submit|api\/mail)/i;

function isMailSendUrl(url, host = '') {
  const h = host.split(':')[0].toLowerCase();
  const u = url.toLowerCase();

  // 1. Must be a target mail host
  const domains = getInterceptDomains();
  const isTargetHost = domains.some(d => h === d || h.endsWith('.' + d)) ||
                       h.includes('mail') || 
                       h.includes('office') || 
                       h.includes('daou') || 
                       h.includes('gmail') || 
                       h.includes('googlemail') || 
                       h.includes('hanmail') || 
                       h.includes('outlook');

  if (!isTargetHost) return false;

  // 2. Exclude static resources, downloads, telemetry, errors, portal/graphql
  if (u.includes('attachment') || 
      u.includes('upload') || 
      u.includes('tempfile') || 
      u.includes('/files') || 
      u.includes('file/add') || 
      u.includes('file/download') ||
      u.includes('/download') ||
      u.includes('static') ||
      u.includes('jserror') ||
      u.includes('telemetry') ||
      u.includes('error') ||
      u.includes('graphql') ||
      u.includes('portal') ||
      /\.(css|js|png|jpg|gif|svg|ico|woff|woff2)$/.test(u)) {
    return false;
  }

  // 3. Naver/DaouOffice: URL 경로 OR 쿼리파라미터에 발송 키워드 포함 여부 확인
  // 예: /ajax/saveMail?action=send (URL path에 /send 없음, query string에 send)
  if (h.includes('naver.com') || h.includes('daouoffice') || h.includes('daou')) {
    // action=이 있는 경우, 반드시 send/write/submit 계열만 허용
    // action=saveTmp(임시저장), action=delete, action=list 등은 명시적으로 차단
    const actionMatch = u.match(/action=([^&]+)/);
    if (actionMatch) {
      const action = actionMatch[1];
      const allowedActions = ['send', 'write', 'submit', 'sendmail', 'writemail'];
      const isAllowed = allowedActions.some(a => action.startsWith(a));
      if (!isAllowed) return false;
    } else {
      const hasPathSend = u.includes('/send') || u.includes('/write') || u.includes('/submit');
      const hasQuerySend = u.includes('cmd=send') ||
                           u.includes('savemail') || u.includes('sendmail') ||
                           u.includes('writemail');
      if (!hasPathSend && !hasQuerySend) return false;
    }
  }

  return SEND_URL_RE.test(url) ||
    u.includes('savemail') || u.includes('sendmail') || u.includes('action=send') ||
    domains.some(d => h === d || h.endsWith('.' + d));
}


const EMAIL_TEST_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;

function parseFormDataText(text, contentType = '') {
  let found = { recipients: [], subject: '', body: '', sender: '', attachments: [] };
  if (!text) return found;

  const trimmed = text.trim();

  // 1. MIME Message (RFC 822) Parser (Gmail raw MIME send 등 대응)
  if (trimmed.includes('To:') || trimmed.includes('Subject:') || trimmed.includes('MIME-Version:')) {
    const mimeFound = parseMimeMessage(trimmed);
    if (mimeFound.recipients.length > 0 || mimeFound.subject || mimeFound.body) {
      return mimeFound;
    }
  }

  // 2. Multipart/form-data
  if (trimmed.startsWith('--')) {
    try {
      return parseMultipartFormData(trimmed, contentType);
    } catch (_) {}
  }

  // 3. JSON first
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const json = JSON.parse(trimmed);
      walkObject(json, 0, found);
      
      found.recipients = [...new Set(found.recipients.filter(Boolean))];
      if (found.body && found.body.includes('<')) found.body = stripHtml(found.body);
      return found;
    } catch (_) {}
  }

  // 4. Gmail GWT-RPC or vertical-bar format
  if (trimmed.includes('|') && trimmed.length > 20) {
    const parts = trimmed.split('|');
    const emails = [];
    let subject = '';
    let body = '';
    
    for (const part of parts) {
      const p = part.trim();
      if (!p) continue;
      
      if (EMAIL_TEST_RE.test(p)) {
        emails.push(p);
      } else if (p.includes('<p') || p.includes('<div') || (p.length > 50 && p.includes(' '))) {
        if (p.length > body.length) {
          body = p;
        }
      } else if (p.length > 3 && p.length < 150 && !p.startsWith('http') && !p.includes('/') && !p.includes('\\') && !p.includes('=')) {
        if (!subject || p.length > subject.length) {
          subject = p;
        }
      }
    }
    
    if (emails.length > 0 || subject || body) {
      found.recipients = [...new Set(emails)];
      found.subject = subject;
      found.body = body;
      return found;
    }
  }

  // 5. Fallback to URLSearchParams only if it's not JSON
  const params = new URLSearchParams(trimmed);
  for (const [key, val] of params.entries()) {
    if (key === trimmed) continue;
    walkObject({ [key]: val }, 0, found);
  }

  // 6. 최종 수신자 구출 (본문 전체에서 이메일 매칭 검색)
  if (!found.recipients || found.recipients.length === 0) {
    const allEmails = trimmed.match(EMAIL_RE) || [];
    found.recipients = [...new Set(allEmails)];
  }

  found.recipients = [...new Set(found.recipients.filter(Boolean))];
  if (found.body && found.body.includes('<')) found.body = stripHtml(found.body);
  return found;
}

function extractAttachmentsFromReq(req, bodyText) {
  const attachments = [];
  const url = req.url || '';
  const headers = req.headers || {};

  // 1. Extract from URL query parameters (Case-Insensitive)
  const qIdx = url.indexOf('?');
  if (qIdx !== -1) {
    const queryString = url.substring(qIdx + 1);
    const params = new URLSearchParams(queryString);
    const filenameKeys = ['filename', 'fileName', 'name', 'file', 'title', 'realname', 'realName'];
    const sizeKeys = ['size', 'fileSize', 'length', 'len'];
    
    let filename = '';
    let size = 0;

    const lowerFilenameKeys = filenameKeys.map(k => k.toLowerCase());
    const lowerSizeKeys = sizeKeys.map(k => k.toLowerCase());

    for (const [key, val] of params.entries()) {
      const lk = key.toLowerCase();
      if (lowerFilenameKeys.includes(lk) && val) {
        filename = decodeURIComponent(decodeRFC2047(val)).trim();
      }
      if (lowerSizeKeys.includes(lk) && val) {
        size = Number(val) || 0;
      }
    }

    if (filename && filename.includes('.') && !filename.includes('/') && !filename.includes('\\')) {
      attachments.push({ filename, size });
    }
  }

  // 2. Extract from Headers (Content-Disposition or custom header)
  const contentDisp = headers['content-disposition'] || '';
  if (contentDisp) {
    const filenameMatch = contentDisp.match(/filename="?([^";\r\n]+)"?/i);
    const rfc2231Match = contentDisp.match(/filename\*=([^\s;]+)/i);
    let filename = '';
    if (filenameMatch) {
      filename = decodeURIComponent(decodeRFC2047(filenameMatch[1].trim()));
    } else if (rfc2231Match) {
      const parts = rfc2231Match[1].split("'");
      const encodedText = parts[parts.length - 1];
      try {
        filename = decodeURIComponent(encodedText);
      } catch (_) {}
    }
    if (filename && filename.includes('.') && !filename.includes('/') && !filename.includes('\\')) {
      const size = Number(headers['content-length']) || 0;
      attachments.push({ filename, size });
    }
  }

  const customFilenameHeader = headers['filename'] || headers['x-file-name'] || headers['file-name'] || headers['x-filename'] || headers['x-file-title'];
  if (customFilenameHeader) {
    const filename = decodeURIComponent(decodeRFC2047(customFilenameHeader)).trim();
    if (filename && filename.includes('.') && !filename.includes('/') && !filename.includes('\\')) {
      const size = Number(headers['filesize']) || Number(headers['content-length']) || 0;
      attachments.push({ filename, size });
    }
  }

  // 3. Extract from bodyText
  if (bodyText) {
    const contentType = headers['content-type'] || '';
    const parsed = parseFormDataText(bodyText, contentType);
    if (parsed.attachments && parsed.attachments.length > 0) {
      attachments.push(...parsed.attachments);
    }
  }

  // Deduplicate attachments list
  const seen = new Set();
  return attachments.filter(att => {
    if (!att.filename) return false;
    const key = `${att.filename}:${att.size}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// === 복호화된 HTTPS 요청 파싱 및 기록 ===
function handleDecryptedRequest(req, bodyBuffer) {
  const bodyText = bodyBuffer ? bodyBuffer.toString('utf8') : '';

  const url = req.url || '';
  const host = req.headers.host || '';
  const isSend = isMailSendUrl(url, host);

  proxyDebugLog('REQ', `${req.method} ${host}${url}`, `isSend=${isSend} bodyLen=${bodyText.length}`);

  if (!isSend) {
    // It's an attachment upload request
    const attachments = extractAttachmentsFromReq(req, bodyText);
    if (attachments && attachments.length > 0) {
      for (const att of attachments) {
        addToUploadCache(att.filename, att.size);
        proxyDebugLog('ATTACH', `첨부파일 업로드 감지 (캐싱): ${att.filename} (${att.size} bytes)`);
      }
    }
    return;
  }

  const contentType = req.headers['content-type'] || '';
  const parsed = parseFormDataText(bodyText, contentType);

  // If it's a send request, but parsed has no attachments or has empty names, check recent uploads
  if (parsed.attachments && parsed.attachments.length > 0) {
    parsed.attachments = parsed.attachments.map(att => {
      if (!att.filename || att.filename === 'blob' || att.filename.startsWith('file_')) {
        const recent = getRecentUploads(1)[0];
        if (recent) {
          // Remove consumed item from cache
          const idx = uploadCache.findIndex(item => item.filename === recent.filename && item.size === recent.size);
          if (idx !== -1) uploadCache.splice(idx, 1);
          return { filename: recent.filename, size: recent.size };
        }
      }
      return att;
    });
  } else {
    // If no attachments parsed but upload keywords exist, map recent uploads
    const hasAttachKeywords = bodyText.includes('file') || bodyText.includes('attach') || bodyText.includes('upload') ||
                             url.includes('aId') || url.includes('aCount') || url.includes('attach') || url.includes('file');
    if (hasAttachKeywords && uploadCache.length > 0) {
      const recent = getRecentUploads(5);
      if (recent.length > 0) {
        parsed.attachments = recent.map(r => ({ filename: r.filename, size: r.size }));
        // Remove consumed items from cache
        recent.forEach(r => {
          const idx = uploadCache.findIndex(item => item.filename === r.filename && item.size === r.size);
          if (idx !== -1) uploadCache.splice(idx, 1);
        });
      }
    }
  }

  // Reject any request without valid recipients to filter out background telemetry/drafts
  if (!parsed.recipients || parsed.recipients.length === 0) {
    if (parsed.subject || parsed.body || (parsed.attachments && parsed.attachments.length > 0)) {
      parsed.recipients = ['내부수신자'];
    } else {
      proxyDebugLog('DROP', `수신자·제목·본문 모두 없음 — 드롭`, `host=${host} url=${url}`);
      _debugLog({ url, host, decision: 'DROP', drop_reason: '수신자·제목·본문 모두 없음', action_param: (url.match(/action=([^&]+)/) || [])[1] || null, recipients: [], subject: null, body_length: bodyText.length, has_attachments: false });
      return;
    }
  }

  // 2. 내용없는 로그 필터링 — 수신자는 있지만 제목+본문+첨부가 모두 빈 경우만 드롭
  // (수신자 있고 제목만 있거나 본문만 있어도 수집)
  const isContentEmpty = (!parsed.subject || parsed.subject.trim().length === 0) &&
                         (!parsed.body || parsed.body.trim().length === 0) &&
                         (!parsed.attachments || parsed.attachments.length === 0) &&
                         (!parsed.recipients || parsed.recipients.every(r => r === '내부수신자'));
  if (isContentEmpty) {
    proxyDebugLog('DROP', `제목·본문·첨부 모두 빈 요청 — 드롭`, `host=${host} url=${url}`);
    _debugLog({ url, host, decision: 'DROP', drop_reason: '제목·본문·첨부 모두 빈 요청', action_param: (url.match(/action=([^&]+)/) || [])[1] || null, recipients: parsed.recipients || [], subject: parsed.subject || null, body_length: bodyText.length, has_attachments: false });
    return;
  }

  // 2. Gmail / Google 배경 동기화 및 검색 노이즈 필터링
  const lowerHost = host.toLowerCase();
  if (lowerHost.includes('google') || lowerHost.includes('gmail')) {
    const searchOperators = [
      'in:sent', 'in:inbox', 'in:anywhere', 'in:trash', 'in:spam', 'in:draft',
      'label:sent', 'label:inbox', 'label:draft', 'is:unread', 'category:',
      'has:attachment', 'subject:', 'from:', 'to:', 'cc:', 'bcc:'
    ];
    
    const isSearchQuery = searchOperators.some(op => 
      url.toLowerCase().includes(op) || 
      bodyText.toLowerCase().includes(op) ||
      (parsed.subject || '').toLowerCase().includes(op) ||
      (parsed.body || '').toLowerCase().includes(op)
    );

    if (isSearchQuery) {
      return;
    }

    // Gmail 임시저장 자동저장 요청 및 telemetry 무시
    if (bodyText.includes('SaveDraft') || bodyText.includes('Autosave') || url.includes('/drafts')) {
      return;
    }
  }

  let userAgent = req.headers['user-agent'] || '';
  let browser = 'Chrome';
  if (userAgent.includes('Whale')) browser = 'Whale';
  else if (userAgent.includes('Edg/')) browser = 'Edge';

  const payload = {
    source: 'network_proxy',
    browser,
    mail_host: host,
    sender: parsed.sender || '',
    recipients: parsed.recipients || [],
    title: parsed.subject || '',
    body: stripDisclaimer(parsed.body || '').slice(0, 8000),
    attachments: parsed.attachments || [],
    pageUrl: `https://${host}${url}`,
    timestamp: new Date().toISOString()
  };

  proxyDebugLog('CAPTURED', `메일 발송 감지! [${browser}]`, `host=${host} url=${url} subject=${parsed.subject || '(없음)'} recipients=${(parsed.recipients || []).join(',')}`);
  _debugLog({ url, host, decision: 'PASS', drop_reason: null, action_param: (url.match(/action=([^&]+)/) || [])[1] || null, recipients: parsed.recipients || [], subject: parsed.subject || null, body_length: (parsed.body || '').length, has_attachments: (parsed.attachments || []).length > 0 });
  if (typeof onMailLog === 'function') {
    onMailLog(payload);
  }
}

// === Windows 프록시 Registry 설정 ===
function setWindowsProxy(enable) {
  const regPath = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
  try {
    if (enable) {
      execSync(`reg add "${regPath}" /v ProxyEnable /t REG_DWORD /d 1 /f`, { stdio: 'ignore', windowsHide: true });
      execSync(`reg add "${regPath}" /v ProxyServer /t REG_SZ /d "127.0.0.1:${PROXY_PORT}" /f`, { stdio: 'ignore', windowsHide: true });
      execSync(`reg add "${regPath}" /v ProxyOverride /t REG_SZ /d "localhost;127.0.0.1;<local>" /f`, { stdio: 'ignore', windowsHide: true });
    } else {
      execSync(`reg add "${regPath}" /v ProxyEnable /t REG_DWORD /d 0 /f`, { stdio: 'ignore', windowsHide: true });
    }
    refreshWindowsProxy();
    console.log(`[MailProxy] Windows System Proxy ${enable ? '활성화' : '비활성화'} 완료`);
  } catch (err) {
    console.error('[MailProxy] Windows System Proxy 설정 실패:', err.message);
  }
}

function refreshWindowsProxy() {
  const psCommand = `
    $signature = '[DllImport("wininet.dll", SetLastError = true)] public static extern bool InternetSetOption(IntPtr hInternet, int dwOption, IntPtr lpBuffer, int dwBufferLength);';
    $type = Add-Type -MemberDefinition $signature -Name WinInetUtils -Namespace WinInet -PassThru -ErrorAction SilentlyContinue;
    if ($type) {
      $type::InternetSetOption([IntPtr]::Zero, 39, [IntPtr]::Zero, 0) | Out-Null;
      $type::InternetSetOption([IntPtr]::Zero, 37, [IntPtr]::Zero, 0) | Out-Null;
    }
  `;
  try {
    execSync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${psCommand.replace(/\n/g, ' ').trim()}"`, { stdio: 'ignore', windowsHide: true });
  } catch (_) {}
}

// === 메인 프록시 구동 ===
let lastUserDataPath = null;
let lastOnLog = null;

function start(options = {}) {
  const { userDataPath, onLog } = options;
  if (userDataPath) lastUserDataPath = userDataPath;
  if (onLog) lastOnLog = onLog;
  onMailLog = lastOnLog;

  // 디버그 로그 파일 경로 설정
  if (lastUserDataPath) {
    debugLogPath = path.join(lastUserDataPath, 'proxy-debug.log');
    // 로그 파일이 5MB 초과 시 초기화
    try {
      if (fs.existsSync(debugLogPath) && fs.statSync(debugLogPath).size > 5 * 1024 * 1024) {
        fs.writeFileSync(debugLogPath, '', 'utf8');
      }
    } catch (_) {}
  }

  initCA(lastUserDataPath);

  return new Promise((resolve, reject) => {
    // 1) 로컬 복호화용 TLS 서버 구동 (포트는 OS가 비어있는 포트로 할당)
    const localHttpServer = http.createServer((req, res) => {
      // 복호화된 HTTP 스트림 파이프라인
      const targetHost = req.headers.host;
      console.log(`[MailProxy Debug] Intercepted: ${req.method} ${targetHost}${req.url}`);
      const options = {
        hostname: targetHost ? targetHost.split(':')[0] : 'localhost',
        port: targetHost && targetHost.split(':')[1] ? parseInt(targetHost.split(':')[1], 10) : 443,
        path: req.url,
        method: req.method,
        headers: req.headers
      };

      // POST/PUT 바디 버퍼링 (15MB 캡 - OOM 크래시 방지 및 전송 파이프 유지)
      const isPostOrPut = req.method === 'POST' || req.method === 'PUT';
      const MAX_BODY_CAPTURE_BYTES = 15 * 1024 * 1024;
      let capturedBytes = 0;
      const chunks = [];

      req.on('data', chunk => {
        if (isPostOrPut && capturedBytes < MAX_BODY_CAPTURE_BYTES) {
          chunks.push(chunk);
          capturedBytes += chunk.length;
        }
      });

      const proxyReq = https.request(options, (proxyRes) => {
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res);
      });

      proxyReq.setTimeout(120000, () => proxyReq.destroy());
      proxyReq.on('error', () => {
        if (!res.headersSent) {
          res.writeHead(502);
          res.end();
        }
      });

      req.on('error', () => proxyReq.destroy());
      res.on('error', () => proxyReq.destroy());

      req.on('end', () => {
        const bodyBuffer = chunks.length > 0 ? Buffer.concat(chunks) : null;
        try {
          handleDecryptedRequest(req, bodyBuffer);
        } catch (e) {
          console.error('[MailProxy] 복호화 바디 파싱 에러:', e.message);
        }
      });

      req.pipe(proxyReq);
    });

    localTlsServer = tls.createServer({
      SNICallback: (servername, cb) => {
        try {
          const creds = getOrCreateHostCert(servername);
          const secureContext = tls.createSecureContext(creds);
          cb(null, secureContext);
        } catch (err) {
          cb(err);
        }
      }
    }, (cleartextStream) => {
      localHttpServer.emit('connection', cleartextStream);
    });

    localTlsServer.listen(0, '127.0.0.1', () => {
      localTlsPort = localTlsServer.address().port;
      console.log(`[MailProxy] Local TLS Server listening on port ${localTlsPort}`);

      // 2) 외부 Proxy 서버 구동 (포트: 38472) - 일반 HTTP 요청 투명 포워딩(Pass-through) 지원
      proxyServer = http.createServer((req, res) => {
        try {
          let host = req.headers.host;
          let port = 80;
          let reqPath = req.url;

          if (req.url.startsWith('http://') || req.url.startsWith('https://')) {
            const parsed = new URL(req.url);
            host = parsed.hostname;
            port = parseInt(parsed.port, 10) || (parsed.protocol === 'https:' ? 443 : 80);
            reqPath = parsed.pathname + parsed.search;
          } else if (host) {
            const hostParts = host.split(':');
            host = hostParts[0];
            if (hostParts[1]) port = parseInt(hostParts[1], 10) || 80;
          }

          if (!host) {
            res.writeHead(400);
            return res.end('Invalid Host header');
          }

          const options = {
            hostname: host,
            port: port,
            path: reqPath,
            method: req.method,
            headers: req.headers
          };

          const isInterceptTarget = shouldIntercept(host);
          const isPostOrPut = req.method === 'POST' || req.method === 'PUT';
          const chunks = [];
          let capturedBytes = 0;
          const MAX_BODY_CAPTURE_BYTES = 15 * 1024 * 1024;

          req.on('data', chunk => {
            if (isInterceptTarget && isPostOrPut && capturedBytes < MAX_BODY_CAPTURE_BYTES) {
              chunks.push(chunk);
              capturedBytes += chunk.length;
            }
          });

          const proxyReq = http.request(options, (proxyRes) => {
            res.writeHead(proxyRes.statusCode, proxyRes.headers);
            proxyRes.pipe(res);
          });

          proxyReq.setTimeout(120000, () => proxyReq.destroy());
          proxyReq.on('error', () => {
            if (!res.headersSent) {
              res.writeHead(502);
              res.end('Bad Gateway');
            }
          });

          req.on('error', () => proxyReq.destroy());
          res.on('error', () => proxyReq.destroy());

          req.on('end', () => {
            if (isInterceptTarget && chunks.length > 0) {
              const bodyBuffer = Buffer.concat(chunks);
              try {
                handleDecryptedRequest(req, bodyBuffer);
              } catch (e) {
                console.error('[MailProxy] HTTP 복호화 바디 파싱 에러:', e.message);
              }
            }
          });

          req.pipe(proxyReq);
        } catch (e) {
          if (!res.headersSent) {
            res.writeHead(500);
            res.end('Proxy Internal Error');
          }
        }
      });

      // CONNECT 터널 핸들링 (HTTPS)
      proxyServer.on('connect', (req, socket, head) => {
        socket.setTimeout(180000, () => socket.destroy());
        socket.on('error', () => {});

        const parts = req.url.split(':');
        const host = parts[0];
        const port = parseInt(parts[1], 10) || 443;

        if (shouldIntercept(host)) {
          // 감시 대상 도메인 -> 로컬 TLS 복호화 서버로 포워딩
          const localConn = net.connect(localTlsPort, '127.0.0.1', () => {
            socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
            if (head && head.length > 0) localConn.write(head);
            localConn.pipe(socket);
            socket.pipe(localConn);
          });
          localConn.setTimeout(180000, () => localConn.destroy());
          localConn.on('error', () => socket.destroy());
          socket.on('error', () => localConn.destroy());
        } else {
          // 비감시 도메인 -> 원본 서버로 원시 TCP 터널링 (CONNECT 패스스루)
          const targetConn = net.connect(port, host, () => {
            socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
            if (head && head.length > 0) targetConn.write(head);
            targetConn.pipe(socket);
            socket.pipe(targetConn);
          });
          targetConn.setTimeout(180000, () => targetConn.destroy());
          targetConn.on('error', () => socket.destroy());
          socket.on('error', () => targetConn.destroy());
        }
      });

      proxyServer.on('error', reject);
      proxyServer.listen(PROXY_PORT, '127.0.0.1', () => {
        proxyDebugLog('START', `Main Proxy Server running on port ${PROXY_PORT}`);
        setWindowsProxy(true);
        resolve();
      });
    });
  });
}

function stop() {
  proxyDebugLog('STOP', '프록시 중지 및 Windows 설정 복원 중...');
  if (proxyRefreshTimer) {
    clearInterval(proxyRefreshTimer);
    proxyRefreshTimer = null;
  }
  setWindowsProxy(false);

  return new Promise(resolve => {
    let closedCount = 0;
    const checkResolve = () => {
      closedCount++;
      if (closedCount >= 2) resolve();
    };

    if (proxyServer) {
      proxyServer.close(checkResolve);
      proxyServer = null;
    } else {
      checkResolve();
    }

    if (localTlsServer) {
      localTlsServer.close(checkResolve);
      localTlsServer = null;
    } else {
      checkResolve();
    }
  });
}

/** 프록시 포트(38472) 생존 여부 헬스체크 */
function checkHealth() {
  return new Promise((resolve) => {
    const socket = net.connect(PROXY_PORT, '127.0.0.1', () => {
      socket.destroy();
      resolve(true);
    });
    socket.setTimeout(3000, () => {
      socket.destroy();
      resolve(false);
    });
    socket.on('error', () => {
      resolve(false);
    });
  });
}

/** 프록시 안전 재시작 */
async function restart() {
  proxyDebugLog('RESTART', '프록시 서버 자가 재시작 수행');
  try { await stop(); } catch (_) {}
  await new Promise(r => setTimeout(r, 500));
  return start({ userDataPath: lastUserDataPath, onLog: lastOnLog });
}

module.exports = {
  start,
  stop,
  checkHealth,
  restart,
  setWindowsProxy
};

// security/security-utils.js - 공통 보안 유틸리티
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

function execAsync(cmd, timeout = 15000) {
  return new Promise((resolve) => {
    exec(cmd, { timeout, windowsHide: true }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: stdout || '', stderr: stderr || '', err });
    });
  });
}

function getDefaultWatchFolders() {
  const home = os.homedir();
  return [
    path.join(home, 'Desktop'),
    path.join(home, 'Documents'),
    path.join(home, 'Downloads'),
    path.join(home, 'OneDrive'),
    path.join(process.env.PUBLIC || 'C:\\Users\\Public', 'Documents')
  ].filter(p => fs.existsSync(p));
}

/** Windows 모든 논리 드라이브 루트 (C:\, D:\ …) */
function getSystemWatchRoots() {
  const roots = [];
  for (let code = 65; code <= 90; code++) {
    const root = `${String.fromCharCode(code)}:\\`;
    try {
      if (fs.existsSync(root)) roots.push(root);
    } catch (_) {}
  }
  return roots;
}

const WATCH_IGNORE_RES = [
  /[\\/]Windows([\\/]|$)/i,
  /[\\/]\$Recycle\.Bin([\\/]|$)/i,
  /[\\/]System Volume Information([\\/]|$)/i,
  /[\\/]Program Files \(x86\)([\\/]|$)/i,
  /[\\/]Program Files([\\/]|$)/i,
  /[\\/]ProgramData([\\/]|$)/i,
  /[\\/]AppData[\\/]Local[\\/]Temp([\\/]|$)/i,
  /[\\/]AppData[\\/]Local[\\/]Microsoft[\\/]Windows[\\/]INetCache/i,
  /[\\/]AppData[\\/]Local[\\/]Google[\\/]Chrome[\\/]User Data/i,
  /[\\/]AppData[\\/]Local[\\/]Packages[\\/]/i,
  /[\\/]node_modules([\\/]|$)/i,
  /[\\/]\.git([\\/]|$)/i,
  /[\\/]AppData[\\/]Local[\\/]Temp([\\/]|$)/i,
  /[\\/]AppData[\\/]Local[\\/]Microsoft[\\/]/i,
  /[\\/]AppData[\\/]Roaming[\\/]Cursor([\\/]|$)/i,
  /[\\/]AppData[\\/]Local[\\/]Cursor([\\/]|$)/i,
  /[\\/]AppData[\\/]Local[\\/]npm-cache([\\/]|$)/i,
  /[\\/]AppData[\\/]Local[\\/]pnpm([\\/]|$)/i,
  /[\\/]AppData[\\/]Local[\\/]D3DSCache([\\/]|$)/i,
  /[\\/]AppData[\\/]Local[\\/]CrashDumps([\\/]|$)/i,
  /oksoo-security[\\/]quarantine/i,
  /[\\/]JBMSOFT_Security([\\/]|$)/i,
  /[\\/]dist[\\/]win-unpacked/i,
  /pagefile\.sys$/i,
  /hiberfil\.sys$/i,
  /swapfile\.sys$/i
];

function shouldIgnoreWatchPath(filePath) {
  if (!filePath) return true;
  const norm = filePath.replace(/\//g, '\\');
  return WATCH_IGNORE_RES.some(re => re.test(norm));
}

function getQuarantineDir() {
  const dir = path.join(process.env.APPDATA || os.homedir(), 'oksoo-security', 'quarantine');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function normalizeExt(ext) {
  if (!ext) return '';
  return ext.replace(/^\./, '').toLowerCase();
}

function getFileExt(filePath) {
  return normalizeExt(path.extname(filePath));
}

function isBlockedExtension(filePath, blockedList) {
  const ext = getFileExt(filePath);
  if (!ext || !Array.isArray(blockedList)) return false;
  return blockedList.map(normalizeExt).includes(ext);
}

function quarantineFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const qDir = getQuarantineDir();
    const base = path.basename(filePath);
    const stamp = Date.now();
    const dest = path.join(qDir, `${stamp}_${base}`);
    fs.renameSync(filePath, dest);
    return dest;
  } catch (e) {
    try {
      const qDir = getQuarantineDir();
      const dest = path.join(qDir, `${Date.now()}_${path.basename(filePath)}`);
      fs.copyFileSync(filePath, dest);
      fs.unlinkSync(filePath);
      return dest;
    } catch (_) {
      return null;
    }
  }
}

function deleteFileSafe(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
  } catch (_) {}
  return false;
}

function matchEmailDomain(email, pattern) {
  if (!email || !pattern) return false;
  const e = email.toLowerCase().trim();
  const p = pattern.toLowerCase().trim();
  if (p.startsWith('@')) return e.endsWith(p) || e.endsWith(p.slice(1));
  if (p.includes('@')) return e === p;
  return e.endsWith('@' + p) || e.endsWith('.' + p);
}

function isEmailAllowed(email, whitelist) {
  if (!email) return false;
  if (!whitelist || whitelist.length === 0) return false;
  return whitelist.some(p => matchEmailDomain(email, p));
}

function isEmailBlocked(email, blacklist) {
  if (!email || !blacklist || blacklist.length === 0) return false;
  return blacklist.some(p => matchEmailDomain(email, p));
}

function extractEmails(text) {
  if (!text) return [];
  const re = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
  return (text.match(re) || []).map(e => e.toLowerCase());
}

/** 클립보드/작성창 텍스트에서 메일 감사 로그용 정보 추출 */
function parseMailAuditContext(text) {
  const raw = String(text || '');
  const emails = extractEmails(raw);
  const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const attachmentRe = /[^\s\\/:*?"<>|]+\.(docx?|xlsx?|pptx?|pdf|hwp|hwpx|zip|rar|7z|png|jpe?g|gif|txt|csv|ppt|xls)\b/gi;
  const attachments = [...new Set((raw.match(attachmentRe) || []).map(s => s.trim()))].slice(0, 30);

  let subject = '';
  for (const line of lines) {
    if (line.length > 0 && line.length <= 200 && !extractEmails(line).length) {
      subject = line;
      break;
    }
  }

  let bodyPreview = raw;
  if (subject && bodyPreview.startsWith(subject)) {
    bodyPreview = bodyPreview.slice(subject.length).trim();
  }
  if (bodyPreview.length > 800) bodyPreview = bodyPreview.slice(0, 800) + '…';

  return { emails, subject, bodyPreview, attachments };
}

module.exports = {
  execAsync,
  getDefaultWatchFolders,
  getSystemWatchRoots,
  shouldIgnoreWatchPath,
  getQuarantineDir,
  normalizeExt,
  getFileExt,
  isBlockedExtension,
  quarantineFile,
  deleteFileSafe,
  matchEmailDomain,
  isEmailAllowed,
  isEmailBlocked,
  extractEmails,
  parseMailAuditContext
};

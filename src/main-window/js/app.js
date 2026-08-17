// app.js - 메인 애플리케이션 로직
'use strict';

// ─── 개발/테스트 모드 플래그 ───
// 프로덕션 배포 시 아래 줄을 false 로 변경하세요.
const DEV_MODE = false;

// ─── 상태 변수 ───
let currentTab = 'dashboard';
let allConfig = {};
let logPage = 1;
const LOG_PER_PAGE = 30;
let filteredLogs = [];
let approvalFilter = 'all';
let pendingAuthAction = null;
const renderedTabs = new Set(['dashboard']);
let uiRefreshTimer = null;

// ─── 초기화 ───
async function init() {
  setupIpcListeners(); // 가장 먼저 IPC 이벤트 바인딩

  try {
    if (window.electronAPI) {
      allConfig = await window.electronAPI.getAllStore();
      const savedLang = allConfig.language || 'ko';
      currentLang = savedLang;
      document.getElementById('btnKo').classList.toggle('active', savedLang === 'ko');
      document.getElementById('btnEn').classList.toggle('active', savedLang === 'en');
    } else {
      allConfig = getDefaultConfig();
    }
  } catch(e) {
    allConfig = getDefaultConfig();
  }

  applyTranslations();
  await loadSystemInfo();
  loadSettingsToUI();
  renderDashboard();
  startDashboardRefresh();

  // SVG 그라디언트 주입
  injectSVGDefs();
}

function refreshTab(tabId) {
  switch (tabId) {
    case 'dashboard': renderDashboard(); break;
    case 'filesec': break;
    case 'network': renderNetworkIfaces(); break;
    case 'approval':
      renderApprovals();
      if (window.electronAPI && window.electronAPI.syncApprovals) {
        window.electronAPI.syncApprovals().then(list => {
          allConfig.approvalRequests = list;
          renderApprovals();
        }).catch(() => {});
      }
      break;
    case 'logs': renderLogs(); break;
  }
}

function scheduleUiRefresh() {
  if (uiRefreshTimer) return;
  uiRefreshTimer = setTimeout(() => {
    uiRefreshTimer = null;
    if (currentTab === 'dashboard') renderDashboard();
    else if (currentTab === 'logs') renderLogs();
    else if (currentTab === 'approval') renderApprovals();
  }, 350);
}

function getDefaultConfig() {
  return {
    language: 'ko',
    adminPassword: 'oksooht0731',
    security: {
      fileGuard: true,
      clipboardGuard: false,
      mailGuard: true,
      usbGuard: false,
      autoLockMinutes: 30,
      blockedExtensions: ['exe', 'bat', 'cmd', 'ps1', 'sh', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'pdf', 'hwp', 'dwg', 'dxf', 'dwf'],
      watchedFolders: []
    },
    network: {
      smtpPorts: [25, 465, 587, 993, 995, 110, 143],
      allowedMailServers: [],
      blockWebmail: true,
      blockCloudUpload: false
    },
    approvalRequests: [],
    securityLogs: [],
    initialized: false
  };
}

// ─── SVG 그라디언트 ───
function injectSVGDefs() {
  const svg = document.querySelector('.score-svg');
  if (!svg) return;
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  defs.innerHTML = `
    <linearGradient id="scoreGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" style="stop-color:#4f46e5"/>
      <stop offset="100%" style="stop-color:#06b6d4"/>
    </linearGradient>`;
  svg.insertBefore(defs, svg.firstChild);
}

// ─── 시스템 정보 로드 ───
async function loadSystemInfo() {
  try {
    if (!window.electronAPI) {
      document.getElementById('sysHostname').textContent = 'DESKTOP-JBMSOFT';
      document.getElementById('sysUser').textContent = 'admin';
      return;
    }
    const info = await window.electronAPI.getSystemInfo();
    document.getElementById('sysHostname').textContent = info.hostname;
    document.getElementById('sysUser').textContent = info.username;
  } catch(e) {}
}

// ─── 설정 → UI 로드 ───
function loadSettingsToUI() {
  const sec = allConfig.security || {};
  const net = allConfig.network || {};

  // 파일 보안
  setToggle('toggleClipboard', sec.clipboardGuard !== false);
  setToggle('toggleFileGuard', sec.fileGuard !== false);
  setToggle('toggleUSB', sec.usbGuard === true);

  // 잠금 정책 슬라이더 제거됨 — 자동 잠금 기능 없음
  setToggle('toggleScreenLock', sec.screenLock !== false);
  setToggle('toggleFailLimit', sec.failLimit !== false);

  // 확장자 태그
  renderExtTags(sec.blockedExtensions || ['exe', 'bat', 'cmd', 'ps1', 'sh', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'pdf', 'hwp', 'dwg', 'dxf', 'dwf']);

  // 감시 폴더
  renderWatchFolders(sec.watchedFolders || []);

  // 네트워크
  setToggle('toggleMailGuard', (net.mailGuard !== false && sec.mailGuard !== false));
  const smtpEl = document.getElementById('smtpPorts');
  if (smtpEl) smtpEl.value = (net.smtpPorts || [25, 465, 587]).join(', ');
}

function setToggle(id, val) {
  const el = document.getElementById(id);
  if (el) el.checked = val;
}

// ─── 탭 전환 ───
function switchTab(tabId) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const panel = document.getElementById('tab-' + tabId);
  if (panel) panel.classList.add('active');
  const navBtn = document.querySelector(`[data-tab="${tabId}"]`);
  if (navBtn) navBtn.classList.add('active');
  currentTab = tabId;

  refreshTab(tabId);
}

// ─── 대시보드 렌더링 ───
function renderDashboard() {
  const logs = allConfig.securityLogs || [];
  const approvals = allConfig.approvalRequests || [];
  const pending = approvals.filter(r => r.status === 'pending');
  const sec = allConfig.security || {};
  const net = allConfig.network || {};

  // 통계
  const blocked = logs.filter(l => l.type === 'blocked' && isToday(l.timestamp)).length;
  document.getElementById('statBlocked').textContent = blocked;
  document.getElementById('statPending').textContent = pending.length;
  const mailEl = document.getElementById('statMailGuard');
  const usbEl = document.getElementById('statUsbGuard');
  if (mailEl) mailEl.textContent = net.mailGuard !== false ? 'ON' : 'OFF';
  if (usbEl) usbEl.textContent = sec.usbGuard === true ? 'ON' : 'OFF';

  // 승인 배지
  const badge = document.getElementById('approvalBadge');
  if (badge) {
    badge.textContent = pending.length;
    badge.style.display = pending.length > 0 ? 'flex' : 'none';
  }
  document.getElementById('pendingCount').textContent = pending.length;

  // 보안 점수
  const score = computeSecurityScore();
  document.getElementById('scoreValue').textContent = score;
  const fill = document.getElementById('scoreFill');
  if (fill) {
    const circumference = 2 * Math.PI * 34;
    fill.style.strokeDasharray = circumference;
    fill.style.strokeDashoffset = circumference * (1 - score / 100);
  }

  // 정책 현황
  renderPolicyList();

  // 최근 로그
  renderRecentLogs(logs.slice(0, 5));
}

function isToday(isoStr) {
  if (!isoStr) return false;
  const d = new Date(isoStr);
  const now = new Date();
  return d.toDateString() === now.toDateString();
}

function computeSecurityScore() {
  let score = 100;
  const sec = allConfig.security || {};
  const net = allConfig.network || {};
  if (!sec.fileGuard) score -= 15;
  if (!sec.clipboardGuard) score -= 10;
  if (!net.mailGuard) score -= 10;
  if (!allConfig.adminPassword) score -= 5;
  return Math.max(0, score);
}

function renderPolicyList() {
  const sec = allConfig.security || {};
  const net = allConfig.network || {};
  const policies = [
    { name: t('fs_clipboard'), on: sec.clipboardGuard !== false },
    { name: t('fs_file_guard'), on: sec.fileGuard !== false },
    { name: t('net_mail_guard'), on: net.mailGuard !== false },
    { name: t('fs_usb'), on: sec.usbGuard === true },
  ];
  const el = document.getElementById('dashPolicyList');
  if (!el) return;
  el.innerHTML = policies.map(p => `
    <div class="policy-item">
      <span class="policy-name">${p.name}</span>
      <span class="policy-status ${p.on ? 'on' : 'off'}">${p.on ? 'ON' : 'OFF'}</span>
    </div>`).join('');
}

function renderRecentLogs(logs) {
  const el = document.getElementById('dashLogList');
  if (!el) return;
  if (!logs.length) { el.innerHTML = `<div class="empty-state">${t('no_events')}</div>`; return; }
  el.innerHTML = logs.map(l => `
    <div class="log-item ${l.type}">
      <span class="log-type-icon">${logIcon(l.type)}</span>
      <div class="log-details">
        <div class="log-msg">${escHtml(l.message)}</div>
        <div class="log-time">${formatTime(l.timestamp)}</div>
      </div>
    </div>`).join('');
}

// ─── 파일 보안 설정 저장 ───
function saveSecurity() {
  const sec = {
    fileGuard: document.getElementById('toggleFileGuard')?.checked,
    clipboardGuard: document.getElementById('toggleClipboard')?.checked,
    usbGuard: document.getElementById('toggleUSB')?.checked,
    blockedExtensions: getExtTags(),
    watchedFolders: getWatchFolders()
  };
  allConfig.security = sec;
  if (window.electronAPI) {
    window.electronAPI.setStore('security', sec);
  }
  renderDashboard();
}

function saveNetwork() {
  const mailOn = document.getElementById('toggleMailGuard')?.checked !== false;
  const net = {
    mailGuard: mailOn,
    blockWebmail: true,
    smtpPorts: document.getElementById('smtpPorts')?.value.split(',').map(p => parseInt(p.trim())).filter(Boolean) || [25,465,587,993,995,110,143],
    allowedMailServers: allConfig.network?.allowedMailServers || []
  };
  allConfig.network = net;
  const sec = allConfig.security || {};
  sec.mailGuard = mailOn;
  allConfig.security = sec;
  if (window.electronAPI) {
    window.electronAPI.setStore('network', net);
    window.electronAPI.setStore('security', sec);
  }
  renderDashboard();
  showToast(t('toast_saved'), 'success');
}

// ─── 확장자 태그 ───
let extTags = ['exe', 'bat', 'cmd', 'ps1', 'sh', 'doc', 'docx', 'xls', 'xlsx', 'pdf', 'hwp', 'dwg', 'dxf'];

function renderExtTags(tags) {
  extTags = tags;
  const el = document.getElementById('extTagArea');
  if (!el) return;
  el.innerHTML = extTags.map(ext => `
    <span class="tag">
      .${escHtml(ext)}
    </span>`).join('');
}

function addExtension() {
  const inp = document.getElementById('extInput');
  if (!inp) return;
  const val = inp.value.trim().replace(/^\./, '').toLowerCase();
  if (val && !extTags.includes(val)) {
    extTags.push(val);
    renderExtTags(extTags);
    saveSecurity();
  }
  inp.value = '';
}

function removeExt(ext) {
  extTags = extTags.filter(e => e !== ext);
  renderExtTags(extTags);
  saveSecurity();
}

function getExtTags() { return extTags; }

// ─── 감시 폴더 ───
function renderWatchFolders(folders) {
  const el = document.getElementById('watchFolderList');
  if (!el) return;
  if (!folders.length) {
    el.innerHTML = `<div class="empty-state">${t('no_folders')}</div>`;
    return;
  }
  el.innerHTML = folders.map((f, i) => `
    <div class="folder-item">
      <span>📁</span>
      <span>${escHtml(f)}</span>
      <button onclick="removeWatchFolder(${i})">✕</button>
    </div>`).join('');
}

async function addWatchFolder() {
  let folderPath = null;

  // Electron 환경: 폴더 다이얼로그 사용
  if (window.electronAPI && window.electronAPI.showFolderDialog) {
    folderPath = await window.electronAPI.showFolderDialog();
  } else {
    // 브라우저 환경 폴백: prompt 사용
    folderPath = prompt('감시할 폴더 경로를 입력하세요:', 'C:\\Users\\');
  }

  if (!folderPath || !folderPath.trim()) return;
  folderPath = folderPath.trim();

  const folders = allConfig.security?.watchedFolders || [];
  if (folders.includes(folderPath)) {
    showToast(currentLang === 'ko' ? '이미 등록된 폴더입니다' : 'Folder already watched', 'warning');
    return;
  }
  folders.push(folderPath);
  allConfig.security = { ...(allConfig.security || {}), watchedFolders: folders };
  if (window.electronAPI) {
    await window.electronAPI.setStore('security', allConfig.security);
    await window.electronAPI.startFileWatcher(folders);
  }
  renderWatchFolders(folders);
  addSecLog('allowed', `감시 폴더 추가: ${folderPath}`);
  showToast(
    currentLang === 'ko' ? `감시 폴더 추가: ${folderPath}` : `Watching: ${folderPath}`,
    'success'
  );
}

async function removeWatchFolder(idx) {
  const folders = allConfig.security?.watchedFolders || [];
  const removed = folders.splice(idx, 1)[0];
  allConfig.security = { ...(allConfig.security || {}), watchedFolders: folders };
  if (window.electronAPI) {
    await window.electronAPI.setStore('security', allConfig.security);
    await window.electronAPI.startFileWatcher(folders);
  }
  renderWatchFolders(folders);
  if (removed) addSecLog('warning', `감시 폴더 제거: ${removed}`);
}

function getWatchFolders() { return allConfig.security?.watchedFolders || []; }

// ─── 잠금 정책 저장 (screenLock, failLimit만) ───
async function saveLockPolicy() {
  const screenLock = document.getElementById('toggleScreenLock')?.checked !== false;
  const failLimit = document.getElementById('toggleFailLimit')?.checked !== false;

  const sec = allConfig.security || {};
  sec.screenLock = screenLock;
  sec.failLimit = failLimit;
  allConfig.security = sec;

  if (window.electronAPI) {
    await window.electronAPI.setStore('security', sec);
  }
  showToast(
    currentLang === 'ko' ? '인증 정책이 저장되었습니다' : 'Auth policy saved',
    'success'
  );
  addSecLog('allowed', `인증 정책 저장: 화면잠금 ${screenLock ? 'ON' : 'OFF'}, 실패횟수제한 ${failLimit ? 'ON' : 'OFF'}`);
}

// ─── 네트워크 인터페이스 ───
async function renderNetworkIfaces() {
  const el = document.getElementById('networkIfaceGrid');
  if (!el) return;
  try {
    let ifaces = [];
    if (window.electronAPI) {
      const info = await window.electronAPI.getSystemInfo();
      ifaces = info.networkInterfaces || [];
    } else {
      ifaces = [{ name: 'Ethernet', address: '192.168.1.100', mac: 'AA:BB:CC:DD:EE:FF' }];
    }
    if (!ifaces.length) { el.innerHTML = `<div class="empty-state">네트워크 인터페이스 없음</div>`; return; }
    el.innerHTML = ifaces.map(i => `
      <div class="iface-card">
        <div class="iface-name">🌐 ${escHtml(i.name)}</div>
        <div class="iface-row">IP: <span class="iface-val">${escHtml(i.address)}</span></div>
        <div class="iface-row">MAC: <span class="iface-val">${escHtml(i.mac)}</span></div>
      </div>`).join('');
  } catch(e) {
    el.innerHTML = `<div class="empty-state">로딩 실패</div>`;
  }
}

function unlockUninstall() {
  pendingAuthAction = 'uninstall';
  openModal('modalAdminAuth');
  setTimeout(() => document.getElementById('authPwInput')?.focus(), 100);
}

// ─── 비밀번호 ───
function togglePw(id) {
  const el = document.getElementById(id);
  if (el) el.type = el.type === 'password' ? 'text' : 'password';
}

document.addEventListener('input', function(e) {
  if (e.target.id === 'pwNew') {
    updatePasswordStrength(e.target.value);
  }
});

function updatePasswordStrength(pw) {
  const fill = document.getElementById('pwStrengthFill');
  const label = document.getElementById('pwStrengthLabel');
  if (!fill || !label) return;
  let score = 0;
  if (pw.length >= 8) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;

  const configs = [
    { pct: 0,   color: 'transparent', label: '' },
    { pct: 25,  color: 'var(--red)',    label: currentLang === 'ko' ? '매우 약함' : 'Very Weak' },
    { pct: 50,  color: 'var(--yellow)', label: currentLang === 'ko' ? '보통' : 'Fair' },
    { pct: 75,  color: 'var(--blue)',   label: currentLang === 'ko' ? '강함' : 'Strong' },
    { pct: 100, color: 'var(--green)',  label: currentLang === 'ko' ? '매우 강함' : 'Very Strong' },
  ];
  const cfg = configs[score] || configs[0];
  fill.style.width = cfg.pct + '%';
  fill.style.background = cfg.color;
  label.textContent = cfg.label;
  label.style.color = cfg.color;
}

async function saveAdminPassword() {
  const curr = document.getElementById('pwCurrent').value;
  const newPw = document.getElementById('pwNew').value;
  const confirm = document.getElementById('pwConfirm').value;

  if (!newPw) { showToast(t('toast_pw_empty'), 'error'); return; }
  if (newPw !== confirm) { showToast(t('toast_pw_mismatch'), 'error'); return; }

  // 기존 비밀번호 확인 (첫 설정이면 스킵)
  const existing = allConfig.adminPassword;
  if (existing && curr !== existing) {
    showToast(currentLang === 'ko' ? '현재 비밀번호가 올바르지 않습니다' : 'Current password is incorrect', 'error');
    return;
  }

  allConfig.adminPassword = newPw;
  if (window.electronAPI) await window.electronAPI.setStore('adminPassword', newPw);

  ['pwCurrent','pwNew','pwConfirm'].forEach(id => { const el=document.getElementById(id); if(el) el.value=''; });
  document.getElementById('pwStrengthFill').style.width = '0';
  document.getElementById('pwStrengthLabel').textContent = '';

  showToast(t('toast_pw_changed'), 'success');
  renderDashboard();
  addSecLog('allowed', currentLang === 'ko' ? '관리자 비밀번호 변경' : 'Admin password changed');
}

function updateAutoLock(val) { /* 제거됨 */ }

// ─── 승인 현황 (조회 전용) ───
function renderApprovals(filter) {
  if (filter) approvalFilter = filter;
  const all = allConfig.approvalRequests || [];
  const filtered = approvalFilter === 'all' ? all : all.filter(r => r.status === approvalFilter);
  const el = document.getElementById('approvalList');
  if (!el) return;

  if (!filtered.length) {
    el.innerHTML = `<div class="empty-state">${t('no_requests')}</div>`;
    return;
  }

  el.innerHTML = filtered.map(r => {
    const type = r.request_type || (r.filename?.startsWith('[USB]') ? 'usb_connect'
      : r.filename?.startsWith('[MAIL]') ? (r.recipient?.includes('webmail_access') ? 'webmail_access' : 'mail_send')
      : 'file_transfer');
    const icon = type === 'usb_connect' ? '🔌' : type === 'webmail_access' || type === 'mail_send' ? '📧' : '📄';
    const typeLabel = type === 'usb_connect' ? 'USB' : type === 'webmail_access' ? '웹메일' : type === 'mail_send' ? '메일' : '파일';
    const statusNote = r.status === 'pending'
      ? (currentLang === 'ko' ? '관리자 웹에서 승인 대기 중' : 'Awaiting admin web approval')
      : r.status === 'approved'
        ? (currentLang === 'ko' ? '승인 완료' : 'Approved')
        : (currentLang === 'ko' ? '거부됨' : 'Rejected');
    const cleanFilename = (r.filename || '').replace(/^\[(USB|MAIL|FILE)\]\s*/i, '');
    return `
    <div class="approval-card ${r.status}">
      <span class="approval-icon">${r.status === 'pending' ? icon : r.status === 'approved' ? '✅' : '❌'}</span>
      <div class="approval-info">
        <div class="approval-filename">${icon} [${typeLabel}] ${escHtml(cleanFilename || '(요청 없음)')}</div>
        <div class="approval-meta">${statusNote}</div>
        <div class="approval-time">${formatTime(r.timestamp || r.resolvedAt)}</div>
      </div>
      <div class="approval-status">
        <span class="badge ${r.status === 'pending' ? 'badge-yellow' : r.status === 'approved' ? 'badge-green' : 'badge-red'}">
          ${r.status === 'pending' ? (currentLang === 'ko' ? '대기' : 'Pending') : r.status === 'approved' ? (currentLang === 'ko' ? '승인' : 'Approved') : (currentLang === 'ko' ? '거부' : 'Rejected')}
        </span>
      </div>
    </div>`;
  }).join('');
}

function filterApprovals(filter) {
  approvalFilter = filter;
  document.querySelectorAll('.filter-tab').forEach((btn, i) => {
    const filters = ['all','pending','approved','rejected'];
    btn.classList.toggle('active', filters[i] === filter);
  });
  renderApprovals(filter);
}

function notifyDesktop(title, body) {
  if (window.electronAPI?.showNotification) {
    window.electronAPI.showNotification(title, body);
  }
}

// 외부에서 승인 요청을 추가하는 공용 함수 (보안 엔진이 호출 가능하도록)
async function submitApprovalRequest(filename, recipient, reason) {
  const sysInfo = window.electronAPI ? await window.electronAPI.getSystemInfo().catch(() => ({})) : {};
  const req = {
    id: Date.now().toString(),
    filename,
    recipient,
    requester: sysInfo.username || '사용자',
    timestamp: new Date().toISOString(),
    status: 'pending'
  };
  const requests = allConfig.approvalRequests || [];
  requests.unshift(req);
  allConfig.approvalRequests = requests;
  if (window.electronAPI) {
    await window.electronAPI.addApprovalRequest(req);
    window.electronAPI.requestApproval({ fileName: filename, destination: recipient, reason: reason || '' }).catch(() => {});
  }
  renderApprovals();
  renderDashboard();
  addSecLog('warning', `파일 전송 승인 요청: ${filename} → ${recipient}`);
}

// ─── 보안 로그 ───
async function addSecLog(type, message) {
  const entry = { type, message, timestamp: new Date().toISOString() };
  const logs = allConfig.securityLogs || [];
  logs.unshift(entry);
  if (logs.length > 1000) logs.splice(1000);
  allConfig.securityLogs = logs;
  if (window.electronAPI) await window.electronAPI.addLog(entry);
  if (currentTab === 'logs') renderLogs();
  if (currentTab === 'dashboard') renderRecentLogs(logs.slice(0, 5));
  renderDashboard();
}

function renderLogs(filter, search) {
  let logs = allConfig.securityLogs || [];
  if (filter && filter !== 'all') logs = logs.filter(l => l.type === filter);
  if (search) logs = logs.filter(l => l.message.toLowerCase().includes(search.toLowerCase()));
  filteredLogs = logs;

  const total = Math.ceil(logs.length / LOG_PER_PAGE) || 1;
  if (logPage > total) logPage = total;
  const pageLogs = logs.slice((logPage-1) * LOG_PER_PAGE, logPage * LOG_PER_PAGE);

  document.getElementById('logPageText').textContent = `${logPage} / ${total}`;
  document.getElementById('logPrevBtn').disabled = logPage <= 1;
  document.getElementById('logNextBtn').disabled = logPage >= total;

  const el = document.getElementById('logList');
  if (!el) return;

  if (!pageLogs.length) { el.innerHTML = `<div class="empty-state">${t('no_logs')}</div>`; return; }

  el.innerHTML = pageLogs.map(l => `
    <div class="log-entry ${l.type}">
      <span class="log-entry-icon">${logIcon(l.type)}</span>
      <span class="log-entry-msg">${escHtml(l.message)}</span>
      <span class="log-entry-time">${formatTime(l.timestamp)}</span>
    </div>`).join('');
}

function filterLogs(val) { logPage = 1; renderLogs(val, document.getElementById('logSearch')?.value); }
function searchLogs(val) { logPage = 1; renderLogs(document.getElementById('logFilter')?.value, val); }
function logPageChange(dir) { logPage += dir; renderLogs(document.getElementById('logFilter')?.value, document.getElementById('logSearch')?.value); }

async function clearLogs() {
  if (!confirm(currentLang === 'ko' ? '모든 로그를 삭제하시겠습니까?' : 'Clear all logs?')) return;
  allConfig.securityLogs = [];
  if (window.electronAPI) await window.electronAPI.setStore('securityLogs', []);
  renderLogs();
  renderDashboard();
  showToast(t('toast_log_cleared'), 'warning');
}

function exportLogs() {
  const logs = allConfig.securityLogs || [];
  const csv = ['Timestamp,Type,Message', ...logs.map(l =>
    `"${l.timestamp}","${l.type}","${l.message.replace(/"/g, '""')}"`
  )].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `jbmsecurity_logs_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast(t('toast_exported'), 'success');
}

// ─── 관리자 인증 모달 ───
function setupIpcListeners() {
  if (!window.electronAPI) return;

  window.electronAPI.on('show-admin-auth', (action) => {
    pendingAuthAction = action;
    openModal('modalAdminAuth');
    setTimeout(() => document.getElementById('authPwInput')?.focus(), 100);
  });


  // 승인 요청 갱신
  window.electronAPI.on('approval-update', (req) => {
    const requests = allConfig.approvalRequests || [];
    const idx = requests.findIndex(r => r.id === req.id || r.serverId === req.serverId);
    if (idx >= 0) requests[idx] = { ...requests[idx], ...req };
    else requests.unshift(req);
    allConfig.approvalRequests = requests;
    scheduleUiRefresh();
  });

  // 보안 이벤트 — UI 로그만 갱신 (알림은 Windows 작업표시줄 토스트)
  window.electronAPI.on('security-event', (payload) => {
    if (payload && payload.batch && Array.isArray(payload.batch)) {
      const logs = allConfig.securityLogs || [];
      payload.batch.slice().reverse().forEach(entry => logs.unshift(entry));
      if (logs.length > 1000) logs.splice(1000);
      allConfig.securityLogs = logs;
      scheduleUiRefresh();
      return;
    }
    if (!payload || !payload.message) return;
    const logs = allConfig.securityLogs || [];
    logs.unshift(payload);
    if (logs.length > 1000) logs.splice(1000);
    allConfig.securityLogs = logs;
    scheduleUiRefresh();
  });

  // 엔진 상태 변경 이벤트 수신
  window.electronAPI.on('engine-status-change', ({ isPaused }) => {
    const badge = document.getElementById('statusBadge');
    if (badge) {
      badge.textContent = isPaused
        ? (currentLang === 'ko' ? '⏸ 보안 일시 중지' : '⏸ Security Paused')
        : (currentLang === 'ko' ? '● 보안 활성화' : '● Security Active');
      badge.style.color = isPaused ? 'var(--yellow, #f59e0b)' : '';
    }
  });

  // 서버 정책 변경 수신 및 UI 즉각 반영
  window.electronAPI.on('policy-updated', async () => {
    if (window.electronAPI) {
      allConfig = await window.electronAPI.getAllStore();
    }
    loadSettingsToUI();
    renderDashboard();
    showToast(currentLang === 'ko' ? '서버의 최신 보안 정책이 자동 적용되었습니다.' : 'Latest server policy applied.', 'success');
  });

  // USB 차단 팝업
  window.electronAPI.on('usb-blocked', ({ drive, fs }) => {
    showUsbBlockedPopup(drive, fs);
  });
}

// ─── 관리자 인증 후 실제 액션 실행 (공용 헬퍼) ───
async function _executeAuthAction(action) {
  if (action === 'quit') {
    if (window.electronAPI) window.electronAPI.quitApp();
  } else if (action === 'pause') {
    if (window.electronAPI) await window.electronAPI.pauseEngine();
    const badge = document.getElementById('statusBadge');
    if (badge) {
      badge.textContent = currentLang === 'ko' ? '⏸ 보안 일시 중지' : '⏸ Security Paused';
      badge.style.color = 'var(--yellow, #f59e0b)';
    }
    showToast(
      currentLang === 'ko'
        ? '보안 감시가 일시 중지되었습니다. 트레이 → 보안 재개로 복원할 수 있습니다.'
        : 'Security paused. Resume via tray icon.',
      'warning'
    );
    addSecLog('warning', currentLang === 'ko' ? '관리자 인증으로 보안 엔진 일시 중지' : 'Security engine paused by admin');
  } else if (action === 'auto-lock') {
    // 자동 잠금 해제 — 모달 닫기만 하면 됨
    showToast(currentLang === 'ko' ? '인증되었습니다.' : 'Authenticated.', 'success');
  } else if (action === 'uninstall') {
    if (window.electronAPI) {
      const success = await window.electronAPI.allowUninstall(true);
      if (success) {
        showToast('삭제 보호가 해제되었습니다. 이제 프로그램 추가/제거에서 삭제할 수 있습니다. (PC 재부팅 시 다시 보호됨)', 'warning');
      } else {
        showToast('레지스트리 접근 실패. 관리자 권한으로 실행 중인지 확인하세요.', 'error');
      }
    }
  }
}

async function confirmAuth() {
  const pw = document.getElementById('authPwInput')?.value || '';
  let stored = allConfig.adminPassword;

  if (window.electronAPI) {
    stored = await window.electronAPI.getStore('adminPassword') || stored;
  }

  // DEV_MODE: uninstall만 예외 (필요 시 제거)
  if (DEV_MODE && pendingAuthAction === 'uninstall') {
    closeModal('modalAdminAuth');
    document.getElementById('authPwInput').value = '';
    await _executeAuthAction('uninstall');
    pendingAuthAction = null;
    return;
  }

  // 서버 동기화 전이라도 기본 비밀번호로 비교 (폴백)
  const DEFAULT_PW = 'oksooht26';
  if (!stored) stored = DEFAULT_PW;

  if (pw !== stored) {
    showToast(currentLang === 'ko' ? '비밀번호가 올바르지 않습니다' : 'Incorrect password', 'error');
    document.getElementById('authPwInput').value = '';
    document.getElementById('authPwInput').focus();
    return;
  }
  closeModal('modalAdminAuth');
  document.getElementById('authPwInput').value = '';

  await _executeAuthAction(pendingAuthAction);
  pendingAuthAction = null;
}

// ─── 모달 유틸 ───
function openModal(id) { const el = document.getElementById(id); if(el) { el.style.display = 'flex'; } }
function closeModal(id) { const el = document.getElementById(id); if(el) { el.style.display = 'none'; } }

// ─── USB 차단 팝업 (사유 입력 방식) ───
function showUsbBlockedPopup(drive, fs) {
  const existing = document.getElementById('usbBlockedPopup');
  if (existing) existing.remove();
  const existingOv = document.getElementById('usbBlockedOverlay');
  if (existingOv) existingOv.remove();

  const popup = document.createElement('div');
  popup.id = 'usbBlockedPopup';
  popup.style.cssText = [
    'position:fixed', 'top:50%', 'left:50%',
    'transform:translate(-50%,-50%)',
    'background:linear-gradient(135deg,#1e1b4b 0%,#1a1a2e 100%)',
    'border:1px solid rgba(239,68,68,0.5)',
    'border-radius:16px',
    'padding:32px 36px',
    'z-index:99999',
    'min-width:360px',
    'max-width:440px',
    'width:90vw',
    'box-shadow:0 0 0 1px rgba(239,68,68,0.2), 0 24px 64px rgba(0,0,0,0.7)',
    'text-align:center',
    'animation:usbPopupIn 0.3s cubic-bezier(0.34,1.56,0.64,1)',
    'font-family:inherit'
  ].join(';');

  const fsLabel = fs && fs !== 'UNKNOWN' ? ` (${fs})` : '';
  popup.innerHTML = `
    <style>
      @keyframes usbPopupIn {
        from { opacity:0; transform:translate(-50%,-50%) scale(0.85); }
        to   { opacity:1; transform:translate(-50%,-50%) scale(1); }
      }
      #usbBlockedPopup .usb-icon-wrap {
        width:64px; height:64px; border-radius:50%;
        background:rgba(239,68,68,0.15);
        border:2px solid rgba(239,68,68,0.4);
        display:flex; align-items:center; justify-content:center;
        margin:0 auto 16px;
        font-size:28px;
      }
      #usbBlockedPopup h3 {
        color:#f87171; font-size:18px; font-weight:700;
        margin:0 0 8px; letter-spacing:-0.3px;
      }
      #usbBlockedPopup .usb-drive-badge {
        display:inline-flex; align-items:center; gap:6px;
        background:rgba(239,68,68,0.12); border:1px solid rgba(239,68,68,0.3);
        border-radius:8px; padding:5px 14px;
        color:#fca5a5; font-size:14px; font-weight:600;
        margin:0 0 14px;
      }
      #usbBlockedPopup .usb-desc {
        color:rgba(255,255,255,0.6); font-size:13px;
        line-height:1.6; margin:0 0 16px;
      }
      #usbBlockedPopup .usb-reason-label {
        display:block; text-align:left;
        color:rgba(255,255,255,0.8); font-size:13px; font-weight:600;
        margin-bottom:8px;
      }
      #usbBlockedPopup .usb-reason-label span {
        color:#f87171; margin-left:2px;
      }
      #usbBlockedPopup #usbReasonInput {
        width:100%; box-sizing:border-box;
        background:rgba(255,255,255,0.07);
        border:1px solid rgba(255,255,255,0.2);
        border-radius:10px; padding:11px 14px;
        color:#fff; font-size:13.5px; font-family:inherit;
        resize:none; line-height:1.5;
        transition:border-color 0.2s;
        outline:none;
      }
      #usbBlockedPopup #usbReasonInput:focus {
        border-color:rgba(139,92,246,0.7);
        background:rgba(139,92,246,0.08);
      }
      #usbBlockedPopup #usbReasonInput::placeholder { color:rgba(255,255,255,0.3); }
      #usbBlockedPopup .usb-char-count {
        text-align:right; font-size:11.5px;
        color:rgba(255,255,255,0.35); margin:5px 0 16px;
      }
      #usbBlockedPopup .usb-btn-row {
        display:flex; gap:10px;
      }
      #usbBlockedPopup .usb-cancel-btn {
        flex:1; background:rgba(255,255,255,0.07);
        color:rgba(255,255,255,0.6); border:1px solid rgba(255,255,255,0.15);
        border-radius:10px; padding:11px 0; font-size:13.5px; font-weight:600;
        cursor:pointer; transition:background 0.2s;
      }
      #usbBlockedPopup .usb-cancel-btn:hover { background:rgba(255,255,255,0.12); }
      #usbBlockedPopup .usb-submit-btn {
        flex:2; background:linear-gradient(135deg,#7c3aed,#4f46e5);
        color:#fff; border:none; border-radius:10px;
        padding:11px 0; font-size:13.5px; font-weight:700;
        cursor:pointer; transition:opacity 0.2s;
      }
      #usbBlockedPopup .usb-submit-btn:disabled {
        opacity:0.35; cursor:not-allowed;
      }
      #usbBlockedPopup .usb-submit-btn:not(:disabled):hover { opacity:0.85; }
      #usbBlockedPopup .usb-success-msg {
        display:none; color:#4ade80; font-size:14px; font-weight:600;
        margin-top:14px;
      }
    </style>
    <div class="usb-icon-wrap">🔌</div>
    <h3>USB 연결이 차단되었습니다</h3>
    <div class="usb-drive-badge">📁 드라이브 ${escHtml(drive)}:${escHtml(fsLabel)}</div>
    <p class="usb-desc">보안 정책에 의해 이 USB 장치의 접근이 차단되었습니다.<br>아래에 사용 사유를 입력하면 관리자에게 승인 요청이 전송됩니다.</p>
    <label class="usb-reason-label">사용 사유 입력<span>*</span></label>
    <textarea id="usbReasonInput" rows="3" maxlength="200"
      placeholder="예) 7월 영업실적 파일 백업 / 외부업체 자료 수령 등"></textarea>
    <div class="usb-char-count"><span id="usbReasonCount">0</span>/200</div>
    <div class="usb-btn-row">
      <button class="usb-cancel-btn" onclick="closeUsbBlockedPopup()">닫기</button>
      <button class="usb-submit-btn" id="usbSubmitBtn" disabled
        onclick="submitUsbApprovalReason('${escHtml(drive)}','${escHtml(fs||'')}')">
        승인 요청 전송
      </button>
    </div>
    <div class="usb-success-msg" id="usbSuccessMsg">✅ 승인 요청이 관리자에게 전송되었습니다!</div>
  `;

  // 배경 오버레이
  const overlay = document.createElement('div');
  overlay.id = 'usbBlockedOverlay';
  overlay.style.cssText = [
    'position:fixed', 'inset:0',
    'background:rgba(0,0,0,0.6)',
    'z-index:99998',
    'backdrop-filter:blur(4px)'
  ].join(';');

  document.body.appendChild(overlay);
  document.body.appendChild(popup);

  // 글자 수 카운터 및 버튼 활성화
  const textarea = document.getElementById('usbReasonInput');
  const submitBtn = document.getElementById('usbSubmitBtn');
  const countEl = document.getElementById('usbReasonCount');
  if (textarea) {
    textarea.addEventListener('input', () => {
      const len = textarea.value.trim().length;
      countEl.textContent = textarea.value.length;
      submitBtn.disabled = len < 5;
    });
    setTimeout(() => textarea.focus(), 100);
  }
}

async function submitUsbApprovalReason(drive, fs) {
  const textarea = document.getElementById('usbReasonInput');
  const submitBtn = document.getElementById('usbSubmitBtn');
  const successMsg = document.getElementById('usbSuccessMsg');
  if (!textarea) return;

  const reason = textarea.value.trim();
  if (!reason || reason.length < 5) return;

  submitBtn.disabled = true;
  submitBtn.textContent = '전송 중...';

  try {
    await window.electronAPI.submitUsbApproval({ drive, fs, reason });
    if (successMsg) successMsg.style.display = 'block';
    submitBtn.textContent = '전송 완료';
    textarea.disabled = true;
    setTimeout(closeUsbBlockedPopup, 2500);
  } catch (e) {
    submitBtn.disabled = false;
    submitBtn.textContent = '승인 요청 전송';
    alert('전송에 실패했습니다. 다시 시도해 주세요.');
  }
}



function closeUsbBlockedPopup() {
  const popup = document.getElementById('usbBlockedPopup');
  const overlay = document.getElementById('usbBlockedOverlay');
  if (popup) popup.remove();
  if (overlay) overlay.remove();
}

// 모달 오버레이 클릭으로 닫기
document.addEventListener('click', e => {
  if (e.target.classList.contains('modal-overlay')) {
    e.target.style.display = 'none';
  }
});

// ─── 토스트 ───
function showToast(msg, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${icons[type] || 'ℹ️'}</span><span>${escHtml(msg)}</span>`;
  container.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; toast.style.transform = 'translateX(30px)'; toast.style.transition = 'all 0.3s'; setTimeout(() => toast.remove(), 300); }, 3000);
}

// ─── 유틸 ───
function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function logIcon(type) {
  const icons = { blocked: '🚫', allowed: '✅', warning: '⚠️' };
  return icons[type] || '📋';
}

function formatTime(iso) {
  if (!iso) return '-';
  try {
    const d = new Date(iso);
    return d.toLocaleString(currentLang === 'ko' ? 'ko-KR' : 'en-US', { dateStyle: 'short', timeStyle: 'short' });
  } catch(e) { return iso; }
}

function formatDate(iso) {
  if (!iso) return '-';
  try { return new Date(iso).toLocaleDateString(currentLang === 'ko' ? 'ko-KR' : 'en-US'); }
  catch(e) { return iso; }
}

// ─── 대시보드 주기적 갱신 ───
function startDashboardRefresh() {
  setInterval(() => {
    if (currentTab === 'dashboard') renderDashboard();
  }, 30000);
}

// ─── 샘플 로그 (초기) ───
async function injectSampleLogs() {
  const logs = allConfig.securityLogs || [];
  if (logs.length === 0) {
    const samples = [
      { type: 'blocked', message: '클립보드 파일 복사 시도 차단: report_q1.xlsx' },
      { type: 'blocked', message: '외부 메일 첨부 전송 차단: unknown@external.com' },
      { type: 'warning', message: '화면 캡처 프로그램 감지: ShareX.exe' },
    ];
    for (const s of samples) {
      logs.push({ ...s, id: Date.now().toString() + Math.random(), timestamp: new Date(Date.now() - Math.random() * 86400000).toISOString() });
    }
    allConfig.securityLogs = logs;
    if (window.electronAPI) await window.electronAPI.setStore('securityLogs', logs);
  }
}

// ─── 앱 시작 ───
document.addEventListener('DOMContentLoaded', async () => {
  await init();
});

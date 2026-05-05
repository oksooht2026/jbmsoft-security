// app.js - 메인 애플리케이션 로직
'use strict';

// ─── 상태 변수 ───
let currentTab = 'dashboard';
let allConfig = {};
let logPage = 1;
const LOG_PER_PAGE = 30;
let filteredLogs = [];
let approvalFilter = 'all';
let pendingAuthAction = null;

// 샘플 사용자 데이터 (실제 구현 시 DB 연동)
let users = [
  { id: 1, name: '김관리', dept: '정보보안팀', role: 'admin', email: 'kim@jbmsoft.com', lastLogin: '2025-04-22 14:30', status: 'active' },
  { id: 2, name: '이철수', dept: '개발팀', role: 'user', email: 'lee@jbmsoft.com', lastLogin: '2025-04-22 09:15', status: 'active' },
  { id: 3, name: '박영희', dept: '영업팀', role: 'user', email: 'park@jbmsoft.com', lastLogin: '2025-04-21 17:50', status: 'active' },
  { id: 4, name: '최민준', dept: '재무팀', role: 'user', email: 'choi@jbmsoft.com', lastLogin: '2025-04-20 11:00', status: 'inactive' },
];

// ─── 초기화 ───
async function init() {
  try {
    if (window.electronAPI) {
      allConfig = await window.electronAPI.getAllStore();
      const savedLang = allConfig.language || 'ko';
      currentLang = savedLang;
      document.getElementById('btnKo').classList.toggle('active', savedLang === 'ko');
      document.getElementById('btnEn').classList.toggle('active', savedLang === 'en');
    } else {
      // 브라우저 테스트 폴백
      allConfig = getDefaultConfig();
    }
  } catch(e) {
    allConfig = getDefaultConfig();
  }

  applyTranslations();
  await loadSystemInfo();
  loadSettingsToUI();
  renderDashboard();
  renderUserTable();
  renderPCTable();
  renderApprovals();
  renderLogs();
  renderNetworkIfaces();
  setupIpcListeners();
  startDashboardRefresh();

  // SVG 그라디언트 주입
  injectSVGDefs();
}

function getDefaultConfig() {
  return {
    language: 'ko',
    adminPassword: null,
    security: {
      fileGuard: true,
      clipboardGuard: true,
      mailGuard: true,
      usbGuard: false,
      autoLockMinutes: 30,
      blockedExtensions: ['exe', 'bat', 'cmd', 'ps1', 'sh'],
      watchedFolders: []
    },
    network: {
      smtpPorts: [25, 465, 587],
      emailWhitelist: [],
      blockCloudUpload: false
    },
    trustedPCs: [],
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
      <stop offset="0%" style="stop-color:#3b82f6"/>
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
    renderThisPC(info);
  } catch(e) {}
}

function renderThisPC(info) {
  const el = document.getElementById('thisPCInfo');
  if (!el || !info) return;
  const fields = [
    { label: 'PC Name', value: info.hostname },
    { label: 'Username', value: info.username },
    { label: 'Platform', value: info.platform + ' / ' + info.arch },
    { label: 'CPU Cores', value: info.cpus + ' cores' },
    { label: 'Memory', value: info.totalMem },
    ...( info.networkInterfaces || []).map(n => ({
      label: n.name + ' (IP)', value: n.address
    })),
    ...( info.networkInterfaces || []).map(n => ({
      label: n.name + ' (MAC)', value: n.mac
    }))
  ];
  el.innerHTML = fields.map(f => `
    <div class="info-card">
      <div class="info-card-label">${f.label}</div>
      <div class="info-card-value">${f.value}</div>
    </div>`).join('');
}

// ─── 설정 → UI 로드 ───
function loadSettingsToUI() {
  const sec = allConfig.security || {};
  const net = allConfig.network || {};

  // 파일 보안
  setToggle('toggleClipboard', sec.clipboardGuard !== false);
  setToggle('toggleFileGuard', sec.fileGuard !== false);
  setToggle('toggleUSB', sec.usbGuard === true);
  setToggle('togglePrintGuard', sec.printGuard !== false);

  // 잠금
  const lockSlider = document.getElementById('autoLockSlider');
  if (lockSlider) {
    lockSlider.value = sec.autoLockMinutes || 30;
    updateAutoLock(lockSlider.value);
  }

  // 확장자 태그
  renderExtTags(sec.blockedExtensions || ['exe', 'bat', 'cmd', 'ps1', 'sh']);

  // 감시 폴더
  renderWatchFolders(sec.watchedFolders || []);

  // 네트워크
  setToggle('toggleMailGuard', net.mailGuard !== false);
  setToggle('toggleCloud', net.blockCloudUpload === true);
  const smtpEl = document.getElementById('smtpPorts');
  if (smtpEl) smtpEl.value = (net.smtpPorts || [25, 465, 587]).join(', ');

  // 이메일 화이트리스트
  renderEmailWhitelist(net.emailWhitelist || []);
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
}

// ─── 대시보드 렌더링 ───
function renderDashboard() {
  const trustedPCs = allConfig.trustedPCs || [];
  const logs = allConfig.securityLogs || [];
  const approvals = allConfig.approvalRequests || [];
  const pending = approvals.filter(r => r.status === 'pending');
  const whitelist = (allConfig.network || {}).emailWhitelist || [];

  // 통계
  const blocked = logs.filter(l => l.type === 'blocked' && isToday(l.timestamp)).length;
  document.getElementById('statBlocked').textContent = blocked;
  document.getElementById('statPCs').textContent = trustedPCs.length;
  document.getElementById('statPending').textContent = pending.length;
  document.getElementById('statWhitelist').textContent = whitelist.length;

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

  // PC 현황
  renderDashPCGrid(trustedPCs);
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
  if (!sec.printGuard) score -= 5;
  const pcs = (allConfig.trustedPCs || []).length;
  if (pcs === 0) score -= 5;
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
    { name: t('fs_print_guard'), on: sec.printGuard !== false },
    { name: t('net_cloud_block'), on: net.blockCloudUpload === true },
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

function renderDashPCGrid(pcs) {
  const el = document.getElementById('dashPcGrid');
  if (!el) return;
  if (!pcs.length) { el.innerHTML = `<div class="empty-state">${t('no_pcs')}</div>`; return; }
  el.innerHTML = pcs.map(pc => `
    <div class="pc-mini-card online">
      <div class="pc-dot"></div>
      <span>🖥 ${escHtml(pc.name)}</span>
      <span style="color:var(--text-muted);font-size:11px;font-family:monospace">${escHtml(pc.ip || '-')}</span>
    </div>`).join('');
}

// ─── 사용자 테이블 ───
function renderUserTable() {
  const tbody = document.getElementById('userTableBody');
  if (!tbody) return;
  tbody.innerHTML = users.map(u => `
    <tr>
      <td>${escHtml(u.name)}</td>
      <td>${escHtml(u.dept)}</td>
      <td><span class="badge ${u.role === 'admin' ? 'badge-blue' : 'badge-gray'}">${u.role === 'admin' ? t('role_admin') : t('role_user')}</span></td>
      <td style="font-family:monospace;font-size:12px">${u.lastLogin}</td>
      <td><span class="badge ${u.status === 'active' ? 'badge-green' : 'badge-gray'}">${u.status === 'active' ? '활성' : '비활성'}</span></td>
      <td>
        <button class="btn-outline btn-sm" onclick="toggleUserStatus(${u.id})">${u.status === 'active' ? '비활성화' : '활성화'}</button>
        <button class="btn-danger btn-sm" style="margin-left:4px" onclick="removeUser(${u.id})">삭제</button>
      </td>
    </tr>`).join('') || `<tr><td colspan="6" class="empty-state">사용자 없음</td></tr>`;
}

function openAddUserModal() { openModal('modalAddUser'); }
function confirmAddUser() {
  const name = document.getElementById('addUserName').value.trim();
  const dept = document.getElementById('addUserDept').value.trim();
  const role = document.getElementById('addUserRole').value;
  const email = document.getElementById('addUserEmail').value.trim();
  if (!name || !dept || !email) { showToast(t('toast_fill_all'), 'error'); return; }
  users.push({ id: Date.now(), name, dept, role, email, lastLogin: '-', status: 'active' });
  renderUserTable();
  closeModal('modalAddUser');
  showToast(t('toast_user_added'), 'success');
  document.getElementById('addUserName').value = '';
  document.getElementById('addUserDept').value = '';
  document.getElementById('addUserEmail').value = '';
}

function toggleUserStatus(id) {
  const u = users.find(x => x.id === id);
  if (u) { u.status = u.status === 'active' ? 'inactive' : 'active'; renderUserTable(); }
}

function removeUser(id) {
  users = users.filter(x => x.id !== id);
  renderUserTable();
}

// ─── 파일 보안 설정 저장 ───
function saveSecurity() {
  const sec = {
    fileGuard: document.getElementById('toggleFileGuard')?.checked,
    clipboardGuard: document.getElementById('toggleClipboard')?.checked,
    usbGuard: document.getElementById('toggleUSB')?.checked,
    printGuard: document.getElementById('togglePrintGuard')?.checked,
    autoLockMinutes: parseInt(document.getElementById('autoLockSlider')?.value || 30),
    blockedExtensions: getExtTags(),
    watchedFolders: getWatchFolders()
  };
  allConfig.security = sec;
  if (window.electronAPI) window.electronAPI.setStore('security', sec);
  renderDashboard();
}

function saveNetwork() {
  const net = {
    mailGuard: document.getElementById('toggleMailGuard')?.checked,
    blockCloudUpload: document.getElementById('toggleCloud')?.checked,
    smtpPorts: document.getElementById('smtpPorts')?.value.split(',').map(p => parseInt(p.trim())).filter(Boolean) || [25,465,587],
    emailWhitelist: getEmailWhitelist()
  };
  allConfig.network = net;
  if (window.electronAPI) window.electronAPI.setStore('network', net);
  renderDashboard();
  showToast(t('toast_saved'), 'success');
}

// ─── 확장자 태그 ───
let extTags = ['exe', 'bat', 'cmd', 'ps1', 'sh'];

function renderExtTags(tags) {
  extTags = tags;
  const el = document.getElementById('extTagArea');
  if (!el) return;
  el.innerHTML = extTags.map(ext => `
    <span class="tag">
      .${escHtml(ext)}
      <button class="tag-remove" onclick="removeExt('${escHtml(ext)}')" title="제거">✕</button>
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
  if (window.electronAPI) {
    // Electron에서는 dialog 사용 (메인 프로세스로 IPC 필요)
    const path = prompt('감시할 폴더 경로를 입력하세요:', 'C:\\Users\\');
    if (path && path.trim()) {
      const folders = allConfig.security?.watchedFolders || [];
      folders.push(path.trim());
      allConfig.security = { ...(allConfig.security || {}), watchedFolders: folders };
      await window.electronAPI.setStore('security', allConfig.security);
      renderWatchFolders(folders);
    }
  }
}

function removeWatchFolder(idx) {
  const folders = allConfig.security?.watchedFolders || [];
  folders.splice(idx, 1);
  allConfig.security = { ...(allConfig.security || {}), watchedFolders: folders };
  if (window.electronAPI) window.electronAPI.setStore('security', allConfig.security);
  renderWatchFolders(folders);
}

function getWatchFolders() { return allConfig.security?.watchedFolders || []; }

// ─── 이메일 화이트리스트 ───
let emailWhitelist = [];

function renderEmailWhitelist(list) {
  emailWhitelist = list;
  const el = document.getElementById('emailWhitelistArea');
  if (!el) return;
  if (!emailWhitelist.length) {
    el.innerHTML = `<div style="color:var(--text-muted);font-size:12px;padding:8px 0">${currentLang === 'ko' ? '화이트리스트 없음' : 'No whitelist entries'}</div>`;
    return;
  }
  el.innerHTML = emailWhitelist.map((e, i) => `
    <div class="whitelist-item">
      <span>✉️ ${escHtml(e)}</span>
      <button onclick="removeEmailWhitelist(${i})">✕</button>
    </div>`).join('');
}

function addEmailWhitelist() {
  const inp = document.getElementById('emailInput');
  if (!inp) return;
  const val = inp.value.trim().toLowerCase();
  if (val && !emailWhitelist.includes(val)) {
    emailWhitelist.push(val);
    renderEmailWhitelist(emailWhitelist);
    allConfig.network = { ...(allConfig.network || {}), emailWhitelist };
    if (window.electronAPI) window.electronAPI.setStore('network', allConfig.network);
    renderDashboard();
  }
  inp.value = '';
}

function removeEmailWhitelist(idx) {
  emailWhitelist.splice(idx, 1);
  renderEmailWhitelist(emailWhitelist);
  allConfig.network = { ...(allConfig.network || {}), emailWhitelist };
  if (window.electronAPI) window.electronAPI.setStore('network', allConfig.network);
  renderDashboard();
}

function getEmailWhitelist() { return emailWhitelist; }

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

// ─── 허용 PC 관리 ───
function renderPCTable() {
  const pcs = allConfig.trustedPCs || [];
  const tbody = document.getElementById('pcTableBody');
  const emptyState = document.getElementById('pcEmptyState');
  if (!tbody) return;

  if (!pcs.length) {
    tbody.innerHTML = '';
    if (emptyState) emptyState.style.display = 'block';
    return;
  }
  if (emptyState) emptyState.style.display = 'none';

  tbody.innerHTML = pcs.map((pc, i) => `
    <tr>
      <td>🖥 ${escHtml(pc.name)}</td>
      <td style="font-family:monospace;font-size:12px">${escHtml(pc.ip || '-')}</td>
      <td style="font-family:monospace;font-size:12px">${escHtml(pc.mac || '-')}</td>
      <td>${escHtml(pc.dept || '-')}</td>
      <td style="font-size:12px;font-family:monospace">${formatDate(pc.addedAt)}</td>
      <td><span class="badge badge-green">허용</span></td>
      <td>
        <button class="btn-danger btn-sm" onclick="removePC(${i})">삭제</button>
      </td>
    </tr>`).join('');
  renderDashboard();
}

function filterPCs(query) {
  const pcs = allConfig.trustedPCs || [];
  const tbody = document.getElementById('pcTableBody');
  if (!tbody) return;
  const filtered = query ? pcs.filter(p =>
    p.name.toLowerCase().includes(query.toLowerCase()) ||
    (p.ip || '').includes(query) ||
    (p.dept || '').toLowerCase().includes(query.toLowerCase())
  ) : pcs;

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-state">${t('no_pcs')}</td></tr>`;
    return;
  }
  tbody.innerHTML = filtered.map((pc, i) => `
    <tr>
      <td>🖥 ${escHtml(pc.name)}</td>
      <td style="font-family:monospace;font-size:12px">${escHtml(pc.ip || '-')}</td>
      <td style="font-family:monospace;font-size:12px">${escHtml(pc.mac || '-')}</td>
      <td>${escHtml(pc.dept || '-')}</td>
      <td style="font-size:12px;font-family:monospace">${formatDate(pc.addedAt)}</td>
      <td><span class="badge badge-green">허용</span></td>
      <td><button class="btn-danger btn-sm" onclick="removePC(${i})">삭제</button></td>
    </tr>`).join('');
}

function openAddPCModal() { openModal('modalAddPC'); }
async function confirmAddPC() {
  const name = document.getElementById('addPCName').value.trim();
  const ip   = document.getElementById('addPCIP').value.trim();
  const mac  = document.getElementById('addPCMAC').value.trim();
  const dept = document.getElementById('addPCDept').value.trim();
  if (!name) { showToast(t('toast_fill_all'), 'error'); return; }

  const pcs = allConfig.trustedPCs || [];
  pcs.push({ name, ip, mac, dept, addedAt: new Date().toISOString() });
  allConfig.trustedPCs = pcs;
  if (window.electronAPI) await window.electronAPI.setStore('trustedPCs', pcs);

  renderPCTable();
  closeModal('modalAddPC');
  showToast(t('toast_pc_added'), 'success');
  ['addPCName','addPCIP','addPCMAC','addPCDept'].forEach(id => { const el = document.getElementById(id); if(el) el.value = ''; });

  // 로그 추가
  addSecLog('allowed', `PC 등록: ${name} (${ip})`);
}

async function removePC(idx) {
  const pcs = allConfig.trustedPCs || [];
  const removed = pcs.splice(idx, 1)[0];
  allConfig.trustedPCs = pcs;
  if (window.electronAPI) await window.electronAPI.setStore('trustedPCs', pcs);
  renderPCTable();
  showToast(t('toast_pc_removed'), 'warning');
  addSecLog('warning', `PC 삭제: ${removed?.name}`);
}

async function registerThisPC() {
  if (!window.electronAPI) return;
  const info = await window.electronAPI.getSystemInfo();
  const iface = (info.networkInterfaces || [])[0] || {};
  const pcs = allConfig.trustedPCs || [];
  const exists = pcs.find(p => p.name === info.hostname);
  if (exists) { showToast('이미 등록된 PC입니다', 'warning'); return; }
  pcs.push({
    name: info.hostname,
    ip: iface.address || '',
    mac: iface.mac || '',
    dept: info.username,
    addedAt: new Date().toISOString()
  });
  allConfig.trustedPCs = pcs;
  await window.electronAPI.setStore('trustedPCs', pcs);
  renderPCTable();
  showToast(t('toast_pc_added'), 'success');
}

function unlockUninstall() {
  pendingAuthAction = 'uninstall';
  openModal('modalAdminAuth');
  setTimeout(() => document.getElementById('authPwInput')?.focus(), 100);
}
  
async function saveNickname() {
  const nickname = document.getElementById('pcNickname').value.trim();
  if (!nickname) { showToast(t('toast_fill_all') || '닉네입을 입력해주세요', 'error'); return; }
  
  allConfig.pcNickname = nickname;
  if (window.electronAPI) await window.electronAPI.setStore('pcNickname', nickname);
  showToast('닉네임이 저장되었습니다.', 'success');
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

function updateAutoLock(val) {
  const el = document.getElementById('autoLockValue');
  if (el) el.textContent = val + (currentLang === 'ko' ? '분' : 'min');
}

// ─── 관리자 승인 ───
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

  el.innerHTML = filtered.map(r => `
    <div class="approval-card ${r.status}">
      <span class="approval-icon">${r.status === 'pending' ? '📤' : r.status === 'approved' ? '✅' : '❌'}</span>
      <div class="approval-info">
        <div class="approval-filename">📄 ${escHtml(r.filename || '(파일 없음)')}</div>
        <div class="approval-meta">${currentLang === 'ko' ? '수신자' : 'To'}: ${escHtml(r.recipient || '-')} | ${currentLang === 'ko' ? '요청자' : 'From'}: ${escHtml(r.requester || 'Unknown')}</div>
        <div class="approval-time">${formatTime(r.timestamp)}</div>
      </div>
      <div class="approval-status">
        <span class="badge ${r.status === 'pending' ? 'badge-yellow' : r.status === 'approved' ? 'badge-green' : 'badge-red'}">
          ${r.status === 'pending' ? (currentLang === 'ko' ? '대기' : 'Pending') : r.status === 'approved' ? (currentLang === 'ko' ? '승인' : 'Approved') : (currentLang === 'ko' ? '거부' : 'Rejected')}
        </span>
      </div>
      ${r.status === 'pending' ? `
      <div class="approval-actions">
        <button class="btn-success btn-sm" onclick="handleApproval('${r.id}', true)">${t('btn_approve')}</button>
        <button class="btn-danger btn-sm" onclick="handleApproval('${r.id}', false)">${t('btn_reject')}</button>
      </div>` : ''}
    </div>`).join('');
}

function filterApprovals(filter) {
  approvalFilter = filter;
  document.querySelectorAll('.filter-tab').forEach((btn, i) => {
    const filters = ['all','pending','approved','rejected'];
    btn.classList.toggle('active', filters[i] === filter);
  });
  renderApprovals(filter);
}

async function handleApproval(id, approved) {
  const requests = allConfig.approvalRequests || [];
  const idx = requests.findIndex(r => r.id === id);
  if (idx !== -1) {
    requests[idx].status = approved ? 'approved' : 'rejected';
    requests[idx].resolvedAt = new Date().toISOString();
    allConfig.approvalRequests = requests;
    if (window.electronAPI) await window.electronAPI.handleApproval(id, approved);
  }
  showToast(approved ? t('toast_approved') : t('toast_rejected'), approved ? 'success' : 'error');
  addSecLog(approved ? 'allowed' : 'blocked',
    `${approved ? (currentLang === 'ko' ? '파일 전송 승인' : 'File transfer approved') : (currentLang === 'ko' ? '파일 전송 거부' : 'File transfer rejected')}: ${requests[idx]?.filename}`
  );
  renderApprovals();
  renderDashboard();
}

async function addTestRequest() {
  const filename = document.getElementById('testFileName').value.trim() || 'report_2025.xlsx';
  const recipient = document.getElementById('testRecipient').value.trim() || 'partner@external.com';
  const req = {
    id: Date.now().toString(),
    filename,
    recipient,
    requester: '이철수 (개발팀)',
    timestamp: new Date().toISOString(),
    status: 'pending'
  };
  const requests = allConfig.approvalRequests || [];
  requests.unshift(req);
  allConfig.approvalRequests = requests;
  if (window.electronAPI) await window.electronAPI.addApprovalRequest(req);
  renderApprovals();
  renderDashboard();
  showToast(currentLang === 'ko' ? '승인 요청이 추가되었습니다' : 'Approval request added', 'info');
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
  
  // 닉네임 로드
  if (allConfig.pcNickname) {
      setTimeout(() => {
          const el = document.getElementById('pcNickname');
          if (el) el.value = allConfig.pcNickname;
      }, 500);
  }
}

async function confirmAuth() {
  const pw = document.getElementById('authPwInput')?.value || '';
  const stored = allConfig.adminPassword;
  if (!stored) {
    showToast(currentLang === 'ko' ? '먼저 비밀번호를 설정하세요' : 'Please set a password first', 'error');
    return;
  }
  if (pw !== stored) {
    showToast(currentLang === 'ko' ? '비밀번호가 올바르지 않습니다' : 'Incorrect password', 'error');
    return;
  }
  closeModal('modalAdminAuth');
  document.getElementById('authPwInput').value = '';
  
  if (pendingAuthAction === 'quit') {
    if (window.electronAPI) window.electronAPI.quitApp();
  } else if (pendingAuthAction === 'pause') {
    showToast('보안 감시가 일시 중지되었습니다. (주의: 재시작 시 자동 활성화됩니다)', 'warning');
    // 실제 pause 로직을 구현할 수 있습니다 (IPC 전달)
  } else if (pendingAuthAction === 'uninstall') {
    if (window.electronAPI) {
        const success = await window.electronAPI.allowUninstall(true);
        if (success) {
            showToast('삭제 보호가 해제되었습니다. 이제 프로그램 추가/제거에서 삭제할 수 있습니다. (PC 재부팅 시 다시 보호됨)', 'warning');
        } else {
            showToast('레지스트리 접근 실패. 관리자 권한으로 실행 중인지 확인하세요.', 'error');
        }
    }
  }
  
  pendingAuthAction = null;
}

// ─── 모달 유틸 ───
function openModal(id) { const el = document.getElementById(id); if(el) { el.style.display = 'flex'; } }
function closeModal(id) { const el = document.getElementById(id); if(el) { el.style.display = 'none'; } }

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
      { type: 'allowed',  message: 'PC 파일 이동 허용: DESKTOP-DEV01 → DESKTOP-ADM01' },
      { type: 'warning', message: '화면 캡처 프로그램 감지: ShareX.exe' },
      { type: 'allowed',  message: '메일 화이트리스트 전송 허용: partner@jbmsoft.com' },
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
  await injectSampleLogs();
  renderLogs();
  renderDashboard();
});

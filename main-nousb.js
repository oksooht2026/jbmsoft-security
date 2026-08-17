// 옥수하이테크 보안솔루션 - Main Process
const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, shell, dialog, Notification, powerMonitor } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { exec } = require('child_process');
const Store = require('electron-store');
const serverSync = require('./security/server-sync');
const siteBlocker = require('./security/site-blocker');
const osEngine = require('./security/os-engine');
const fileWatcher = require('./security/file-watcher');
const remoteDesktop = require('./security/remote-desktop');
const extensionGuard = require('./security/extension-guard');
const mailGuard = require('./security/mail-guard');
const documentMonitor = require('./security/document-monitor');
const approvalManager = require('./security/approval-manager');
const mailExtensionBridge = require('./security/mail-extension-bridge');
const mailLogQueue = require('./security/mail-log-queue');
const mailNativeRegistry = require('./security/mail-native-registry');
const mailExtensionInstaller = require('./security/mail-extension-installer');
const mailProxyServer = require('./security/mail-proxy-server');


function writeAdminPasswordToRegistry(pwd) {
  if (process.platform !== 'win32') return;
  exec(`reg add "HKCU\\Software\\JBMSOFT_Security" /v "AdminPassword" /t REG_SZ /d "${pwd}" /f`, { windowsHide: true }, (err) => {
    if (err) console.error('[Main] AdminPassword 레지스트리 쓰기 실패:', err.message);
    else console.log('[Main] AdminPassword 레지스트리 동기화 완료');
  });
}

// --- 서버 동기화 상태 ---
let heartbeatInterval = null;
let approvalPollInterval = null;
const SYNC_INTERVAL_MS = 5 * 60 * 1000;   // 5분 — 하트비트 + 정책 버전 확인
const APPROVAL_SYNC_MS = 10 * 1000;       // 10초 — 승인 대기 중일 때만 (승인 반영 가속화)
const SECURITY_START_DELAY_MS = 12 * 1000; // UI 먼저 띄운 뒤 보안 엔진 기동
let pcId = null;       // 서버에서 발급받은 PC UUID
let isPageReady = false; // 페이지 로딩 완료 여부
let isEnginePaused = false; // 보안 엔진 일시 중지 상태

// --- 관리자 권한 체크 및 재실행 ---
function checkAndRelaunchAsAdmin() {
  if (process.platform !== 'win32') return Promise.resolve(true);

  return new Promise((resolve) => {
    exec('fltmc', (err) => {
      if (err) {
        console.log('[Main] 관리자 권한이 없어 재실행을 시도합니다.');
        const exePath = app.getPath('exe');
        let cmd = `Start-Process -FilePath "${exePath}" -Verb RunAs`;
        if (exePath.toLowerCase().includes('electron.exe')) {
          const projDir = __dirname;
          cmd = `Start-Process cmd.exe -ArgumentList "/c cd /d \\"${projDir}\\" && npm start" -Verb RunAs`;
        } else {
          const args = process.argv.slice(1).map(a => `\\"${a}\\"`).join(' ');
          cmd = `Start-Process -FilePath "${exePath}" -ArgumentList "${args}" -Verb RunAs`;
        }

        exec(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${cmd}"`, (rErr) => {
          if (!rErr) {
            app.quit();
            process.exit(0);
            resolve(false);
          } else {
            console.error('[Main] 관리자 권한 재실행 실패:', rErr);
            resolve(true); // 실패 시 일반 권한으로 강제 진행
          }
        });
      } else {
        console.log('[Main] 관리자 권한으로 실행 중입니다.');
        resolve(true);
      }
    });
  });
}

// --- 윈도우 작업 스케줄러를 이용한 UAC 우회 자동 실행 등록 ---
function registerStartupTask() {
  if (process.platform !== 'win32') return;

  const exePath = app.getPath('exe');
  // 개발 모드(electron.exe)인 경우 스케줄러 등록 생략
  if (exePath.toLowerCase().includes('electron.exe')) return;

  const taskName = "OksooSecurityStartupTask";
  const tr = `\\"${exePath}\\" --hidden`;

  // 로그인 시 최고 권한(관리자 권한)으로 자동 실행하는 작업 스케줄러 생성
  const cmd = `schtasks /Create /TN "${taskName}" /SC ONLOGON /TR "${tr}" /RL HIGHEST /F`;

  exec(cmd, { windowsHide: true }, (err, stdout) => {
    if (err) {
      console.error('[Main] Task Scheduler 자동 실행 등록 실패:', err.message);
    } else {
      console.log('[Main] Task Scheduler 자동 실행 등록 성공:', (stdout || '').trim());
      // 스케줄러 등록에 성공했으므로 일반 Run 레지스트리는 중복 실행 방지를 위해 비활성화
      try {
        app.setLoginItemSettings({ openAtLogin: false });
      } catch (_) {}
    }
  });
}

// --- 스토어 초기화 ---
const store = new Store({
  name: 'jbmsoft-security-config',
  defaults: {
    language: 'ko',
    adminPassword: 'oksooht0731',
    security: {
      fileGuard: true,
      clipboardGuard: false,
      mailGuard: true,
      usbGuard: false,
      blockedExtensions: ['exe', 'bat', 'cmd', 'ps1', 'sh', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'pdf', 'hwp', 'dwg', 'dxf', 'dwf'],
      watchedFolders: []
    },
    network: {
      smtpPorts: [25, 465, 587, 993, 995, 110, 143],
      emailWhitelist: [],
      emailBlacklist: [],
      allowedMailServers: [],
      blockWebmail: true
    },
    trustedPCs: [],
    approvalRequests: [],
    securityLogs: [],
    initialized: false
  }
});

let splashWindow = null;
let mainWindow = null;
let tray = null;
let isQuitting = false;
let lastNotificationTime = 0;

function hideToTray() {
  if (!mainWindow) return;
  mainWindow.hide();
  
  const now = Date.now();
  if (now - lastNotificationTime > 5000) {
    lastNotificationTime = now;
    if (Notification.isSupported()) {
      new Notification({
        title: '옥수하이테크 보안솔루션',
        body: '보안 프로그램이 트레이에서 계속 실행 중입니다.',
        icon: path.join(__dirname, 'src', 'assets', 'icons', 'tray-active.png')
      }).show();
    }
  }
}

function isBootHidden() {
  return process.argv.includes('--hidden');
}

// --- 단일 인스턴스 (중복 실행 방지) ---
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
  process.exit(0);
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    // 두 번째 인스턴스가 실행되면 기존 창을 띄우고 포커스
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}


// --- 스플래시 창 생성 ---
function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 560,
    height: 360,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    center: true,
    resizable: false,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  splashWindow.loadFile(path.join(__dirname, 'src', 'splash', 'splash.html'));
  splashWindow.setIgnoreMouseEvents(false);
}

// --- 메인 창 생성 ---
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 780,
    minWidth: 960,
    minHeight: 640,
    frame: false,
    transparent: false,
    center: true,
    show: false,
    icon: path.join(__dirname, 'src', 'assets', 'icons', 'tray-active.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'main-window', 'index.html'));


  mainWindow.webContents.on('did-finish-load', () => {
    isPageReady = true;
    console.log('[Main] 렌더러 페이지 로딩 완료');
  });

  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      hideToTray();
    }
  });

  mainWindow.on('minimize', (e) => {
    e.preventDefault();
    hideToTray();
  });
}

// --- 시스템 트레이 생성 ---
function createTray() {
  const iconPath = path.join(__dirname, 'src', 'assets', 'icons', 'tray-active.png');
  
  // 기본 아이콘 (파일 없을 경우 nativeImage 생성)
  let icon;
  try {
    icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) {
      icon = nativeImage.createEmpty();
    }
  } catch (e) {
    icon = nativeImage.createEmpty();
  }

  tray = new Tray(icon);
  tray.setToolTip('옥수하이테크 보안솔루션 - 보안 활성화 중');

  updateTrayMenu();

  tray.on('double-click', () => {
    showMainWindow();
  });
}

function updateTrayMenu() {
  const lang = store.get('language', 'ko');
  const isKo = lang === 'ko';

  const contextMenu = Menu.buildFromTemplate([
    {
      label: isKo ? '옥수하이테크 보안솔루션' : '옥수하이테크 보안솔루션',
      enabled: false
    },
    { type: 'separator' },
    {
      label: isKo ? '설정 열기' : 'Open Settings',
      icon: null,
      click: () => showMainWindow()
    },
    {
      label: isKo
        ? (isEnginePaused ? '보안 상태: ⏸ 일시 중지' : '보안 상태: ✅ 활성화')
        : (isEnginePaused ? 'Security: ⏸ Paused' : 'Security: ✅ Active'),
      enabled: false
    },
    { type: 'separator' },
    {
      label: isEnginePaused
        ? (isKo ? '보안 재개' : 'Resume Security')
        : (isKo ? '일시 중지 (관리자 인증 필요)' : 'Pause (Admin Auth Required)'),
      click: () => {
        if (isEnginePaused) {
          // 재개는 인증 없이 바로 실행
          osEngine.startEngine(onUsbFileEvent);
          startFileWatcherFromStore();
          // NoUSB 빌드: scanExistingUsbDrives 생략
          isEnginePaused = false;
          updateTrayMenu();
          if (tray) tray.setToolTip('옥수하이테크 보안솔루션 - 보안 활성화 중');
          if (mainWindow && isPageReady) mainWindow.webContents.send('engine-status-change', { isPaused: false });
        } else {
          if (mainWindow) {
            if (!mainWindow.isVisible()) mainWindow.show();
            mainWindow.focus();
            if (isPageReady) {
              mainWindow.webContents.send('show-admin-auth', 'pause');
            } else {
              setTimeout(() => mainWindow.webContents.send('show-admin-auth', 'pause'), 1000);
            }
          }
        }
      }
    },
    { type: 'separator' },
    {
      label: isKo ? '종료' : 'Quit',
      click: () => {
        if (mainWindow) {
          if (!mainWindow.isVisible()) mainWindow.show();
          mainWindow.focus();
          if (isPageReady) {
            mainWindow.webContents.send('show-admin-auth', 'quit');
          } else {
            setTimeout(() => mainWindow.webContents.send('show-admin-auth', 'quit'), 1000);
          }
        }
      }
    }
  ]);

  tray.setContextMenu(contextMenu);
}

function showMainWindow() {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  }
}

// --- 공통 보안 로그 기록 ---
function appendSecurityLog(entry) {
  const logEntry = {
    id: Date.now().toString() + Math.random(),
    type: entry.type || 'warning',
    message: entry.message,
    timestamp: new Date().toISOString()
  };
  const logs = store.get('securityLogs', []);
  logs.unshift(logEntry);
  if (logs.length > 1000) logs.splice(1000);
  store.set('securityLogs', logs);
  if (mainWindow && isPageReady) {
    scheduleSecurityLogUI(logEntry);
  }
  return logEntry;
}

function handleMailExtensionLog(payload) {
  const normalized = mailLogQueue.normalizeExtensionPayload(payload);
  mailLogQueue.enqueue(payload);
  handleGuardEvent({
    type: 'info',
    message: normalized.message,
    details: normalized.details
  });
}

async function startMailExtensionBridge() {
  const userDataPath = app.getPath('userData');
  mailLogQueue.init(userDataPath);

  // 1. Chrome Extension Native Bridge (localhost:38471) 가동
  try {
    await mailExtensionBridge.start({
      userDataPath,
      onLog: handleMailExtensionLog
    });
    console.log('[Main] Chrome Extension Native Bridge 가동 완료');
  } catch (err) {
    console.error('[Main] Mail extension bridge 가동 실패:', err.message);
  }

  // 2. SSL 복호화 로컬 프록시 서버 (포트 38472) 가동
  try {
    await mailProxyServer.start({
      userDataPath,
      onLog: handleMailExtensionLog
    });
    console.log('[Main] SSL 복호화 로컬 프록시 서버(38472) 가동 완료');
  } catch (err) {
    console.warn('[Main] SSL 복호화 프록시 가동 안내:', err.message);
  }

  // 3. 브라우저 확장 프로그램 및 Native Messaging Host 자동 등록 (바로가기 --load-extension 패치 포함)
  try {
    const installDir = path.dirname(app.getPath('exe'));
    mailExtensionInstaller.registerExtension(installDir);
    mailNativeRegistry.registerNativeHost(installDir, userDataPath);
    console.log('[Main] Chrome 확장프로그램 및 Native Host 등록 완료');
  } catch (err) {
    console.warn('[Main] 확장프로그램/Native Host 등록 실패:', err.message);
  }
}

async function stopMailExtensionBridge() {
  await mailLogQueue.flushQueue().catch(() => {});
  mailLogQueue.stopFlushLoop();
  await mailExtensionBridge.stop().catch(() => {});
  await mailProxyServer.stop();
}

function handleGuardEvent(event) {
  appendSecurityLog(event);
  if (!event?.message) return;
  const important = event.type === 'blocked' || event.type === 'warning'
    || event.message.includes('승인') || event.message.includes('차단');
  if (important) {
    showSystemNotification('옥수하이테크 보안', event.message);
  }
}

function syncApprovalToStore(req) {
  const requests = store.get('approvalRequests', []);
  const idx = requests.findIndex(r => r.id === req.id || r.serverId === req.serverId);
  const merged = {
    ...(idx >= 0 ? requests[idx] : {}),
    ...req,
    request_type: req.request_type || approvalManager.parseMeta(req.recipient).type || 'file_transfer'
  };
  if (idx >= 0) requests[idx] = merged;
  else requests.unshift(merged);
  store.set('approvalRequests', requests);

  const pending = requests.filter(r => r.status === 'pending').length;
  if (tray) {
    tray.setToolTip(pending > 0
      ? `옥수하이테크 보안솔루션 - ⚠️ 승인 요청 ${pending}건 대기 중`
      : '옥수하이테크 보안솔루션 - 보안 활성화 중');
  }
  if (mainWindow && isPageReady) {
    mainWindow.webContents.send('approval-update', merged);
  }
}

async function syncApprovalsFromServer() {
  const list = await serverSync.fetchApprovals();
  applyApprovalsList(list);
}

function applyApprovalsList(list) {
  if (!Array.isArray(list)) return;
  approvalManager.processServerApprovals(list);

  const localRequests = store.get('approvalRequests', []);

  list.forEach(srv => {
    if (srv.status !== 'approved') return;

    const type = srv.request_type || approvalManager.parseMeta(srv.recipient || '').type;
    const meta = approvalManager.parseMeta(srv.recipient || (srv.details && srv.details.recipient) || '');

    // TTL 체크: resolved_at 우선, 없으면 timestamp 기준 (30분 이내만 유효)
    const refTime = srv.resolved_at || srv.timestamp || srv.created_at;
    if (refTime && Date.now() - new Date(refTime).getTime() > approvalManager.GRANT_TTL_MS) return;

    // 로컬 요청 목록이 대기 상태인 경우 approved로 갱신하여 UI 및 스토어 동기화
    const localReq = localRequests.find(r => r.serverId === srv.id);
    if (localReq && localReq.status === 'pending') {
      localReq.status = 'approved';
      localReq.resolvedAt = srv.resolved_at || new Date().toISOString();
      store.set('approvalRequests', localRequests);
      if (mainWindow && isPageReady) {
        mainWindow.webContents.send('approval-update', localReq);
      }
    }

    if (type === 'usb_connect') {
      const drive = String(meta.drive || '').replace(':', '').toUpperCase();
      if (!drive) return;
      // 이미 grant 되어 있어도 드라이브가 아직 잠겨있을 수 있으므로 복원 재시도
      if (!approvalManager.isGranted('usb_connect', drive)) {
        approvalManager.grant('usb_connect', drive, meta);
      } else {
        // grant는 있지만 mountvol 복원이 실패했을 수 있으므로 명시적으로 재시도
        osEngine.allowUsbDrive(drive).catch(() => {});
      }
    } else if (type === 'usb_file_transfer' || type === 'file_transfer') {
      const fileKey = meta.filePath || meta.filename;
      if (!fileKey) return;
      
      const grantType = type === 'usb_file_transfer' ? 'usb_file_transfer' : 'file_transfer';
      if (!approvalManager.isGranted(grantType, fileKey)) {
        approvalManager.grant(grantType, fileKey, meta);
      }

      // 서버 승인 반영 시 격리된 파일이 아직 복원되지 않았다면 복원 수행
      if (meta.quarantinedTo && meta.filePath && fs.existsSync(meta.quarantinedTo)) {
        try {
          fs.mkdirSync(path.dirname(meta.filePath), { recursive: true });
          fs.renameSync(meta.quarantinedTo, meta.filePath);
          console.log(`[Main Sync] 격리 파일 복원 성공: ${meta.filePath}`);
          appendSecurityLog({ type: 'allowed', message: `[승인 복원] ${path.basename(meta.filePath)} 파일 복원 완료` });
          showSystemNotification('✅ 파일 복원 완료', `${path.basename(meta.filePath)} 파일이 정상 복원되었습니다.`);
        } catch (e) {
          console.warn('[Main Sync] 격리 파일 복원 실패:', e.message);
        }
      }
    }
  });

  const local = store.get('approvalRequests', []);
  const byServerId = new Map(local.filter(r => r.serverId).map(r => [r.serverId, r]));
  const updatedRequests = [...local];
  const serverIdSet = new Set(list.map(s => s.id).filter(Boolean));

  list.forEach(srv => {
    const norm = approvalManager.normalizeServerApproval(srv);
    if (byServerId.has(srv.id)) {
      const prev = byServerId.get(srv.id);
      if (prev.status !== norm.status) {
        Object.assign(prev, norm);
        if (mainWindow && isPageReady) {
          mainWindow.webContents.send('approval-update', norm);
        }
      }
    } else {
      updatedRequests.push(norm);
      if (mainWindow && isPageReady) {
        mainWindow.webContents.send('approval-update', norm);
      }
    }
  });

  // 서버 응답에서 사라진 serverId 항목 정리
  const cleaned = updatedRequests.filter(r => !r.serverId || serverIdSet.has(r.serverId));
  // 최신 순 정렬
  cleaned.sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));

  store.set('approvalRequests', cleaned.slice(0, 200));
}

function applyServerPolicy(policy) {
  if (!policy) return;

  osEngine.updateEnginePolicy(policy);


  let sitesToBlock = policy.blockedSites || policy.blocked_sites || [];
  if (sitesToBlock.length === 0) {
    sitesToBlock = ['pornhub.com', 'ilbe.com', 'torrentwal.com'];
  }

  let net = store.get('network') || {};
  if (policy.email_whitelist) net.emailWhitelist = policy.email_whitelist;
  if (policy.email_blacklist) net.emailBlacklist = policy.email_blacklist;
  if (policy.allowed_mail_servers) net.allowedMailServers = policy.allowed_mail_servers;
  if (policy.smtp_ports) net.smtpPorts = policy.smtp_ports;
  if (policy.groupware_domains) net.groupwareDomains = policy.groupware_domains;
  store.set('network', net);

  mailGuard.updatePolicy(net, isMailGuardEnabled() && policy.mail_blocking_enabled === true);
  store.set('blockedSites', sitesToBlock);
  applySiteBlocking(sitesToBlock);

  if (policy.admin_password) {
    store.set('adminPassword', policy.admin_password);
    writeAdminPasswordToRegistry(policy.admin_password);
  }

  let sec = store.get('security') || {};
  if (policy.clipboard_monitoring_enabled !== undefined) sec.clipboardGuard = policy.clipboard_monitoring_enabled;
  if (policy.process_monitoring_enabled !== undefined) sec.fileGuard = policy.process_monitoring_enabled;

  if (policy.mail_blocking_enabled !== undefined) {
    sec.mailGuard = isMailGuardEnabled() && policy.mail_blocking_enabled === true;
  }
  // NoUSB 빌드: USB 차단은 항상 false로 고정
  sec.usbGuard = false;
  if (policy.blocked_extensions) {
    sec.blockedExtensions = policy.blocked_extensions;
    fileWatcher.updateBlockedExtensions(policy.blocked_extensions);
    extensionGuard.updatePolicy({
      blocked_extensions: policy.blocked_extensions,
      usb_blocking_enabled: false
    });
    if (sec.fileGuard !== false && policy.blocked_extensions.length > 0) {
      const folders = extensionGuard.getWatchFolders(sec.watchedFolders);
      fileWatcher.startWatching(folders, onFileEvent, onBlockedFileDetected);
    }
  }
  store.set('security', sec);

  if (policy.relay_url !== undefined) {
    remoteDesktop.setRelayUrl(typeof policy.relay_url === 'string' ? policy.relay_url : (policy.relay_url || ''));
  }
}

function hasPendingApprovals() {
  return (store.get('approvalRequests') || []).some(r => r.status === 'pending');
}

async function runServerSync({ needsApprovals = false } = {}) {
  const result = await serverSync.syncWithServer({
    policyVersion: store.get('policyVersion', 0),
    needsApprovals: needsApprovals || hasPendingApprovals()
  });

  if (!result) {
    // /sync API 미배포 시 레거시 폴백
    await serverSync.registerOrHeartbeat().catch(() => {});
    if (!store.get('policyVersion')) {
      const policy = await serverSync.fetchPolicy();
      if (policy) {
        applyServerPolicy(policy);
        store.set('policyVersion', Date.now());
        if (mainWindow && isPageReady) {
          mainWindow.webContents.send('policy-updated');
        }
      }
    }
    if (needsApprovals || hasPendingApprovals()) {
      await syncApprovalsFromServer();
    }
    return null;
  }

  if (result.policy_version != null) {
    store.set('policyVersion', result.policy_version);
  }
  if (result.policy) {
    applyServerPolicy(result.policy);
    console.log('[Main] 서버 정책 반영 완료');
    if (mainWindow && isPageReady) {
      mainWindow.webContents.send('policy-updated');
    }
  }
  if (result.approvals) {
    applyApprovalsList(result.approvals);
  }
  return result.pc_id || null;
}

function startApprovalPollIfNeeded() {
  if (approvalPollInterval || !hasPendingApprovals()) return;
  approvalPollInterval = setInterval(async () => {
    if (!hasPendingApprovals()) {
      clearInterval(approvalPollInterval);
      approvalPollInterval = null;
      return;
    }
    await runServerSync({ needsApprovals: true });
  }, APPROVAL_SYNC_MS);
}

function getNotifyIcon() {
  return path.join(__dirname, 'src', 'assets', 'icons', 'tray-active.png');
}

function showSystemNotification(title, body) {
  if (!Notification.isSupported()) return;
  try {
    new Notification({
      title: title || '옥수하이테크 보안',
      body: body || '',
      icon: getNotifyIcon(),
      urgency: 'critical',
      silent: false
    }).show();
  } catch (e) {
    console.warn('[Main] 알림 표시 실패:', e.message);
  }
}

function showPendingApprovalNotification(req) {
  if (!req || req.status !== 'pending') return;
  const type = req.request_type || approvalManager.parseMeta(req.recipient).type || '';
  if (type !== 'usb_connect' && type !== 'usb_file_transfer') return;
  const dedupeKey = `${type}:${(req.filename || '').slice(0, 40)}`;
  const now = Date.now();
  if (pendingApprovalNotifyAt.get(dedupeKey) && now - pendingApprovalNotifyAt.get(dedupeKey) < 90000) return;
  pendingApprovalNotifyAt.set(dedupeKey, now);

  const map = {
    usb_connect: {
      title: '🔌 USB 연결 차단',
      body: '관리자에게 승인을 요청했습니다.\n승인 후 USB 드라이브를 사용할 수 있습니다.'
    },
    usb_file_transfer: {
      title: '🔌 USB 파일 이동 차단',
      body: '관리자에게 승인을 요청했습니다.\n승인 후 USB로 파일을 다시 복사하세요.'
    }
  };
  const msg = map[type];
  if (!msg) return;
  showSystemNotification(msg.title, msg.body);
}

function showResolvedApprovalNotification(req, approved) {
  if (!req) return;
  const type = req.request_type || approvalManager.parseMeta(req.recipient).type || '';
  if (type !== 'usb_connect' && type !== 'usb_file_transfer') return;
  const labels = { usb_connect: 'USB 연결', usb_file_transfer: 'USB 파일 이동' };
  const label = labels[type] || 'USB';
  if (approved) {
    showSystemNotification(`✅ ${label} 승인됨`, req.filename || '관리자가 승인했습니다. 다시 시도하세요.');
  } else {
    showSystemNotification(`❌ ${label} 거부됨`, req.filename || '관리자가 요청을 거부했습니다.');
  }
}

const pendingApprovalNotifyAt = new Map();

function setupApprovalWorkflow() {
  approvalManager.setCallbacks({
    onUpdate: (req) => {
      syncApprovalToStore(req);
      if (req.status === 'pending') {
        showPendingApprovalNotification(req);
        startApprovalPollIfNeeded();
        runServerSync({ needsApprovals: true }).catch(() => {});
      } else if (req.status === 'approved') {
        showResolvedApprovalNotification(req, true);
      } else if (req.status === 'rejected') {
        showResolvedApprovalNotification(req, false);
      }
    },
    onGrant: (type, data) => {
      if (type === 'usb_connect') {
        // data.drive가 정확한 드라이브 문자, data.id는 grantKey에서 오는 보조 식별자
        const drive = data.drive || data.id;
        if (drive) {
          osEngine.allowUsbDrive(drive);
          appendSecurityLog({ type: 'allowed', message: `[USB 승인] ${drive}: 드라이브 사용 허용 (30분)` });
          showSystemNotification('✅ USB 연결 승인', `${drive}: USB를 사용할 수 있습니다.`);
        }
      }
      if (type === 'usb_file_transfer' || type === 'file_transfer') {
        const label = type === 'usb_file_transfer' ? 'USB 파일 승인' : '파일 승인';
        const msg = type === 'usb_file_transfer' ? 'USB 복사가 허용되었습니다.' : '파일 이동/복사가 허용되었습니다.';
        appendSecurityLog({ type: 'allowed', message: `[승인] ${path.basename(data.filePath || data.filename || '')} — 허용 (30분)` });
        showSystemNotification(`✅ ${label}`, `${path.basename(data.filePath || '')} ${msg}`);
      }
    }
  });

  // NoUSB 빌드: USB 승인/차단 콜백 등록 생략
  // osEngine.setUsbGrantChecker 및 setUsbApprovalRequestCallback 미사용
}

// --- 메일: 차단 OFF, 발송·접속 감사 로그만 서버 기록 ---
function isMailGuardEnabled() {
  return false;
}

async function ensureMailAccessUnblocked() {
  await mailGuard.removeFirewallRules().catch(() => {});
  const webmailDomains = new Set([
    ...(mailGuard.getAllowedMailDomains ? mailGuard.getAllowedMailDomains() : mailGuard.DEFAULT_WEBMAIL_DOMAINS || []),
    ...(mailGuard.DEFAULT_GROUPWARE_DOMAINS || []),
    'oksooht.daouoffice.com'
  ].map(d => d.toLowerCase()));

  const sites = store.get('blockedSites') || [];
  const filtered = sites.filter(s => !webmailDomains.has(String(s).trim().toLowerCase()));
  if (filtered.length !== sites.length) {
    store.set('blockedSites', filtered);
  }

  siteBlocker.unblockDomains([...webmailDomains]);
}

function applySiteBlocking(customSites) {
  const sites = customSites || store.get('blockedSites') || [];
  if (sites.length === 0) {
    siteBlocker.updateBlockedSites(['pornhub.com', 'ilbe.com', 'torrentwal.com']);
  } else {
    siteBlocker.updateBlockedSites(sites);
  }
}

let siteBlockRefreshInterval = null;

// --- 보안 가드 통합 시작 ---
async function startSecurityGuards() {
  const sec = store.get('security', {});
  const net = store.get('network', {});
  const mailEnabled = isMailGuardEnabled();

  extensionGuard.setEventCallback(handleGuardEvent);
  mailGuard.setEventCallback(handleGuardEvent);

  extensionGuard.updatePolicy({
    blocked_extensions: sec.blockedExtensions,
    usb_blocking_enabled: sec.usbGuard
  });

  osEngine.updateEnginePolicy({
    usb_blocking_enabled: sec.usbGuard,
    blocked_extensions: sec.blockedExtensions,
    clipboard_monitoring_enabled: sec.clipboardGuard
  });

  const folders = extensionGuard.getWatchFolders(sec.watchedFolders);
  const blockedExts = sec.blockedExtensions || [];
  if (blockedExts.length > 0) fileWatcher.updateBlockedExtensions(blockedExts);
  if (sec.fileGuard !== false && blockedExts.length > 0) {
    fileWatcher.startWatching(folders, onFileEvent, onBlockedFileDetected);
  } else {
    fileWatcher.stopAll();
  }

  extensionGuard.start(sec.watchedFolders);
  await mailGuard.start(net, false, true, { extensionOnly: false });
  documentMonitor.start();

  applySiteBlocking(store.get('blockedSites') || []);
  if (siteBlockRefreshInterval) clearInterval(siteBlockRefreshInterval);
  siteBlockRefreshInterval = null;

  console.log('[Main] 보안 가드 기동 — USB 승인·파일 감시(로그)');
}

async function stopSecurityGuards() {
  extensionGuard.stop();
  await mailGuard.stop();
  documentMonitor.stop();
  fileWatcher.stopAll();
  if (siteBlockRefreshInterval) {
    clearInterval(siteBlockRefreshInterval);
    siteBlockRefreshInterval = null;
  }
  siteBlocker.clearAllBlocks();
}

// --- 파일 감시 콜백 ---
function onFileEvent(event, filePath) {
  // 일반 파일 이벤트는 UI/스토어에 기록하지 않음 (전역 감시 시 수천 건 → UI 멈춤)
  // 차단 확장자·USB 등 중요 이벤트는 onBlockedFileDetected / appendSecurityLog 에서 처리
}

let uiLogFlushTimer = null;
const pendingUiLogs = [];

function flushSecurityLogsToUI() {
  uiLogFlushTimer = null;
  if (!mainWindow || !isPageReady || !pendingUiLogs.length) return;
  const batch = pendingUiLogs.splice(0, pendingUiLogs.length);
  mainWindow.webContents.send('security-event', { batch });
}

function scheduleSecurityLogUI(logEntry) {
  if (logEntry) pendingUiLogs.push(logEntry);
  if (uiLogFlushTimer) return;
  uiLogFlushTimer = setTimeout(flushSecurityLogsToUI, 400);
}

// --- 차단 확장자 파일 감지 → 로그만 (승인/격리 없음) ---
const blockedFileCooldown = new Map();
const BLOCKED_FILE_COOLDOWN_MS = 15000;

function onBlockedFileDetected(filePath, ext, event = 'add') {
  const key = filePath.toLowerCase();
  const now = Date.now();
  const last = blockedFileCooldown.get(key);
  if (last && now - last < BLOCKED_FILE_COOLDOWN_MS) return;
  blockedFileCooldown.set(key, now);
  if (blockedFileCooldown.size > 500) {
    for (const [k, t] of blockedFileCooldown) {
      if (now - t > BLOCKED_FILE_COOLDOWN_MS * 2) blockedFileCooldown.delete(k);
    }
  }

  const source = event === 'unlink' ? '이동(출발)' : '생성/복사';
  extensionGuard.handleBlockedFile(filePath, source);
}

// --- USB 드라이브 파일 이동 → 격리 + 승인 요청 ---
const usbEventCooldown = new Map();
const USB_EVENT_COOLDOWN_MS = 8000;
const { quarantineFile, getFileExt } = require('./security/security-utils');

async function onUsbFileEvent(event, filePath) {
  // NoUSB 빌드: USB 차단 로직 없음, 파일 이벤트 무시
  return;
}

function startFileWatcherFromStore() {
  startSecurityGuards().catch(e => console.error('[Main] 가드 시작 실패:', e.message));
}

function startSecurityEngineDeferred() {
  setTimeout(() => {
    if (isEnginePaused || isQuitting) return;
    console.log('[Main-NoUSB] 보안 엔진 기동 (UI 안정화 후) — USB 차단 보장 비활성화');
    osEngine.updateEnginePolicy({ usb_blocking_enabled: false });
    osEngine.startEngine(onUsbFileEvent);
    startFileWatcherFromStore();
    // NoUSB 빌드: scanExistingUsbDrives 호출 생략
  }, SECURITY_START_DELAY_MS);
}


// --- IPC 핸들러 ---
ipcMain.handle('get-store', (event, key) => {
  return store.get(key);
});

ipcMain.handle('set-store', (event, key, value) => {
  store.set(key, value);
  if (key === 'adminPassword') {
    writeAdminPasswordToRegistry(value);
  }
  if (key === 'pcNickname') {
    serverSync.setNickname(value);
    runServerSync().catch(() => {});
  }
  if (key === 'security' && value) {
    value.usbGuard = false; // NoUSB 강제
    osEngine.updateEnginePolicy({
      usb_blocking_enabled: false,
      blocked_extensions: value.blockedExtensions,
      clipboard_monitoring_enabled: value.clipboardGuard
    });
    extensionGuard.updatePolicy({ blocked_extensions: value.blockedExtensions, usb_blocking_enabled: false });
    const blockedExts = value.blockedExtensions || store.get('security.blockedExtensions', []);
    if (blockedExts.length > 0) fileWatcher.updateBlockedExtensions(blockedExts);
    if (value.fileGuard !== false && blockedExts.length > 0) {
      const folders = extensionGuard.getWatchFolders(value.watchedFolders);
      fileWatcher.startWatching(folders, onFileEvent, onBlockedFileDetected);
    } else {
      fileWatcher.stopAll();
    }
  }
  if (key === 'network' && value) {
    const sec = store.get('security', {});
    mailGuard.updatePolicy(value, isMailGuardEnabled());
    applySiteBlocking(store.get('blockedSites') || []);
  }
  if (key === 'security' && value && value.mailGuard !== undefined) {
    const net = store.get('network', {});
    mailGuard.updatePolicy(net, isMailGuardEnabled());
    applySiteBlocking(store.get('blockedSites') || []);
  }
  return true;
});

ipcMain.handle('get-all-store', () => {
  return store.store;
});

ipcMain.handle('window-minimize', () => {
  hideToTray();
});

ipcMain.handle('window-toggle-maximize', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  }
});

ipcMain.handle('window-close', () => {
  hideToTray();
});

ipcMain.handle('quit-app', () => {
  isQuitting = true;
  app.quit();
});

ipcMain.handle('allow-uninstall', async (event, allow) => {
  try {
    const Registry = require('winreg');
    const regKey = new Registry({
      hive: Registry.HKCU,
      key: '\\Software\\JBMSOFT_Security'
    });
    
    return new Promise((resolve) => {
      if (allow) {
        regKey.set('UninstallAllowed', Registry.REG_SZ, '1', (err) => {
          resolve(!err);
        });
      } else {
        regKey.remove('UninstallAllowed', (err) => {
          resolve(!err);
        });
      }
    });
  } catch (e) {
    console.error('레지스트리 설정 실패:', e);
    return false;
  }
});

ipcMain.handle('get-system-info', () => {
  const os = require('os');
  return {
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    cpus: os.cpus().length,
    totalMem: Math.round(os.totalmem() / 1024 / 1024 / 1024) + ' GB',
    username: os.userInfo().username,
    networkInterfaces: Object.entries(os.networkInterfaces())
      .flatMap(([name, ifaces]) => ifaces
        .filter(i => i.family === 'IPv4' && !i.internal)
        .map(i => ({ name, address: i.address, mac: i.mac }))
      )
  };
});

ipcMain.handle('add-log', async (event, logEntry) => {
  // 1. 로컬 저장
  const logs = store.get('securityLogs', []);
  logs.unshift({
    ...logEntry,
    id: Date.now().toString(),
    timestamp: new Date().toISOString()
  });
  if (logs.length > 1000) logs.splice(1000);
  store.set('securityLogs', logs);

  // 2. 서버 전송 (비동기, 실패해도 로컬은 저장됨)
  serverSync.sendLog(
    logEntry.type || logEntry.event || 'security_event',
    logEntry.level || logEntry.severity || 'info',
    logEntry.message || logEntry.action || '',
    { ...logEntry }
  ).catch(() => {}); // 실패 시 무시 (오프라인 허용)

  return true;
});

// 서버로 승인 요청 전송
ipcMain.handle('server-request-approval', async (event, { fileName, destination, reason }) => {
  const result = await serverSync.requestApproval(fileName, destination, reason);
  return result;
});

// 서버에서 보안 정책 가져오기
ipcMain.handle('server-fetch-policy', async () => {
  const policy = await serverSync.fetchPolicy();
  return policy;
});

// 서버 승인 목록 강제 동기화 및 최신 목록 반환
ipcMain.handle('sync-approvals', async () => {
  await runServerSync({ needsApprovals: true });
  return store.get('approvalRequests', []);
});

ipcMain.handle('add-approval-request', (event, request) => {
  const requests = store.get('approvalRequests', []);
  requests.unshift({
    ...request,
    id: Date.now().toString(),
    timestamp: new Date().toISOString(),
    status: 'pending'
  });
  store.set('approvalRequests', requests);
  if (tray) tray.setToolTip('옥수하이테크 보안솔루션 - ⚠️ 승인 요청 대기 중');
  return true;
});

ipcMain.handle('handle-approval', async (event, id, approved) => {
  const requests = store.get('approvalRequests', []);
  const entry = requests.find(r => r.id === id);
  const resolved = approvalManager.resolveRequest(id, approved);

  if (entry) {
    entry.status = approved ? 'approved' : 'rejected';
    entry.resolvedAt = new Date().toISOString();
    store.set('approvalRequests', requests);
    if (entry.serverId) {
      await serverSync.resolveApproval(entry.serverId, approved);
    }
  }

  const pending = requests.filter(r => r.status === 'pending').length;
  if (tray) {
    tray.setToolTip(pending > 0
      ? `옥수하이테크 보안솔루션 - ⚠️ 승인 요청 ${pending}건 대기 중`
      : '옥수하이테크 보안솔루션 - 보안 활성화 중');
  }
  return resolved;
});

ipcMain.handle('update-language', (event, lang) => {
  store.set('language', lang);
  updateTrayMenu();
  return true;
});

ipcMain.handle('show-notification', (event, title, body) => {
  showSystemNotification(title, body);
});

// 원격 데스크톱 상태 조회
ipcMain.handle('get-remote-status', () => {
  return remoteDesktop.getStatus();
});

// 보안 엔진 일시 중지
ipcMain.handle('pause-engine', async () => {
  await osEngine.stopEngine();
  await stopSecurityGuards();
  isEnginePaused = true;
  updateTrayMenu();
  if (tray) tray.setToolTip('옥수하이테크 보안솔루션 - ⏸ 보안 일시 중지');
  serverSync.sendLog('engine_paused', 'warning', '보안 엔진 일시 중지됨').catch(() => {});
  return true;
});

// 보안 엔진 재개
ipcMain.handle('resume-engine', async () => {
  osEngine.startEngine(onUsbFileEvent);
  startFileWatcherFromStore();
  // NoUSB 빌드: scanExistingUsbDrives 생략
  isEnginePaused = false;
  updateTrayMenu();
  if (tray) tray.setToolTip('옥수하이테크 보안솔루션 - 보안 활성화 중');
  serverSync.sendLog('engine_resumed', 'info', '보안 엔진 재개됨').catch(() => {});
  return true;
});

// 폴더 감시 재시작
ipcMain.handle('start-file-watcher', () => {
  startFileWatcherFromStore();
  return fileWatcher.getStatus();
});

// 폴더 선택 다이얼로그
ipcMain.handle('show-folder-dialog', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '감시할 폴더 선택',
    properties: ['openDirectory'],
    buttonLabel: '이 폴더 감시'
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

// 현재 연결된 이동식 드라이브 목록 조회
ipcMain.handle('get-usb-drives', async () => {
  return await osEngine.getConnectedRemovableDrives();
});

// 엔진 상태 조회
ipcMain.handle('get-engine-status', () => {
  return {
    isPaused: isEnginePaused,
    ...osEngine.getStatus(),
    extensionGuard: extensionGuard.getStatus(),
    mailGuard: mailGuard.getStatus()
  };
});

// 사용자 목록 조회
ipcMain.handle('get-users', () => {
  return store.get('users', []);
});

// 사용자 목록 저장
ipcMain.handle('set-users', (event, usersData) => {
  store.set('users', usersData);
  return true;
});

// --- 앱 시작 ---
app.whenReady().then(async () => {
  const isAdmin = await checkAndRelaunchAsAdmin();
  if (!isAdmin) return;

  if (process.platform === 'win32') {
    app.setAppUserModelId('com.oksoohitech.security.nousb');
  }

  if (!store.get('adminPassword')) {
    store.set('adminPassword', 'oksooht0731');
  }
  writeAdminPasswordToRegistry(store.get('adminPassword'));

  // ─── 윈도우 부팅 시 자동 실행 (작업 스케줄러를 통해 UAC 권한 우회) ───
  registerStartupTask();

  setupApprovalWorkflow();

  await ensureMailAccessUnblocked().catch(() => {});

  // 웹메일 hosts 잔여 차단 제거 (유해사이트만 유지)
  applySiteBlocking(store.get('blockedSites') || []);

  createMainWindow();

  if (isBootHidden()) {
    createTray();
    console.log('[Main] 부팅 자동 실행 — 트레이만 표시');
  } else {
    createSplashWindow();
    setTimeout(() => {
      if (splashWindow && !splashWindow.isDestroyed()) {
        splashWindow.close();
        splashWindow = null;
      }
      showMainWindow();
      createTray();
    }, 3500);
  }

  // 닉네임 초기화
  const savedNickname = store.get('pcNickname');
  if (savedNickname) serverSync.setNickname(savedNickname);

  // 블랙리스트 자동 설정 (앱 최초 실행 시 다운로드)
  const setupBlocklist = require('./security/setup-blocklist');
  setupBlocklist().catch(e => console.warn("[Main] 블랙리스트 설정 실패:", e.message));
  // 서버에 PC 등록 및 하트비트 시작
  try {
    try {
        pcId = await runServerSync({ needsApprovals: true });
    } catch (regErr) {
        if (regErr.message === 'LICENSE_LIMIT_EXCEEDED') {
            dialog.showErrorBox('옥수하이테크 보안솔루션 - 라이선스 초과', 
                '라이선스 한도가 초과되어 새 기기를 등록할 수 없습니다.\n본사에 문의하여 한도를 증설해주세요.');
            app.quit();
            return;
        }
        throw regErr;
    }
    
    if (pcId) {
      console.log('[Main] 서버 등록 완료, PC ID:', pcId);
      // 앱 시작 이벤트 로그 전송
      await serverSync.sendLog('app_start', 'info', '옥수하이테크 보안솔루션 앱 시작', {
        hostname: require('os').hostname(),
        user: require('os').userInfo().username
      });
    }

    // 원격 데스크톱 에이전트 초기화 (MAC 주소로 식별)
    const pcInfo = serverSync.getPCInfo();
    remoteDesktop.init(pcInfo.mac_address, '');

    // 5분마다 하트비트 + 정책 버전 확인 (변경 시에만 정책 수신)
    heartbeatInterval = setInterval(() => {
      runServerSync().catch(e => console.warn('[Main] sync 실패:', e.message));
    }, SYNC_INTERVAL_MS);

    startApprovalPollIfNeeded();

    // UI 먼저 쓸 수 있게 보안 엔진은 12초 후 기동
    startSecurityEngineDeferred();
    startMailExtensionBridge().catch(e => console.warn('[Main] Mail extension bridge:', e.message));

  } catch (err) {
    if (err.message === 'LICENSE_LIMIT_EXCEEDED') {
        dialog.showErrorBox('라이선스 초과', '라이선스 수량이 초과되어 보호를 시작할 수 없습니다.');
        app.quit();
    } else {
        console.warn('[Main] 서버 연결 실패, 오프라인 모드로 실행:', err.message);
        startSecurityEngineDeferred();
        startMailExtensionBridge().catch(e => console.warn('[Main] Mail extension bridge:', e.message));
    }
  }

  app.on('activate', () => {
    showMainWindow();
  });
});

app.on('window-all-closed', () => {
  // 트레이에서 계속 실행
});

app.on('before-quit', async () => {
  isQuitting = true;
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  if (approvalPollInterval) clearInterval(approvalPollInterval);

  await osEngine.stopEngine();
  await stopSecurityGuards();
  await stopMailExtensionBridge();
  remoteDesktop.disconnect();

  try {
    await serverSync.sendLog('app_stop', 'info', 'JBMSOFT Security 앱 종료', {});
  } catch (_) {}
});

// 프로세스 예기치 못한 종료 시 프록시 설정 복구 안전 장치
function exitHandler() {
  try {
    const proxy = require('./security/mail-proxy-server');
    proxy.stop();
  } catch (_) {}
  process.exit();
}

process.on('exit', exitHandler);
process.on('SIGINT', exitHandler);
process.on('SIGTERM', exitHandler);
process.on('uncaughtException', (err) => {
  console.error('[Main] Uncaught Exception:', err);
  exitHandler();
});




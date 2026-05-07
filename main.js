// 옥수하이테크 보안솔루션 - Main Process
const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, shell, dialog, Notification } = require('electron');
const path = require('path');
const Store = require('electron-store');
const serverSync = require('./security/server-sync');
const siteBlocker = require('./security/site-blocker');
const osEngine = require('./security/os-engine');

// --- 서버 동기화 상태 ---
let heartbeatInterval = null;
let pcId = null; // 서버에서 발급받은 PC UUID

// --- 스토어 초기화 ---
const store = new Store({
  name: 'jbmsoft-security-config',
  defaults: {
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
  }
});

let splashWindow = null;
let mainWindow = null;
let tray = null;
let isQuitting = false;

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

  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
      if (Notification.isSupported()) {
        new Notification({
          title: '옥수하이테크 보안솔루션',
          body: '보안 프로그램이 트레이에서 계속 실행 중입니다.',
          icon: path.join(__dirname, 'src', 'assets', 'icons', 'tray-active.png')
        }).show();
      }
    }
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
      label: isKo ? '보안 상태: 활성화' : 'Security: Active',
      enabled: false
    },
    { type: 'separator' },
    {
      label: isKo ? '일시 중지 (관리자 인증 필요)' : 'Pause (Admin Auth Required)',
      click: () => {
        if (mainWindow) {
          showMainWindow();
          mainWindow.webContents.send('show-admin-auth', 'pause');
        }
      }
    },
    { type: 'separator' },
    {
      label: isKo ? '종료' : 'Quit',
      click: () => {
        if (mainWindow) {
          showMainWindow();
          mainWindow.webContents.send('show-admin-auth', 'quit');
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

// --- IPC 핸들러 ---
ipcMain.handle('get-store', (event, key) => {
  return store.get(key);
});

ipcMain.handle('set-store', (event, key, value) => {
  store.set(key, value);
  if (key === 'pcNickname') {
      serverSync.setNickname(value);
      serverSync.registerOrHeartbeat(); // 즉시 업데이트 전송
  }
  return true;
});

ipcMain.handle('get-all-store', () => {
  return store.store;
});

ipcMain.handle('window-minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.handle('window-toggle-maximize', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  }
});

ipcMain.handle('window-close', () => {
  if (mainWindow) mainWindow.hide();
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

ipcMain.handle('handle-approval', (event, id, approved) => {
  const requests = store.get('approvalRequests', []);
  const idx = requests.findIndex(r => r.id === id);
  if (idx !== -1) {
    requests[idx].status = approved ? 'approved' : 'rejected';
    requests[idx].resolvedAt = new Date().toISOString();
    store.set('approvalRequests', requests);
  }
  const pending = requests.filter(r => r.status === 'pending').length;
  if (tray) {
    tray.setToolTip(pending > 0
      ? `옥수하이테크 보안솔루션 - ⚠️ 승인 요청 ${pending}건 대기 중`
      : '옥수하이테크 보안솔루션 - 보안 활성화 중'
    );
  }
  return true;
});

ipcMain.handle('update-language', (event, lang) => {
  store.set('language', lang);
  updateTrayMenu();
  return true;
});

ipcMain.handle('show-notification', (event, title, body) => {
  if (Notification.isSupported()) {
    new Notification({ title, body }).show();
  }
});

// --- 앱 시작 ---
app.whenReady().then(async () => {
  createSplashWindow();
  createMainWindow();

  setTimeout(() => {
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.close();
      splashWindow = null;
    }
    showMainWindow();
    createTray();
  }, 3500);

  // 닉네임 초기화
  const savedNickname = store.get('pcNickname');
  if (savedNickname) serverSync.setNickname(savedNickname);

  // 블랙리스트 자동 설정 (앱 최초 실행 시 다운로드)
  const setupBlocklist = require('./security/setup-blocklist');
  setupBlocklist().catch(e => console.warn("[Main] 블랙리스트 설정 실패:", e.message));
  // 서버에 PC 등록 및 하트비트 시작
  try {
    try {
        pcId = await serverSync.registerOrHeartbeat();
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

    // 30초마다 하트비트 전송 및 정책 업데이트 (온라인 상태 유지)
    heartbeatInterval = setInterval(async () => {
      await serverSync.registerOrHeartbeat();
      
      try {
        const policy = await serverSync.fetchPolicy();
        if (policy) {
          // OS 엔진 정책 업데이트
          osEngine.updateEnginePolicy(policy);
          
          // 서버 정책에서 차단된 사이트 목록 가져오기
          let sitesToBlock = policy.blockedSites || [];
          // 기본 유해 사이트가 정책에 없다면 로컬 기본값 사용
          if (sitesToBlock.length === 0) {
            sitesToBlock = ['pornhub.com', 'ilbe.com', 'torrentwal.com'];
          }
          siteBlocker.updateBlockedSites(sitesToBlock);

          if (policy.admin_password) {
              store.set('adminPassword', policy.admin_password);
          }
        }
      } catch (e) {
        console.error('[Main] 정책 업데이트 실패:', e.message);
      }
      
    }, 30 * 1000);
    
    // 앱 시작 시 한 번 즉시 정책 적용
    const initialPolicy = await serverSync.fetchPolicy();
    if (initialPolicy) {
      osEngine.updateEnginePolicy(initialPolicy);
      siteBlocker.updateBlockedSites(initialPolicy.blockedSites || ['pornhub.com', 'ilbe.com', 'torrentwal.com']);
      if (initialPolicy.admin_password) {
          store.set('adminPassword', initialPolicy.admin_password);
      }
    }

  } catch (err) {
    if (err.message === 'LICENSE_LIMIT_EXCEEDED') {
        dialog.showErrorBox('라이선스 초과', '라이선스 수량이 초과되어 보호를 시작할 수 없습니다.');
        app.quit();
    } else {
        console.warn('[Main] 서버 연결 실패, 오프라인 모드로 실행:', err.message);
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
  // 하트비트 중단
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  
  osEngine.stopEngine();
  
  // 앱 종료 시 hosts 파일 원상 복구 (차단 해제)
  siteBlocker.updateBlockedSites([]);

  // 앱 종료 로그 전송
  try {
    await serverSync.sendLog('app_stop', 'info', 'JBMSOFT Security 앱 종료', {});
  } catch (_) {}
});


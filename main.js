// JBMSOFT Security - Main Process
const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, shell, dialog, Notification } = require('electron');
const path = require('path');
const Store = require('electron-store');

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
          title: 'JBMSOFT Security',
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
  tray.setToolTip('JBMSOFT Security - 보안 활성화 중');

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
      label: isKo ? '🛡️ JBMSOFT Security' : '🛡️ JBMSOFT Security',
      enabled: false
    },
    { type: 'separator' },
    {
      label: isKo ? '설정 열기' : 'Open Settings',
      icon: null,
      click: () => showMainWindow()
    },
    {
      label: isKo ? '보안 상태: 활성화 ✅' : 'Security: Active ✅',
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

ipcMain.handle('add-log', (event, logEntry) => {
  const logs = store.get('securityLogs', []);
  logs.unshift({
    ...logEntry,
    id: Date.now().toString(),
    timestamp: new Date().toISOString()
  });
  // 최대 1000개 유지
  if (logs.length > 1000) logs.splice(1000);
  store.set('securityLogs', logs);
  return true;
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
  if (tray) tray.setToolTip('JBMSOFT Security - ⚠️ 승인 요청 대기 중');
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
      ? `JBMSOFT Security - ⚠️ 승인 요청 ${pending}건 대기 중`
      : 'JBMSOFT Security - 보안 활성화 중'
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
app.whenReady().then(() => {
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

  app.on('activate', () => {
    showMainWindow();
  });
});

app.on('window-all-closed', () => {
  // 트레이에서 계속 실행
});

app.on('before-quit', () => {
  isQuitting = true;
});

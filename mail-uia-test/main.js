const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const mailUia = require('./mail-uia-monitor');

let mainWindow = null;
const logs = [];

function pushLog(entry) {
  logs.unshift(entry);
  if (logs.length > 200) logs.length = 200;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('mail-log', entry);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 720,
    minWidth: 720,
    minHeight: 520,
    title: 'OKSOOHT 메일 UIA 테스트',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile('index.html');

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  mailUia.setLogCallback(pushLog);
  mailUia.setScrapeDebugCallback((info) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('scrape-debug', info);
    }
  });
  mailUia.start();

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  mailUia.stop();
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('get-logs', () => logs);
ipcMain.handle('clear-logs', () => { logs.length = 0; return true; });
ipcMain.handle('get-status', () => mailUia.getStatus());
ipcMain.handle('scrape-now', () => mailUia.scrapeNow());
ipcMain.handle('toggle-monitor', (_, running) => {
  if (running) mailUia.start();
  else mailUia.stop();
  return mailUia.getStatus();
});

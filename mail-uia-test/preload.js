const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('testAPI', {
  getLogs: () => ipcRenderer.invoke('get-logs'),
  clearLogs: () => ipcRenderer.invoke('clear-logs'),
  getStatus: () => ipcRenderer.invoke('get-status'),
  scrapeNow: () => ipcRenderer.invoke('scrape-now'),
  toggleMonitor: (running) => ipcRenderer.invoke('toggle-monitor', running),
  onMailLog: (cb) => ipcRenderer.on('mail-log', (_, entry) => cb(entry)),
  onScrapeDebug: (cb) => ipcRenderer.on('scrape-debug', (_, info) => cb(info))
});

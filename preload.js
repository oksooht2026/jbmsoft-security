// preload.js - IPC 브리지 (보안 컨텍스트 격리)
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // 스토어
  getStore: (key) => ipcRenderer.invoke('get-store', key),
  setStore: (key, value) => ipcRenderer.invoke('set-store', key, value),
  getAllStore: () => ipcRenderer.invoke('get-all-store'),

  // 창 제어
  minimizeWindow: () => ipcRenderer.invoke('window-minimize'),
  toggleMaximize: () => ipcRenderer.invoke('window-toggle-maximize'),
  closeWindow: () => ipcRenderer.invoke('window-close'),
  quitApp: () => ipcRenderer.invoke('quit-app'),
  allowUninstall: (allow) => ipcRenderer.invoke('allow-uninstall', allow),

  // 시스템 정보
  getSystemInfo: () => ipcRenderer.invoke('get-system-info'),

  // 보안 로그
  addLog: (entry) => ipcRenderer.invoke('add-log', entry),
  
  // 승인 요청
  addApprovalRequest: (request) => ipcRenderer.invoke('add-approval-request', request),
  handleApproval: (id, approved) => ipcRenderer.invoke('handle-approval', id, approved),

  // 언어 업데이트
  updateLanguage: (lang) => ipcRenderer.invoke('update-language', lang),

  // 알림
  showNotification: (title, body) => ipcRenderer.invoke('show-notification', title, body),

  // 이벤트 수신
  on: (channel, callback) => {
    const validChannels = ['show-admin-auth', 'security-event', 'approval-update'];
    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, (event, ...args) => callback(...args));
    }
  },
  off: (channel, callback) => {
    ipcRenderer.removeListener(channel, callback);
  }
});

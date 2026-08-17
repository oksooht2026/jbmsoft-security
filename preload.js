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
  syncApprovals: () => ipcRenderer.invoke('sync-approvals'),

  // 언어 업데이트
  updateLanguage: (lang) => ipcRenderer.invoke('update-language', lang),

  // 알림
  showNotification: (title, body) => ipcRenderer.invoke('show-notification', title, body),

  // 보안 엔진 일시 중지 / 재개
  pauseEngine: () => ipcRenderer.invoke('pause-engine'),
  resumeEngine: () => ipcRenderer.invoke('resume-engine'),

  // 파일 감시 시작
  startFileWatcher: (folders) => ipcRenderer.invoke('start-file-watcher', folders),

  // 폴더 선택 다이얼로그
  showFolderDialog: () => ipcRenderer.invoke('show-folder-dialog'),

  // 현재 연결된 USB 드라이브 목록
  getUsbDrives: () => ipcRenderer.invoke('get-usb-drives'),

  // 엔진 상태 조회
  getEngineStatus: () => ipcRenderer.invoke('get-engine-status'),

  // 사용자 목록
  // 서버 승인 요청 전송
  requestApproval: (data) => ipcRenderer.invoke('server-request-approval', data),

  // USB 차단 시 사유 입력 후 승인 요청 전송
  submitUsbApproval: (data) => ipcRenderer.invoke('usb-submit-approval', data),

  // 원격 데스크톱 상태 조회
  getRemoteStatus: () => ipcRenderer.invoke('get-remote-status'),

  // 이벤트 수신
  on: (channel, callback) => {
    const validChannels = [
      'show-admin-auth', 'security-event', 'approval-update', 'engine-status-change', 'policy-updated', 'usb-blocked', 'usb-approval-sent'
    ];
    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, (event, ...args) => callback(...args));
    }
  },
  off: (channel, callback) => {
    ipcRenderer.removeListener(channel, callback);
  }
});

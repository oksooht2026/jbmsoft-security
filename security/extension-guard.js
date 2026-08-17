// security/extension-guard.js
// 확장자 차단 가드 — 감지 + 격리 + 실행 차단 + USB 복사 차단
const { exec } = require('child_process');
const path = require('path');
const chokidar = require('chokidar');
const serverSync = require('./server-sync');
const approvalManager = require('./approval-manager');
const {
  getDefaultWatchFolders, isBlockedExtension, quarantineFile,
  deleteFileSafe, getFileExt, getQuarantineDir
} = require('./security-utils');

let execInterval = null;
let isRunning = false;
let blockedExtensions = [];
let executionBlockEnabled = true;
let usbBlockCopyEnabled = false;
let knownPids = new Set();
let onSecurityEvent = null; // main.js 콜백

const EXECUTABLE_EXTS = ['exe', 'bat', 'cmd', 'ps1', 'vbs', 'js', 'msi', 'scr', 'com', 'pif'];

function setEventCallback(cb) { onSecurityEvent = cb; }

function updatePolicy(policy) {
  if (policy.blocked_extensions) {
    blockedExtensions = policy.blocked_extensions.map(e => e.toLowerCase().replace(/^\./, ''));
  }
  if (policy.usb_blocking_enabled !== undefined) {
    usbBlockCopyEnabled = policy.usb_blocking_enabled;
  }
  if (policy.extension_execution_block !== undefined) {
    executionBlockEnabled = policy.extension_execution_block !== false;
  }
}

function emitEvent(type, severity, message, details = {}) {
  serverSync.sendLog(type, severity, message, details).catch(() => {});
  if (onSecurityEvent) {
    onSecurityEvent({ type: severity === 'critical' ? 'blocked' : 'warning', message, details });
  }
}

// ─── 차단 확장자 파일 처리 (승인 제외 — 로그만) ───
async function handleBlockedFile(filePath, source = 'watcher') {
  const ext = getFileExt(filePath);
  if (!isBlockedExtension(filePath, blockedExtensions)) return false;

  const filename = path.basename(filePath);
  emitEvent('file_movement', 'info',
    `[파일] .${ext} ${source}: ${filename}`,
    { filePath, ext, source }
  );
  if (onSecurityEvent) {
    onSecurityEvent({ type: 'info', message: `[파일] .${ext} ${source}: ${filename}` });
  }
  console.log(`[ExtensionGuard] 파일 감지 .${ext}: ${filename} (로그만)`);
  return false;
}

// ─── USB 파일은 main.js onUsbFileEvent에서 승인 처리 ───
async function handleUsbBlockedFile(filePath, event) {
  return false;
}

// ─── 실행 차단: 차단 확장자 프로세스 감지 후 종료 ───
function startExecutionGuard() {
  if (execInterval) clearInterval(execInterval);

  execInterval = setInterval(() => {
    if (!executionBlockEnabled || blockedExtensions.length === 0) return;

    const blockExecExts = blockedExtensions.filter(e => EXECUTABLE_EXTS.includes(e));
    if (blockExecExts.length === 0) return;

    const psScript = `
      Get-CimInstance Win32_Process |
        Where-Object { $_.ProcessId -ne 0 -and $_.ExecutablePath -ne $null } |
        Select-Object ProcessId, Name, ExecutablePath |
        ConvertTo-Json -Compress
    `;

    exec(`powershell -NoProfile -NonInteractive -Command ${JSON.stringify(psScript)}`,
      { windowsHide: true, timeout: 8000 },
      (err, stdout) => {
        if (err || !stdout.trim()) return;
        try {
          let procs = JSON.parse(stdout.trim());
          if (!Array.isArray(procs)) procs = [procs];

          procs.forEach(proc => {
            const pid = proc.ProcessId;
            const exePath = (proc.ExecutablePath || '').toLowerCase();
            const ext = getFileExt(exePath);
            const qDir = getQuarantineDir().toLowerCase();

            if (knownPids.has(pid)) return;
            knownPids.add(pid);
            if (knownPids.size > 5000) knownPids.clear();

            if (!blockExecExts.includes(ext)) return;
            if (exePath.includes(qDir)) return;
            if (exePath.includes('oksoo-security') || exePath.includes('electron')) return;
            if (approvalManager.isGranted('file_transfer', exePath)) return;

            exec(`taskkill /PID ${pid} /F`, { windowsHide: true }, () => {
              emitEvent('extension_exec_blocked', 'critical',
                `[실행 차단] .${ext} 프로세스 강제 종료: ${proc.Name}`,
                { pid, exePath, ext }
              );
              console.log(`[ExtensionGuard] 실행 차단: ${proc.Name} (PID ${pid})`);
            });
          });
        } catch (_) {}
      }
    );
  }, 12000);
}

function getWatchFolders(userFolders) {
  const defaults = getDefaultWatchFolders();
  const custom = Array.isArray(userFolders) ? userFolders : [];
  return [...new Set([...defaults, ...custom])].filter(f => {
    try { return require('fs').existsSync(f); } catch (_) { return false; }
  });
}

function start(userFolders) {
  isRunning = true;
  startExecutionGuard();
  console.log('[ExtensionGuard] 시작 — 격리·실행차단·USB복사차단 활성');
  return getWatchFolders(userFolders);
}

function stop() {
  isRunning = false;
  if (execInterval) { clearInterval(execInterval); execInterval = null; }
  knownPids.clear();
  console.log('[ExtensionGuard] 중지');
}

function getStatus() {
  return { isRunning, blockedExtensions, executionBlockEnabled, usbBlockCopyEnabled };
}

module.exports = {
  start, stop, updatePolicy, handleBlockedFile, handleUsbBlockedFile,
  getWatchFolders, setEventCallback, getStatus
};

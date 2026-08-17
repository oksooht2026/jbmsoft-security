// security/remote-updater.js — 관리자 패널에서 배포한 새 버전을 감지해 무인(silent) 자동 설치
// 흐름: /api/sync 응답의 update 필드 → 다운로드 → 무결성 확인 → NSIS 설치(/S) → 재실행
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');

const MAX_FAILED_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = 30 * 60 * 1000; // 3회 연속 실패 시 30분간 재시도 보류 (관리자에게는 critical 로그로 이미 통지됨)
const DOWNLOAD_TIMEOUT_MS = 15 * 60 * 1000;
const SIZE_TOLERANCE_BYTES = 1024 * 1024;

let electronApp = null;
let serverSync = null;
let store = null;
let applying = false;
let quitAppFn = null;

function init({ app, serverSync: sync, store: electronStore, quitApp } = {}) {
  electronApp = app;
  serverSync = sync;
  store = electronStore;
  quitAppFn = quitApp || (() => electronApp && electronApp.quit());
}

function isNewerVersion(a, b) {
  const pa = String(a || '0').split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b || '0').split('.').map(n => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}

function getState() {
  return (store && store.get('remoteUpdate')) || { lastVersion: null, attempts: 0, lastAttemptAt: 0, status: 'idle' };
}

function setState(patch) {
  if (!store) return;
  store.set('remoteUpdate', { ...getState(), ...patch });
}

/** 다음 heartbeat에 실어 보낼 현재 업데이트 진행 상태 (서버 pcs.update_status 반영용) */
function getReportableStatus() {
  return applying ? getState().status : (getState().status === 'failed' ? 'failed' : null);
}

function download(url, destPath) {
  return new Promise((resolve, reject) => {
    const attempt = (currentUrl, redirectsLeft) => {
      let client;
      try {
        client = currentUrl.startsWith('https:') ? https : http;
      } catch (_) {
        return reject(new Error('잘못된 다운로드 URL'));
      }

      const req = client.get(currentUrl, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirectsLeft > 0) {
          res.resume();
          return attempt(res.headers.location, redirectsLeft - 1);
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`다운로드 실패 (HTTP ${res.statusCode})`));
          return;
        }
        const file = fs.createWriteStream(destPath);
        res.pipe(file);
        file.on('finish', () => file.close(() => resolve()));
        file.on('error', (err) => { fs.unlink(destPath, () => {}); reject(err); });
      });
      req.on('error', reject);
      req.setTimeout(DOWNLOAD_TIMEOUT_MS, () => req.destroy(new Error('다운로드 시간 초과')));
    };
    attempt(url, 5);
  });
}

function sha256OfFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

/** 설치 프로그램 종료를 기다렸다가 새 버전 실행 파일을 재시작하는 워치독 (부모 앱 종료 후에도 살아남음) */
function spawnRelaunchWatchdog(installerPid, exePath) {
  const psCommand = [
    `Wait-Process -Id ${installerPid} -Timeout 300 -ErrorAction SilentlyContinue`,
    'Start-Sleep -Seconds 2',
    `Start-Process -FilePath '${exePath.replace(/'/g, "''")}'`
  ].join('; ');

  const watchdog = spawn('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', psCommand], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true
  });
  watchdog.unref();
}

async function checkAndApply(update) {
  if (!electronApp || !update || !update.version || !update.url) return;
  if (applying) return;

  const currentVersion = electronApp.getVersion();
  if (!isNewerVersion(update.version, currentVersion)) return;

  const state = getState();
  const now = Date.now();
  const sameVersionFailing = state.lastVersion === update.version && (state.attempts || 0) >= MAX_FAILED_ATTEMPTS;
  if (sameVersionFailing && now - (state.lastAttemptAt || 0) < RETRY_BACKOFF_MS) return;

  applying = true;
  setState({ status: 'downloading', targetVersion: update.version });
  logStatus('info', `[자동 업데이트] v${update.version} 다운로드 시작 (현재 v${currentVersion})`, currentVersion, update.version);

  try {
    const tempDir = electronApp.getPath('temp');
    const destPath = path.join(tempDir, `OksooSecurity_Update_${String(update.version).replace(/[^0-9.]/g, '')}.exe`);

    await download(update.url, destPath);

    const stat = fs.statSync(destPath);
    if (update.size && Math.abs(stat.size - update.size) > SIZE_TOLERANCE_BYTES) {
      throw new Error(`다운로드 파일 크기 불일치 (예상 ${update.size}B, 실제 ${stat.size}B)`);
    }
    if (update.sha256) {
      const hash = await sha256OfFile(destPath);
      if (hash.toLowerCase() !== String(update.sha256).toLowerCase()) {
        throw new Error('다운로드 파일 체크섬(SHA-256) 불일치');
      }
    }

    setState({ status: 'installing', targetVersion: update.version });
    logStatus('info', `[자동 업데이트] v${update.version} 설치 시작 (무인/자동, 잠시 후 재시작됩니다)`, currentVersion, update.version);

    const exePath = electronApp.getPath('exe');
    const installer = spawn(destPath, ['/S'], { detached: true, stdio: 'ignore', windowsHide: true });
    installer.unref();
    spawnRelaunchWatchdog(installer.pid, exePath);

    setState({ lastVersion: update.version, attempts: 0, lastAttemptAt: now, status: 'installing' });

    // 설치 프로그램이 실행 중인 앱 파일을 덮어쓸 수 있도록 잠시 후 정상 종료
    // (main.js의 before-quit 핸들러가 보안 엔진 정리를 담당)
    setTimeout(() => {
      try { quitAppFn(); } catch (_) {}
    }, 1500);
  } catch (err) {
    const st = getState();
    setState({ lastVersion: update.version, attempts: (st.attempts || 0) + 1, lastAttemptAt: now, status: 'failed' });
    logStatus('critical', `[자동 업데이트 실패] v${update.version}: ${err.message}`, currentVersion, update.version, err.message);
  } finally {
    applying = false;
  }
}

function logStatus(severity, message, fromVersion, toVersion, error) {
  if (!serverSync) return;
  serverSync.sendLog('app_update_status', severity, message, {
    from: fromVersion, to: toVersion, error: error || null
  }).catch(() => {});
}

function getStatus() {
  return getState();
}

module.exports = { init, checkAndApply, getStatus, getReportableStatus };

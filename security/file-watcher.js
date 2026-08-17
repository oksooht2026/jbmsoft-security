// security/file-watcher.js - 중요 폴더만 감시 (전역 드라이브 감시는 CPU/UI 멈춤 유발)
const chokidar = require('chokidar');
const path = require('path');
const { getDefaultWatchFolders, shouldIgnoreWatchPath } = require('./security-utils');

let watchers = [];
let blockedExtensions = ['exe', 'bat', 'cmd', 'ps1', 'sh', 'doc', 'docx', 'xls', 'xlsx', 'pdf', 'hwp', 'dwg'];
const recentEvents = new Map();
const DEDUPE_MS = 5000;
const WATCH_DEPTH = 4;

function isDuplicate(filePath, event) {
  const key = `${event}:${filePath.toLowerCase()}`;
  const now = Date.now();
  const last = recentEvents.get(key);
  if (last && now - last < DEDUPE_MS) return true;
  recentEvents.set(key, now);
  if (recentEvents.size > 2000) {
    for (const [k, t] of recentEvents) {
      if (now - t > DEDUPE_MS * 2) recentEvents.delete(k);
    }
  }
  return false;
}

function attachWatcher(watcher, onEvent, onBlockedFile) {
  watcher
    .on('add', filePath => {
      if (shouldIgnoreWatchPath(filePath)) return;
      if (isDuplicate(filePath, 'add')) return;
      onEvent('add', filePath);
      _checkBlocked(filePath, 'add', onBlockedFile);
    })
    .on('change', filePath => {
      if (shouldIgnoreWatchPath(filePath)) return;
      if (isDuplicate(filePath, 'change')) return;
      onEvent('change', filePath);
    })
    .on('unlink', filePath => {
      if (shouldIgnoreWatchPath(filePath)) return;
      if (isDuplicate(filePath, 'unlink')) return;
      onEvent('delete', filePath);
      _checkBlocked(filePath, 'unlink', onBlockedFile);
    })
    .on('error', err => console.error('[FileWatcher] Error:', err.message));
}

function resolveWatchFolders(folders) {
  const custom = Array.isArray(folders) ? folders.filter(Boolean) : [];
  const merged = [...new Set([...custom, ...getDefaultWatchFolders()])];
  return merged.filter(p => {
    try { return require('fs').existsSync(p); } catch (_) { return false; }
  });
}

/**
 * Desktop/Documents/Downloads 등 지정 폴더만 감시
 */
function startWatching(folders, onEvent, onBlockedFile) {
  stopAll();
  const roots = resolveWatchFolders(folders);
  if (!roots.length) {
    console.warn('[FileWatcher] 감시할 폴더 없음 — 파일 감시 생략');
    return;
  }

  roots.forEach(folder => {
    try {
      const watcher = chokidar.watch(folder, {
        persistent: true,
        ignoreInitial: true,
        depth: WATCH_DEPTH,
        ignored: (p) => shouldIgnoreWatchPath(p),
        awaitWriteFinish: { stabilityThreshold: 800, pollInterval: 200 },
        usePolling: false,
        ignorePermissionErrors: true
      });
      attachWatcher(watcher, onEvent, onBlockedFile);
      watchers.push(watcher);
      console.log('[FileWatcher] 폴더 감시:', folder);
    } catch (e) {
      console.error('[FileWatcher] 폴더 감시 실패:', folder, e.message);
    }
  });
}

/** @deprecated — 전역 드라이브 감시 비활성, 폴더 감시로 대체 */
function startSystemWatching(onEvent, onBlockedFile) {
  console.warn('[FileWatcher] 전역 드라이브 감시 요청 → 폴더 감시로 대체 (성능)');
  startWatching([], onEvent, onBlockedFile);
}

function _checkBlocked(filePath, event, onBlockedFile) {
  if (!onBlockedFile) return;
  const ext = path.extname(filePath).replace('.', '').toLowerCase();
  if (!ext || !blockedExtensions.includes(ext)) return;
  onBlockedFile(filePath, ext, event);
}

function updateBlockedExtensions(exts) {
  if (Array.isArray(exts)) {
    blockedExtensions = exts.map(e => e.toLowerCase().replace(/^\./, ''));
    console.log('[FileWatcher] 차단 확장자:', blockedExtensions.join(', '));
  }
}

function stopAll() {
  watchers.forEach(w => { try { w.close(); } catch (_) {} });
  watchers = [];
  recentEvents.clear();
}

function getStatus() {
  return {
    mode: 'folder-only',
    watcherCount: watchers.length,
    blockedExtensions
  };
}

module.exports = { startWatching, startSystemWatching, stopAll, updateBlockedExtensions, getStatus };

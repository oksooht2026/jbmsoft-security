// security/file-watcher.js - 파일 감시 모듈
const chokidar = require('chokidar');
const path = require('path');

let watchers = [];

function startWatching(folders, onEvent) {
  stopAll();
  if (!folders || folders.length === 0) return;

  folders.forEach(folder => {
    try {
      const watcher = chokidar.watch(folder, {
        persistent: true,
        ignoreInitial: true,
        depth: 3
      });

      watcher
        .on('add', filePath => onEvent('add', filePath))
        .on('change', filePath => onEvent('change', filePath))
        .on('unlink', filePath => onEvent('delete', filePath))
        .on('error', err => console.error('[FileWatcher] Error:', err));

      watchers.push(watcher);
    } catch(e) {
      console.error('[FileWatcher] Failed to watch:', folder, e);
    }
  });
}

function stopAll() {
  watchers.forEach(w => w.close());
  watchers = [];
}

module.exports = { startWatching, stopAll };

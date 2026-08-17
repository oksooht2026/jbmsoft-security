// security/mail-extension-installer.js — Chrome/Edge/Whale 확장 프로그램 자동 등록
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/** manifest.json key 기반 고정 ID — 설치·Native Messaging 공통 */
const EXTENSION_ID = 'keoikkfimipminfdbjlekjhgcjkjolil';
const EXTENSION_VERSION = '1.0.0';

const BROWSERS = [
  { name: 'Chrome', reg: 'HKCU\\Software\\Google\\Chrome\\Extensions\\' + EXTENSION_ID },
  { name: 'Edge', reg: 'HKCU\\Software\\Microsoft\\Edge\\Extensions\\' + EXTENSION_ID },
  { name: 'Whale', reg: 'HKCU\\Software\\Naver\\Whale\\Extensions\\' + EXTENSION_ID }
];

const POLICY_KEYS = [
  { name: 'Chrome', reg: 'HKCU\\Software\\Policies\\Google\\Chrome\\ExtensionInstallForcelist' },
  { name: 'Edge', reg: 'HKCU\\Software\\Policies\\Microsoft\\Edge\\ExtensionInstallForcelist' }
];

function resolveExtensionDir(installDir) {
  const candidates = [
    path.join(installDir, 'chrome-extension'),
    path.join(installDir, 'resources', 'chrome-extension'),
    path.join(__dirname, '..', 'chrome-extension')
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'manifest.json'))) return dir;
  }
  return candidates[0];
}

function installExtensionShortcuts(installDir) {
  const extDir = resolveExtensionDir(installDir);
  if (!fs.existsSync(path.join(extDir, 'manifest.json'))) {
    return { ok: false, reason: 'manifest missing', extDir };
  }
  const ps1 = path.join(__dirname, '..', 'scripts', 'install-browser-extension-shortcuts.ps1');
  if (!fs.existsSync(ps1)) {
    console.warn('[MailExtension] shortcut 스크립트 없음:', ps1);
    return { ok: false, extDir };
  }
  try {
    execSync(
      `powershell -NoProfile -ExecutionPolicy Bypass -File "${ps1}" -ExtensionDir "${extDir}"`,
      { stdio: 'pipe', windowsHide: true, timeout: 60000 }
    );
    console.log('[MailExtension] 브라우저 바로가기 --load-extension 적용:', extDir);
    return { ok: true, extDir, method: 'shortcut' };
  } catch (err) {
    console.warn('[MailExtension] 바로가기 패치 실패:', err.message);
    return { ok: false, extDir, error: err.message };
  }
}

/** 레지스트리(구식) + 바로가기 패치 — 무료 자동 설치 */
function registerExtension(installDir) {
  const extDir = resolveExtensionDir(installDir);
  if (!fs.existsSync(path.join(extDir, 'manifest.json'))) {
    console.warn('[MailExtension] manifest.json 없음:', extDir);
    return { ok: false, extDir };
  }

  const extDirWin = extDir.replace(/\//g, '\\');
  const fileUrl = 'file:///' + extDir.replace(/\\/g, '/').replace(/ /g, '%20');

  for (const browser of BROWSERS) {
    try {
      execSync(`reg add "${browser.reg}" /v path /t REG_SZ /d "${extDirWin}" /f`, { stdio: 'pipe' });
      execSync(`reg add "${browser.reg}" /v version /t REG_SZ /d "${EXTENSION_VERSION}" /f`, { stdio: 'pipe' });
    } catch (_) {}
  }

  for (const policy of POLICY_KEYS) {
    try {
      const value = `${EXTENSION_ID};${fileUrl}`;
      execSync(`reg add "${policy.reg}" /v 1 /t REG_SZ /d "${value}" /f`, { stdio: 'pipe' });
    } catch (_) {}
  }

  const shortcuts = installExtensionShortcuts(installDir);
  return {
    ok: shortcuts.ok,
    extDir,
    extensionId: EXTENSION_ID,
    method: shortcuts.ok ? 'shortcut' : 'registry-only'
  };
}

function unregisterExtension() {
  for (const browser of BROWSERS) {
    try {
      execSync(`reg delete "${browser.reg}" /f`, { stdio: 'pipe' });
    } catch (_) {}
  }
  for (const policy of POLICY_KEYS) {
    try {
      execSync(`reg delete "${policy.reg}" /v 1 /f`, { stdio: 'pipe' });
    } catch (_) {}
  }
}

function getExtensionOrigin() {
  return `chrome-extension://${EXTENSION_ID}/`;
}

module.exports = {
  EXTENSION_ID,
  EXTENSION_VERSION,
  registerExtension,
  installExtensionShortcuts,
  unregisterExtension,
  getExtensionOrigin,
  resolveExtensionDir
};

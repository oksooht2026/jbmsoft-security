// security/mail-native-registry.js — Chrome/Edge/Whale Native Messaging Host 레지스트리 등록
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { getExtensionOrigin } = require('./mail-extension-installer');

const HOST_NAME = 'com.oksoohitech.security.mail';

const BROWSER_REGISTRY_PATHS = [
  'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\' + HOST_NAME,
  'HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\' + HOST_NAME,
  'HKCU\\Software\\Naver\\Whale\\NativeMessagingHosts\\' + HOST_NAME,
  'HKLM\\Software\\Google\\Chrome\\NativeMessagingHosts\\' + HOST_NAME,
  'HKLM\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\' + HOST_NAME,
  'HKLM\\Software\\Naver\\Whale\\NativeMessagingHosts\\' + HOST_NAME,
  'HKLM\\Software\\WOW6432Node\\Google\\Chrome\\NativeMessagingHosts\\' + HOST_NAME,
  'HKLM\\Software\\WOW6432Node\\Microsoft\\Edge\\NativeMessagingHosts\\' + HOST_NAME,
  'HKLM\\Software\\WOW6432Node\\Naver\\Whale\\NativeMessagingHosts\\' + HOST_NAME
];

function buildHostManifest(installDir, extensionOrigins) {
  const hostCmd = path.join(installDir, 'native-host', 'OksooMailHost.cmd');
  return {
    name: HOST_NAME,
    description: 'OKSOOHT Security Mail Logger Native Host',
    path: hostCmd,
    type: 'stdio',
    allowed_origins: extensionOrigins
  };
}

function writeHostManifest(manifestPath, manifest) {
  const dir = path.dirname(manifestPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
}

function registerNativeHost(installDir, userDataPath, extensionOrigins) {
  const origins = extensionOrigins && extensionOrigins.length
    ? extensionOrigins
    : [getExtensionOrigin()];

  const manifestPath = path.join(userDataPath, 'native-host-manifest.json');
  const manifest = buildHostManifest(installDir, origins);
  writeHostManifest(manifestPath, manifest);

  const bridgeInfoPath = path.join(userDataPath, 'mail-bridge.env');
  fs.writeFileSync(bridgeInfoPath, [
    `PORT=${fs.existsSync(path.join(userDataPath, 'mail-bridge.port')) ? fs.readFileSync(path.join(userDataPath, 'mail-bridge.port'), 'utf8').trim() : '38471'}`,
    `TOKEN=${fs.existsSync(path.join(userDataPath, 'mail-bridge.token')) ? fs.readFileSync(path.join(userDataPath, 'mail-bridge.token'), 'utf8').trim() : ''}`
  ].join('\n'), 'utf8');

  for (const regKey of BROWSER_REGISTRY_PATHS) {
    try {
      execSync(`reg add "${regKey}" /ve /d "${manifestPath}" /f`, { stdio: 'pipe' });
      console.log(`[MailNative] 등록: ${regKey}`);
    } catch (err) {
      console.warn(`[MailNative] 등록 실패 (${regKey}):`, err.message);
    }
  }

  return manifestPath;
}

function unregisterNativeHost(userDataPath) {
  for (const regKey of BROWSER_REGISTRY_PATHS) {
    try {
      execSync(`reg delete "${regKey}" /f`, { stdio: 'pipe' });
    } catch (_) {}
  }
  const manifestPath = path.join(userDataPath, 'native-host-manifest.json');
  if (fs.existsSync(manifestPath)) fs.unlinkSync(manifestPath);
}

module.exports = {
  HOST_NAME,
  registerNativeHost,
  unregisterNativeHost,
  buildHostManifest
};

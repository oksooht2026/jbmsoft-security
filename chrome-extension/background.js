// chrome-extension/background.js — MV3 service worker: webRequest + Native Messaging
importScripts('lib/mail-parser.js');

const NATIVE_HOST = 'com.oksoohitech.security.mail';
const recentKeys = new Map();
const DEDUPE_MS = 10000; // 10초 (연속 발송 메일 수집 보장)

function dedupeKey(payload) {
  return [
    payload.mail_host || '',
    payload.title || '',
    (payload.recipients || []).slice(0, 3).join(','),
    (payload.body || '').slice(0, 80)
  ].join('|');
}

function shouldSend(payload) {
  if (!payload.title && !payload.recipients?.length && !payload.body) return false;
  const key = dedupeKey(payload);
  const now = Date.now();
  if (recentKeys.get(key) && now - recentKeys.get(key) < DEDUPE_MS) return false;
  recentKeys.set(key, now);
  return true;
}

function sendToNative(payload) {
  return new Promise((resolve) => {
    try {
      const port = chrome.runtime.connectNative(NATIVE_HOST);
      port.onMessage.addListener((resp) => {
        port.disconnect();
        resolve(resp);
      });
      port.onDisconnect.addListener(() => {
        if (chrome.runtime.lastError) {
          console.warn('[OKSOO Mail]', chrome.runtime.lastError.message);
        }
        resolve({ success: false, error: chrome.runtime.lastError?.message || 'disconnected' });
      });
      port.postMessage({ type: 'mail_send', payload });
    } catch (err) {
      resolve({ success: false, error: err.message });
    }
  });
}

async function handleMailPayload(payload, source) {
  payload.source = source;
  if (!payload.timestamp) payload.timestamp = new Date().toISOString();
  if (!shouldSend(payload)) return;

  const resp = await sendToNative(payload);
  if (!resp?.success) {
    console.warn('[OKSOO Mail] Native host 전달 실패:', resp?.error);
  }
}

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.method !== 'POST') return;
    if (!MailParser.isMailSendUrl(details.url)) return;

    const parsed = MailParser.parseRequestBody(details.requestBody);
    const payload = MailParser.buildMailPayload(details.url, parsed, {
      pageUrl: details.initiator || details.documentUrl || details.url
    });
    handleMailPayload(payload, 'webRequest');
  },
  {
    urls: [
      '*://mail.naver.com/*',
      '*://mail.google.com/*',
      '*://*.daouoffice.com/*',
      '*://mail.daum.net/*',
      '*://*.outlook.com/*',
      '*://*.office365.com/*',
      '*://*.office.com/*',
      '*://mail.kakao.com/*',
      '*://*/*mail*/*',
      '*://*/*groupware*/*'
    ],
    types: ['xmlhttprequest', 'main_frame', 'sub_frame']
  },
  ['requestBody']
);

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'mail_send_detected' && msg.payload) {
    handleMailPayload(msg.payload, 'content_script').then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg.type === 'ping_native') {
    sendToNative({ type: 'ping' }).then(sendResponse);
    return true;
  }
});

chrome.runtime.onInstalled.addListener(() => {
  console.log('[OKSOO Mail] Extension installed');
});

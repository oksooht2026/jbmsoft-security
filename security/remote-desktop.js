// security/remote-desktop.js
// 옥수하이테크 보안솔루션 - 원격 데스크톱 에이전트 모듈
// 블로그 참고 구현 (squarelike.tistory.com/7) - Python TCP → Node.js WebSocket 변환
//
// 동작 흐름:
//   1. 릴레이 서버에 'agent'로 WebSocket 연결
//   2. 관리자가 접속하면 릴레이가 'start_stream' 명령 전달
//   3. desktopCapturer로 화면 캡처 → JPEG → WebSocket 전송 (5fps)
//   4. 관리자의 마우스/키보드 명령을 받아 PowerShell로 실행

const { desktopCapturer, screen, Notification } = require('electron');
const WebSocket = require('ws');
const { exec } = require('child_process');
const serverSync = require('./server-sync');

const RELAY_SECRET = 'oksooht-remote-2026';
const CAPTURE_FPS  = 5;   // 초당 프레임
const JPEG_QUALITY = 60;  // JPEG 품질 (0~100)
const CAPTURE_SCALE = 0.75; // 캡처 크기 비율 (성능 vs 화질)

let ws = null;
let streamInterval = null;
let isStreaming = false;
let relayUrl = '';
let macAddress = '';
let reconnectTimer = null;
let enabled = false;

// ─── 초기화 ───

function init(mac, url) {
  macAddress = mac;
  if (url) {
    relayUrl = url;
    enabled = true;
    connect();
  }
}

function setRelayUrl(url) {
  if (url === relayUrl) return;
  relayUrl = url;
  if (url) {
    enabled = true;
    if (!ws || ws.readyState !== WebSocket.OPEN) connect();
  } else {
    enabled = false;
    disconnect();
  }
}

// ─── WebSocket 연결 관리 ───

function connect() {
  if (!relayUrl || !macAddress) return;
  if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) return;

  try {
    ws = new WebSocket(relayUrl, { handshakeTimeout: 10000 });
  } catch (e) {
    console.warn('[RemoteDesktop] WebSocket 생성 실패:', e.message);
    scheduleReconnect();
    return;
  }

  ws.on('open', () => {
    ws.send(JSON.stringify({ role: 'agent', pcId: macAddress, secret: RELAY_SECRET }));
    console.log('[RemoteDesktop] 릴레이 서버 연결됨');
  });

  ws.on('message', (data, isBinary) => {
    if (isBinary) return;
    try {
      const msg = JSON.parse(data.toString());
      switch (msg.type) {
        case 'start_stream':  startStream(); break;
        case 'stop_stream':   stopStream(); break;
        case 'mouse_move':    moveMouse(msg.x, msg.y); break;
        case 'mouse_click':   clickMouse(msg.x, msg.y, msg.button || 'left', msg.double || false); break;
        case 'mouse_scroll':  scrollMouse(msg.x, msg.y, msg.delta || 0); break;
        case 'key_press':     sendKey(msg.key, msg.modifiers || []); break;
      }
    } catch (_) {}
  });

  ws.on('close', () => {
    stopStream();
    ws = null;
    console.log('[RemoteDesktop] 릴레이 연결 종료');
    if (enabled) scheduleReconnect();
  });

  ws.on('error', (err) => {
    console.warn('[RemoteDesktop] 연결 오류:', err.message);
  });
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (enabled && relayUrl) connect();
  }, 8000);
}

function disconnect() {
  enabled = false;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  stopStream();
  if (ws) {
    ws.removeAllListeners();
    try { ws.close(); } catch (_) {}
    ws = null;
  }
}

// ─── 화면 스트리밍 ───

function startStream() {
  if (streamInterval) return;
  isStreaming = true;
  console.log(`[RemoteDesktop] 화면 스트리밍 시작 (${CAPTURE_FPS}fps)`);

  // 보안 감사 로그 전송
  serverSync.sendLog('remote_desktop_start', 'warning', '원격 데스크톱 세션 시작됨', {
    relay: relayUrl
  }).catch(() => {});

  // 사용자에게 원격 접속 알림 표시
  try {
    if (Notification.isSupported()) {
      new Notification({
        title: '⚠️ 원격 모니터링 시작',
        body: '관리자가 이 PC를 원격으로 모니터링하고 있습니다.',
        urgency: 'critical'
      }).show();
    }
  } catch (_) {}

  streamInterval = setInterval(captureAndSend, Math.round(1000 / CAPTURE_FPS));
}

function stopStream() {
  if (!streamInterval) return;
  clearInterval(streamInterval);
  streamInterval = null;
  isStreaming = false;
  console.log('[RemoteDesktop] 화면 스트리밍 중지');
  serverSync.sendLog('remote_desktop_stop', 'info', '원격 데스크톱 세션 종료됨', {}).catch(() => {});
}

async function captureAndSend() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  try {
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.size;

    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: {
        width:  Math.round(width  * CAPTURE_SCALE),
        height: Math.round(height * CAPTURE_SCALE)
      }
    });

    if (sources.length > 0 && ws && ws.readyState === WebSocket.OPEN) {
      const jpeg = sources[0].thumbnail.toJPEG(JPEG_QUALITY);
      ws.send(jpeg, { binary: true });
    }
  } catch (_) {
    // 캡처 실패 (예: 잠금 화면) 는 무시
  }
}

// ─── 마우스 제어 (Windows user32.dll + PowerShell) ───

function runPS(script) {
  exec(`powershell -NoProfile -NonInteractive -Command ${JSON.stringify(script)}`, () => {});
}

function moveMouse(x, y) {
  runPS(`Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${x | 0}, ${y | 0})`);
}

// C# 인라인 코드로 user32.dll mouse_event 직접 호출
const MOUSE_CLICK_PS = `
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class MouseCtrl {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(int dwFlags, int dx, int dy, int cButtons, int dwExtraInfo);
  public const int LEFTDOWN  = 0x0002;
  public const int LEFTUP    = 0x0004;
  public const int RIGHTDOWN = 0x0008;
  public const int RIGHTUP   = 0x0010;
  public const int MIDDLEDOWN = 0x0020;
  public const int MIDDLEUP   = 0x0040;
  public const int WHEEL      = 0x0800;
}
'@
`;

function clickMouse(x, y, button, dbl) {
  const btnDown = button === 'right' ? 'RIGHTDOWN' : button === 'middle' ? 'MIDDLEDOWN' : 'LEFTDOWN';
  const btnUp   = button === 'right' ? 'RIGHTUP'   : button === 'middle' ? 'MIDDLEUP'   : 'LEFTUP';
  const extra   = dbl ? `[MouseCtrl]::mouse_event([MouseCtrl]::${btnDown},0,0,0,0)\n[MouseCtrl]::mouse_event([MouseCtrl]::${btnUp},0,0,0,0)` : '';

  runPS(`${MOUSE_CLICK_PS}
[MouseCtrl]::SetCursorPos(${x | 0}, ${y | 0})
[MouseCtrl]::mouse_event([MouseCtrl]::${btnDown},0,0,0,0)
[MouseCtrl]::mouse_event([MouseCtrl]::${btnUp},0,0,0,0)
${extra}`);
}

function scrollMouse(x, y, delta) {
  runPS(`${MOUSE_CLICK_PS}
[MouseCtrl]::SetCursorPos(${x | 0}, ${y | 0})
[MouseCtrl]::mouse_event([MouseCtrl]::WHEEL, 0, 0, ${(delta * 120) | 0}, 0)`);
}

// ─── 키보드 제어 (Windows SendKeys via PowerShell) ───

const KEY_MAP = {
  Enter: '{ENTER}', Backspace: '{BACKSPACE}', Delete: '{DELETE}', Escape: '{ESC}',
  Tab: '{TAB}', ArrowUp: '{UP}', ArrowDown: '{DOWN}', ArrowLeft: '{LEFT}', ArrowRight: '{RIGHT}',
  Home: '{HOME}', End: '{END}', PageUp: '{PGUP}', PageDown: '{PGDN}',
  Insert: '{INS}', F1: '{F1}', F2: '{F2}', F3: '{F3}', F4: '{F4}',
  F5: '{F5}', F6: '{F6}', F7: '{F7}', F8: '{F8}', F9: '{F9}',
  F10: '{F10}', F11: '{F11}', F12: '{F12}',
  ' ': ' ', '+': '{+}', '^': '{^}', '%': '{%}', '~': '{~}',
  '(': '{(}', ')': '{)}', '{': '{{}', '}': '{}}', '[': '{[}', ']': '{]}',
};

function sendKey(key, modifiers) {
  let k = KEY_MAP[key];
  if (!k) {
    if (key.length !== 1) return;
    k = key;
  }

  // 수식키 적용 (SendKeys 형식: ^=Ctrl, %=Alt, +=Shift)
  if (modifiers.includes('shift')) k = `+${k}`;
  if (modifiers.includes('ctrl'))  k = `^${k}`;
  if (modifiers.includes('alt'))   k = `%${k}`;

  const escaped = k.replace(/'/g, "''");
  runPS(`Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${escaped}')`);
}

// ─── 상태 조회 ───

function getStatus() {
  return {
    enabled,
    isStreaming,
    relayUrl,
    connected: !!(ws && ws.readyState === WebSocket.OPEN)
  };
}

module.exports = { init, connect, disconnect, setRelayUrl, getStatus };

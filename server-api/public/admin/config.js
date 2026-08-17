// admin-panel/config.js
const ADMIN_CONFIG = {
  API_BASE: 'https://oksooht-security-api.vercel.app/api',
  HEADERS: {
    'Content-Type': 'application/json',
    'x-api-key': 'oksooht-security-2026'
  }
};

// 모든 스크립트 블록에서 공유 (const 스코프 분리 문제 방지)
window.API_BASE = ADMIN_CONFIG.API_BASE;
window.HEADERS = ADMIN_CONFIG.HEADERS;

const SESSION_KEY = 'oksooht_admin_session';

function saveAdminSession(password) {
  sessionStorage.setItem(SESSION_KEY, btoa(password));
}

function clearAdminSession() {
  sessionStorage.removeItem(SESSION_KEY);
}

function getAdminSession() {
  try {
    const v = sessionStorage.getItem(SESSION_KEY);
    return v ? atob(v) : null;
  } catch (_) { return null; }
}

function isAdminLoggedIn() {
  return !!getAdminSession();
}

async function verifyAdminPassword(password) {
  const res = await fetch(`${ADMIN_CONFIG.API_BASE}/admin-login`, {
    method: 'POST',
    headers: ADMIN_CONFIG.HEADERS,
    body: JSON.stringify({ password })
  });
  if (res.status === 401) return false;
  if (!res.ok) throw new Error('login failed');
  const data = await res.json();
  return data.ok === true;
}

// admin-panel/config.js — OKSOOHT 공통 API·인증 설정
const ADMIN_CONFIG = {
  ADMIN_URL: 'https://oksooht-security-api.vercel.app/admin',
  API_BASE: 'https://oksooht-security-api.vercel.app/api',
  HEADERS: {
    'Content-Type': 'application/json',
    'x-api-key': 'oksooht-security-2026'
  },
  SESSION_KEY: 'oksooht_admin_session'
};

async function verifyAdminPassword(password) {
  const res = await fetch(`${ADMIN_CONFIG.API_BASE}/settings`, {
    method: 'PUT',
    headers: ADMIN_CONFIG.HEADERS,
    body: JSON.stringify({ key: 'admin_password', value: password, current_password: password })
  });
  return res.ok;
}

function saveAdminSession(password) {
  sessionStorage.setItem(ADMIN_CONFIG.SESSION_KEY, password);
}

function getAdminSession() {
  return sessionStorage.getItem(ADMIN_CONFIG.SESSION_KEY) || '';
}

function clearAdminSession() {
  sessionStorage.removeItem(ADMIN_CONFIG.SESSION_KEY);
}

function isAdminLoggedIn() {
  return !!getAdminSession();
}

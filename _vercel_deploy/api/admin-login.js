// server-api/api/admin-login.js
const supabase = require('./lib/supabase');

function parseVal(v) {
  try { return JSON.parse(v); } catch (_) { return v; }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { password } = req.body || {};
  try {
    const { data } = await supabase.from('settings').select('value').eq('key', 'admin_password').single();
    const stored = data ? parseVal(data.value) : 'oksooht2026';
    const ok = String(stored) === String(password);
    return res.status(ok ? 200 : 401).json({ ok });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// server-api/api/realtime-config.js — Supabase Realtime anon 설정 (관리자 패널)
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const url = process.env.SUPABASE_URL || '';
  const anonKey = process.env.SUPABASE_ANON_KEY || '';

  if (!url || !anonKey) {
    return res.status(200).json({ url: null, anonKey: null, channel: 'oksooht-admin-notify' });
  }

  return res.status(200).json({ url, anonKey, channel: 'oksooht-admin-notify' });
};

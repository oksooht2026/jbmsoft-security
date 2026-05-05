// server-api/api/register.js
const supabase = require('./lib/supabase');

module.exports = async (req, res) => {
  // CORS 설정
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { hostname, mac_address, ip_address, username, dept } = req.body;

  try {
    // 1. PC 등록 또는 업데이트 (Upsert)
    const { data, error } = await supabase
      .from('pcs')
      .upsert({
        hostname,
        mac_address,
        ip_address,
        username,
        dept,
        last_seen: new Date().toISOString(),
        status: 'online'
      }, { onConflict: 'mac_address' })
      .select();

    if (error) throw error;

    res.status(200).json({ success: true, pc: data[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

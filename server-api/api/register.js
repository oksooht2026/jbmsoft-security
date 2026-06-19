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
    // 1. 기존 기기인지 확인
    const { data: existingPc } = await supabase
      .from('pcs')
      .select('id')
      .eq('mac_address', mac_address)
      .single();

    if (!existingPc) {
      // 새로운 기기 등록 시도이므로, 라이선스 한도 확인
      const { data: pcsData } = await supabase.from('pcs').select('id', { count: 'exact' });
      const currentCount = pcsData ? pcsData.length : 0;

      const { data: setData } = await supabase.from('settings').select('value').eq('key', 'license_limit').single();
      let limit = 42; // 기본값
      if (setData && setData.value) {
          try { limit = parseInt(setData.value, 10); } catch(e) {}
      }

      if (currentCount >= limit) {
          return res.status(403).json({ error: 'LICENSE_LIMIT_EXCEEDED', message: '라이선스 수량이 초과되었습니다. 관리자에게 문의하세요.' });
      }
    }

    // 2. PC 등록 또는 업데이트 (Upsert)
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

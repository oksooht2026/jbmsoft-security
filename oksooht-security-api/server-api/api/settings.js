// server-api/api/settings.js
const supabase = require('./lib/supabase');
const { bumpAdminNotify } = require('./lib/notify-admin');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    try {
      const { data, error } = await supabase
        .from('settings')
        .select('*');
      
      if (error) throw error;
      
      // 변환 로직: { "blocked_extensions": [...], "usb_blocking_enabled": true } 형태로 반환
      const settingsObj = {};
      data.forEach(item => {
          try {
              settingsObj[item.key] = JSON.parse(item.value);
          } catch(e) {
              settingsObj[item.key] = item.value;
          }
      });
      return res.status(200).json(settingsObj);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === 'PUT') {
    const { key, value, current_password, password } = req.body;
    try {
      // license_limit 변경 시 비밀번호 검증 (aazz1234!! -> sha256 hash)
      if (key === 'license_limit') {
          const crypto = require('crypto');
          const hash = crypto.createHash('sha256').update(password || '').digest('hex');
          if (hash !== '77b30e22e5f59172e970161102eca0b186b9700df0ccee008b12d6e1404fc7a6') {
              return res.status(401).json({ error: '비밀번호가 올바르지 않습니다.' });
          }
      }

      // admin_password 변경 시 기존 비밀번호 검증
      if (key === 'admin_password') {
          const { data: oldData } = await supabase.from('settings').select('value').eq('key', 'admin_password').single();
          if (oldData && oldData.value) {
              let storedPassword = oldData.value;
              try { storedPassword = JSON.parse(storedPassword); } catch(e) {}
              
              if (storedPassword && storedPassword !== current_password) {
                  return res.status(401).json({ error: '현재 비밀번호가 일치하지 않습니다.' });
              }
              if (String(storedPassword) === String(value)) {
                  return res.status(200).json({ success: true, unchanged: true });
              }
          }
      }

      const { data, error } = await supabase
        .from('settings')
        .update({ value, updated_at: new Date().toISOString() })
        .eq('key', key)
        .select();
      
      if (error) throw error;

      // 정책 변경 시 버전 갱신 → 클라이언트가 변경 감지 후 전체 정책 수신
      await supabase.from('settings').upsert(
        { key: 'policy_version', value: String(Date.now()) },
        { onConflict: 'key' }
      );
      if (key !== 'admin_notify_version') {
        await bumpAdminNotify();
      }

      return res.status(200).json({ success: true, policy: data[0] });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  res.status(405).json({ error: 'Method not allowed' });
};

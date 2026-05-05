// server-api/api/settings.js
const supabase = require('./lib/supabase');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

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
    const { key, value } = req.body;
    try {
      const { data, error } = await supabase
        .from('settings')
        .update({ value, updated_at: new Date().toISOString() })
        .eq('key', key)
        .select();
      
      if (error) throw error;
      return res.status(200).json({ success: true, policy: data[0] });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  res.status(405).json({ error: 'Method not allowed' });
};

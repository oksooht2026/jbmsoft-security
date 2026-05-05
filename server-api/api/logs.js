// server-api/api/logs.js
const supabase = require('./lib/supabase');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'POST') {
    const { logs } = req.body; // logs는 배열 형태 [{ pc_id, log_type, message, ... }]
    try {
      const { data, error } = await supabase
        .from('security_logs')
        .insert(logs);
      if (error) throw error;
      return res.status(200).json({ success: true, count: data?.length });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === 'GET') {
    const { limit = 100, type } = req.query;
    try {
      let query = supabase.from('security_logs').select('*').order('timestamp', { ascending: false }).limit(limit);
      if (type && type !== 'all') query = query.eq('log_type', type);
      
      const { data, error } = await query;
      if (error) throw error;
      return res.status(200).json(data);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  res.status(405).json({ error: 'Method not allowed' });
};

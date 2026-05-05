// server-api/api/logs.js
const supabase = require('./lib/supabase');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // POST: 단일 로그 전송 (클라이언트 PC에서 호출)
  if (req.method === 'POST') {
    const { hostname, mac_address, event_type, severity, message, details } = req.body;

    // mac_address로 pc_id 조회
    let pc_id = null;
    if (mac_address) {
      const { data: pc } = await supabase
        .from('pcs')
        .select('id')
        .eq('mac_address', mac_address)
        .single();
      if (pc) pc_id = pc.id;
    }

    try {
      const { data, error } = await supabase
        .from('logs')
        .insert({
          pc_id,
          hostname,
          event_type: event_type || 'general',
          severity: severity || 'info',
          message,
          details: details || {},
          created_at: new Date().toISOString()
        })
        .select();

      if (error) throw error;
      return res.status(201).json(data[0]);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // GET: 로그 조회 (관리자 웹에서 호출)
  if (req.method === 'GET') {
    const { limit = 100, event_type, severity, hostname } = req.query;
    try {
      let query = supabase
        .from('logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(parseInt(limit));

      if (event_type && event_type !== 'all') query = query.eq('event_type', event_type);
      if (severity && severity !== 'all') query = query.eq('severity', severity);
      if (hostname) query = query.eq('hostname', hostname);

      const { data, error } = await query;
      if (error) throw error;
      return res.status(200).json(data);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  res.status(405).json({ error: 'Method not allowed' });
};

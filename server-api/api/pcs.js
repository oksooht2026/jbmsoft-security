// server-api/api/pcs.js
const supabase = require('./lib/supabase');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // API Key 인증
  const apiKey = req.headers['x-api-key'];
  if (apiKey !== process.env.API_SECRET_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (req.method === 'GET') {
    try {
      const { data, error } = await supabase
        .from('pcs')
        .select('*')
        .order('last_seen', { ascending: false });

      if (error) throw error;

      // 온라인 상태 계산 (2분 이내 last_seen = 온라인)
      const twoMinsAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
      const pcsWithStatus = data.map(pc => ({
        ...pc,
        is_online: pc.last_seen > twoMinsAgo
      }));

      return res.status(200).json(pcsWithStatus);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === 'DELETE') {
    const { mac_address } = req.query;
    try {
      const { error } = await supabase
        .from('pcs')
        .delete()
        .eq('mac_address', mac_address);

      if (error) throw error;
      return res.status(200).json({ success: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  res.status(405).json({ error: 'Method not allowed' });
};

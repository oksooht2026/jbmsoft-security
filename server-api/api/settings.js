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
        .from('security_settings')
        .select('*')
        .eq('key', 'global_policy')
        .single();
      
      if (error) throw error;
      return res.status(200).json(data.value);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === 'PUT') {
    const { policy } = req.body;
    try {
      const { data, error } = await supabase
        .from('security_settings')
        .update({ value: policy, updated_at: new Date().toISOString() })
        .eq('key', 'global_policy')
        .select();
      
      if (error) throw error;
      return res.status(200).json({ success: true, policy: data[0].value });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  res.status(405).json({ error: 'Method not allowed' });
};

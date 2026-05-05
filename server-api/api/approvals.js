// server-api/api/approvals.js
const supabase = require('./lib/supabase');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET: 승인 요청 목록 조회
  if (req.method === 'GET') {
    const { status } = req.query;
    try {
      let query = supabase
        .from('approvals')
        .select('*')
        .order('timestamp', { ascending: false })
        .limit(100);

      if (status && status !== 'all') {
        query = query.eq('status', status);
      }

      const { data, error } = await query;
      if (error) throw error;
      return res.status(200).json(data);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // POST: 새 승인 요청 등록 (클라이언트 PC가 호출)
  if (req.method === 'POST') {
    const { pc_id, filename, recipient, requester, pc_name, ip_address } = req.body;
    try {
      const { data, error } = await supabase
        .from('approvals')
        .insert({ pc_id, filename, recipient, requester, status: 'pending' })
        .select();

      if (error) throw error;
      return res.status(201).json(data[0]);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // PUT: 승인/거부 처리 (관리자 웹에서 호출)
  if (req.method === 'PUT') {
    const { id } = req.query;
    const { approved } = req.body;
    try {
      const { data, error } = await supabase
        .from('approvals')
        .update({
          status: approved ? 'approved' : 'rejected',
          resolved_at: new Date().toISOString()
        })
        .eq('id', id)
        .select();

      if (error) throw error;
      return res.status(200).json(data[0]);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  res.status(405).json({ error: 'Method not allowed' });
};

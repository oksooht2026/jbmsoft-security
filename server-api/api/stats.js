// server-api/api/stats.js
const supabase = require('./lib/supabase');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // 1. 전체 PC 수
    const { count: pcCount } = await supabase.from('pcs').select('*', { count: 'exact', head: true });
    
    // 2. 온라인 PC 수 (최근 5분 이내 하트비트)
    const fiveMinsAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { count: onlineCount } = await supabase
      .from('pcs')
      .select('*', { count: 'exact', head: true })
      .gt('last_seen', fiveMinsAgo);

    // 3. 오늘 차단된 로그 수
    const today = new Date();
    today.setHours(0,0,0,0);
    const { count: blockedToday } = await supabase
      .from('security_logs')
      .select('*', { count: 'exact', head: true })
      .eq('log_type', 'blocked')
      .gt('timestamp', today.toISOString());

    // 4. 대기 중인 승인 요청 수
    const { count: pendingApprovals } = await supabase
      .from('approvals')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending');

    res.status(200).json({
      totalPcs: pcCount || 0,
      onlinePcs: onlineCount || 0,
      blockedToday: blockedToday || 0,
      pendingApprovals: pendingApprovals || 0
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

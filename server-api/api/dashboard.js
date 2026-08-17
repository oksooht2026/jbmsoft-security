// server-api/api/dashboard.js — 관리자 대시보드 통합 API
const supabase = require('./lib/supabase');

function mapApproval(row) {
  const details = row.details || {};
  const type = row.request_type || details.type || 'file_transfer';
  const filename = details.filename || row.filename || row.file_name || `[${type}]`;
  return {
    id: row.id,
    pc_id: row.pc_id,
    request_type: type,
    filename,
    recipient: details.recipient || JSON.stringify({ type, ...details }),
    requester: row.requested_by || details.requester,
    status: row.status,
    timestamp: row.created_at,
    resolved_at: row.approved_at || null,
    pc_name: row.pcs?.hostname || row.requested_by,
    ip_address: row.pcs?.ip_address || null,
    details
  };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // 하트비트가 5분 주기라 여유를 두고 15분 이내 last_seen = Online
    const onlineThresholdAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [pcsRes, logsRes, approvalsRes, pendingRes] = await Promise.all([
      supabase.from('pcs').select('*').order('last_seen', { ascending: false }).limit(100),
      supabase.from('logs').select('*').order('created_at', { ascending: false }).limit(30),
      supabase
        .from('approvals')
        .select('*, pcs(hostname, ip_address, username)')
        .order('created_at', { ascending: false })
        .limit(100),
      supabase
        .from('approvals')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending')
    ]);

    if (pcsRes.error) throw pcsRes.error;
    if (logsRes.error) throw logsRes.error;
    if (approvalsRes.error) throw approvalsRes.error;

    const pcs = (pcsRes.data || []).map(pc => ({
      ...pc,
      is_online: pc.last_seen && new Date(pc.last_seen) >= new Date(onlineThresholdAgo)
    }));

    const logs = logsRes.data || [];
    const approvals = (approvalsRes.data || []).map(mapApproval);

    const blockedToday = logs.filter(l => {
      const sev = (l.severity || '').toLowerCase();
      const isBlock = sev === 'critical' || sev === 'warning';
      const created = l.created_at ? new Date(l.created_at) : null;
      return isBlock && created && created >= todayStart;
    }).length;

    const onlinePcs = pcs.filter(p => p.is_online).length;
    const registeredPcs = pcs.length;
    const pendingApprovals = pendingRes.count ?? approvals.filter(a => a.status === 'pending').length;

    return res.status(200).json({
      stats: { onlinePcs, registeredPcs, blockedToday, pendingApprovals },
      pcs,
      logs,
      approvals
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

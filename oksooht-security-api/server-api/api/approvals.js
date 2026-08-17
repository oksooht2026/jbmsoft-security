// server-api/api/approvals.js
const supabase = require('./lib/supabase');
const { bumpAdminNotify } = require('./lib/notify-admin');

function parseRecipient(raw) {
  if (!raw) return {};
  try {
    return typeof raw === 'string' && raw.startsWith('{') ? JSON.parse(raw) : { value: raw };
  } catch (_) {
    return { value: raw };
  }
}

function inferRequestType(body) {
  if (body.request_type) return body.request_type;
  const meta = parseRecipient(body.recipient);
  if (meta.type) return meta.type;
  const fname = body.filename || body.file_name || '';
  if (fname.startsWith('[USB]')) return 'usb_connect';
  if (fname.startsWith('[MAIL]')) return meta.provider ? 'webmail_access' : 'mail_send';
  if (fname.startsWith('[FILE]')) return 'file_transfer';
  return 'file_transfer';
}

function buildFilename(type, body, meta) {
  const fname = body.filename || body.file_name;
  if (fname) return fname;
  switch (type) {
    case 'usb_connect':
      return `[USB] ${meta.drive || '드라이브'} 연결 요청`;
    case 'mail_send':
      return `[MAIL] ${meta.email || '외부 수신자'}`;
    case 'webmail_access':
      return `[MAIL] ${meta.provider || '웹메일'} 접속 요청`;
    case 'file_transfer':
      return `[FILE] ${meta.filename || meta.filePath || '파일 요청'}`;
    default:
      return body.reason || '보안 요청';
  }
}

function mapApprovalRow(row) {
  const details = row.details || {};
  const meta = parseRecipient(details.recipient || details.meta);
  const type = row.request_type || meta.type || 'file_transfer';
  const filename = details.filename || buildFilename(type, details, meta);

  return {
    id: row.id,
    pc_id: row.pc_id,
    request_type: type,
    filename,
    recipient: details.recipient || JSON.stringify({ type, ...meta, ...details }),
    requester: row.requested_by || details.requester || 'unknown',
    status: row.status,
    timestamp: row.created_at,
    resolved_at: row.approved_at || null,
    approved_by: row.approved_by,
    pc_name: row.pcs?.hostname || row.requested_by,
    ip_address: row.pcs?.ip_address || null,
    details
  };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    const { status, mac_address } = req.query;
    try {
      let query = supabase
        .from('approvals')
        .select('*, pcs(hostname, ip_address, username)')
        .order('created_at', { ascending: false })
        .limit(100);

      if (status && status !== 'all') query = query.eq('status', status);

      if (mac_address) {
        const { data: pc } = await supabase
          .from('pcs')
          .select('id')
          .eq('mac_address', mac_address)
          .single();
        if (pc) {
          query = query.eq('pc_id', pc.id);
        } else {
          return res.status(200).json([]);
        }
      }

      const { data, error } = await query;
      if (error) throw error;
      return res.status(200).json((data || []).map(mapApprovalRow));
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === 'POST') {
    const body = req.body || {};
    const {
      pc_id, filename, file_name, recipient, requester, reason,
      mac_address, hostname, request_type, requested_by, details
    } = body;

    const type = inferRequestType(body);
    const meta = parseRecipient(recipient);
    const fname = buildFilename(type, body, meta);

    try {
      let resolvedPcId = pc_id || null;
      if (!resolvedPcId && mac_address) {
        const { data: pc } = await supabase.from('pcs').select('id').eq('mac_address', mac_address).single();
        if (pc) resolvedPcId = pc.id;
      }

      const detailPayload = {
        ...(details || {}),
        ...meta,
        filename: fname,
        recipient: recipient || reason || '',
        reason: reason || '',
        requester: requester || hostname || 'unknown'
      };

      const { data, error } = await supabase
        .from('approvals')
        .insert({
          pc_id: resolvedPcId,
          request_type: type,
          details: detailPayload,
          requested_by: requested_by || requester || hostname || 'unknown',
          status: 'pending'
        })
        .select('*, pcs(hostname, ip_address, username)');

      if (error) throw error;
      await bumpAdminNotify();
      return res.status(201).json(mapApprovalRow(data[0]));
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === 'PUT') {
    const { id } = req.query;
    const { approved, approved_by } = req.body;
    try {
      const { data, error } = await supabase
        .from('approvals')
        .update({
          status: approved ? 'approved' : 'rejected',
          approved_by: approved_by || 'admin-panel'
        })
        .eq('id', id)
        .select('*, pcs(hostname, ip_address, username)');

      if (error) throw error;
      await bumpAdminNotify();
      return res.status(200).json(mapApprovalRow(data[0]));
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  res.status(405).json({ error: 'Method not allowed' });
};

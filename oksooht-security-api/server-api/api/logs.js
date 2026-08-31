// server-api/api/logs.js
const crypto = require('crypto');
const supabase = require('./lib/supabase');
const { bumpAdminNotify } = require('./lib/notify-admin');

// 메일 감사 로그는 여러 감시 채널(확장·SSL 프록시·UIA)이 동시에 켜져 있어
// 같은 메일 1건이 채널별로 각각 감지될 수 있음. 절대 드롭/차단하지 않고
// (0% 누락 요구사항 유지) 대신 "동일 이벤트로 추정" 태그만 남겨
// 관리자 패널에서 표시만 묶어줄 수 있도록 함.
const MAIL_AUDIT_TYPES = new Set(['mail_send_audit', 'mail_compose_audit', 'webmail_access_audit']);

function computeMailDedupeKey(details) {
  if (!details) return null;
  const recipients = Array.isArray(details.recipients)
    ? details.recipients.map(r => String(r).trim().toLowerCase()).filter(Boolean).sort()
    : [];
  const subject = String(details.subject || '').trim().toLowerCase().slice(0, 200);
  const attachments = Array.isArray(details.attachments)
    ? details.attachments.map(a => String((a && (a.filename || a.name)) || a || '')).filter(Boolean).sort().join(',')
    : '';
  if (!recipients.length && !subject && !attachments) return null;
  return crypto.createHash('sha256').update(`${recipients.join(',')}|${subject}|${attachments}`).digest('hex').slice(0, 24);
}

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
      const finalDetails = { ...(details || {}) };
      if (MAIL_AUDIT_TYPES.has(event_type)) {
        const dedupeKey = computeMailDedupeKey(finalDetails);
        if (dedupeKey) finalDetails.dedupe_key = dedupeKey;
      }

      const { data, error } = await supabase
        .from('logs')
        .insert({
          pc_id,
          hostname,
          event_type: event_type || 'general',
          severity: severity || 'info',
          message,
          details: finalDetails,
          created_at: new Date().toISOString()
        })
        .select();

      if (error) throw error;
      if (severity === 'critical' || severity === 'warning') {
        await bumpAdminNotify();
      }
      return res.status(201).json(data[0]);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // GET: 로그 조회 (관리자 웹에서 호출)
  // category=file → 파일/USB 관련 이벤트만 (/file-logs 전용 페이지)
  const FILE_EVENT_TYPES = [
    'file_movement', 'file_event', 'usb_file_event',
    'extension_exec_blocked', 'usb_detected', 'usb_existing_detected'
  ];

  if (req.method === 'GET') {
    const { limit = 100, event_type, severity, hostname, category } = req.query;
    try {
      let query = supabase
        .from('logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(Math.min(parseInt(limit, 10) || 100, 1000));

      if (category === 'file') {
        query = query.in('event_type', FILE_EVENT_TYPES);
      } else if (event_type && event_type !== 'all') {
        query = query.eq('event_type', event_type);
      }
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

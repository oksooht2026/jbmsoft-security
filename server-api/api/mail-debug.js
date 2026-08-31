// server-api/api/mail-debug.js
// 메일 프록시 디버그 로그 — 개발자 전용 (dev_key 인증)
// 관리자 대시보드에서 완전히 숨김 / 일반 x-api-key로 접근 불가

const supabase = require('./lib/supabase');

// 개발자 전용 비밀키 (일반 API 키와 별도)
const DEV_KEY = process.env.MAIL_DEBUG_DEV_KEY || 'jbm-dev-mail-2026!@#';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-dev-key');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // dev_key 인증 — URL 쿼리 또는 헤더로 전달
  const devKey = req.headers['x-dev-key'] || (req.query && req.query.dev_key);
  if (devKey !== DEV_KEY) {
    return res.status(403).json({ error: 'forbidden' });
  }

  // ── POST: 클라이언트에서 디버그 로그 업로드 ──
  if (req.method === 'POST') {
    const {
      hostname, mac_address,
      url, host, decision, drop_reason,
      action_param, recipients, subject,
      body_length, has_attachments
    } = req.body || {};

    if (!hostname || !decision) {
      return res.status(400).json({ error: 'hostname and decision required' });
    }

    const { error } = await supabase.from('mail_debug_logs').insert({
      hostname,
      mac_address: mac_address || null,
      url: url || null,
      host: host || null,
      decision,
      drop_reason: drop_reason || null,
      action_param: action_param || null,
      recipients: recipients || [],
      subject: subject || null,
      body_length: body_length || 0,
      has_attachments: has_attachments || false,
      created_at: new Date().toISOString()
    });

    if (error) {
      console.error('[MailDebug] insert error:', error.message);
      return res.status(500).json({ error: error.message });
    }
    return res.status(201).json({ ok: true });
  }

  // ── GET: 디버그 로그 조회 ──
  if (req.method === 'GET') {
    const { pc, date, decision: filterDecision, limit = 200 } = req.query || {};

    let query = supabase
      .from('mail_debug_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(parseInt(limit, 10) || 200);

    if (pc) query = query.ilike('hostname', `%${pc}%`);
    if (date) {
      query = query
        .gte('created_at', `${date}T00:00:00Z`)
        .lte('created_at', `${date}T23:59:59Z`);
    }
    if (filterDecision) query = query.eq('decision', filterDecision.toUpperCase());

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    const total = data ? data.length : 0;
    const passed = data ? data.filter(r => r.decision === 'PASS').length : 0;
    const dropped = data ? data.filter(r => r.decision === 'DROP').length : 0;
    const dropReasons = {};
    if (data) {
      data.filter(r => r.drop_reason).forEach(r => {
        dropReasons[r.drop_reason] = (dropReasons[r.drop_reason] || 0) + 1;
      });
    }

    return res.status(200).json({
      summary: { total, passed, dropped, dropReasons },
      logs: data || []
    });
  }

  return res.status(405).json({ error: 'method not allowed' });
};

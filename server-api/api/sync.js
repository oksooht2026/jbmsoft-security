// server-api/api/sync.js
// 하트비트 + 정책 버전 확인 + (필요 시) 승인 동기화 — 1회 호출로 통합
const supabase = require('./lib/supabase');

function parseSettingValue(raw) {
  if (raw == null) return raw;
  try { return JSON.parse(raw); } catch (_) { return raw; }
}

function buildPolicy(settingsRows) {
  const policy = {};
  (settingsRows || []).forEach(item => {
    if (item.key === 'policy_version') return;
    policy[item.key] = parseSettingValue(item.value);
  });
  return policy;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    hostname, mac_address, ip_address, username, dept,
    policy_version: clientVersion = 0,
    needs_approvals: needsApprovals = false
  } = req.body;

  try {
    // ── 1. PC 등록/하트비트 ──
    const { data: existingPc } = await supabase
      .from('pcs')
      .select('id')
      .eq('mac_address', mac_address)
      .single();

    if (!existingPc) {
      const { data: pcsData } = await supabase.from('pcs').select('id', { count: 'exact' });
      const currentCount = pcsData ? pcsData.length : 0;
      const { data: setData } = await supabase.from('settings').select('value').eq('key', 'license_limit').single();
      let limit = 42;
      if (setData && setData.value) {
        try { limit = parseInt(setData.value, 10); } catch (_) {}
      }
      if (currentCount >= limit) {
        return res.status(403).json({ error: 'LICENSE_LIMIT_EXCEEDED', message: '라이선스 수량 초과' });
      }
    }

    const { data: pcRows, error: pcErr } = await supabase
      .from('pcs')
      .upsert({
        hostname,
        mac_address,
        ip_address,
        username,
        dept,
        last_seen: new Date().toISOString(),
        status: 'online'
      }, { onConflict: 'mac_address' })
      .select();

    if (pcErr) throw pcErr;
    const pc = pcRows[0];

    // ── 2. 정책 버전 확인 (변경 시에만 전체 정책 반환) ──
    const { data: allSettings } = await supabase.from('settings').select('key, value');
    const versionRow = (allSettings || []).find(s => s.key === 'policy_version');
    const serverVersion = parseInt(versionRow?.value || '0', 10);
    const clientVer = parseInt(clientVersion, 10) || 0;

    const response = {
      success: true,
      pc_id: pc.id,
      policy_version: serverVersion,
      policy_changed: serverVersion !== clientVer
    };

    if (serverVersion !== clientVer) {
      response.policy = buildPolicy(allSettings);
    }

    // ── 3. 승인 대기 중일 때만 승인 목록 반환 ──
    if (needsApprovals) {
      const { data: approvals } = await supabase
        .from('approvals')
        .select('*, pcs(hostname, ip_address)')
        .order('timestamp', { ascending: false })
        .limit(100);

      response.approvals = (approvals || []).map(row => ({
        ...row,
        pc_name: row.pcs?.hostname || row.requester,
        ip_address: row.pcs?.ip_address || null
      }));
    }

    return res.status(200).json(response);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

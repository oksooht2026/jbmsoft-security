// server-api/api/sync.js — 하트비트 + 정책 + 승인 + 원격업데이트 통합
const supabase = require('./lib/supabase');
const { bumpAdminNotify } = require('./lib/notify-admin');
const { resolveUsernameForUpsert } = require('./lib/pc-nickname');

function parseSettingValue(val) {
  if (val == null) return val;
  try { return JSON.parse(val); } catch (_) { return val; }
}

async function loadAllSettings() {
  const { data, error } = await supabase.from('settings').select('key, value');
  if (error) throw error;
  const obj = {};
  (data || []).forEach(row => { obj[row.key] = parseSettingValue(row.value); });
  return obj;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    hostname, mac_address, ip_address, username, os_version, app_version,
    policy_version: clientPolicyVersion = 0,
    needs_approvals: needsApprovals = false
  } = req.body || {};

  if (!mac_address) return res.status(400).json({ error: 'mac_address required' });

  try {
    const { data: existingPc } = await supabase
      .from('pcs').select('id').eq('mac_address', mac_address).single();

    if (!existingPc) {
      const { count } = await supabase.from('pcs').select('id', { count: 'exact', head: true });
      const settings = await loadAllSettings();
      const limit = parseInt(settings.license_limit, 10) || 42;
      if ((count || 0) >= limit) {
        return res.status(403).json({ error: 'LICENSE_LIMIT_EXCEEDED' });
      }
    }

    const resolvedUsername = await resolveUsernameForUpsert(supabase, mac_address, username);

    const { data: pcRows, error: pcErr } = await supabase.from('pcs').upsert({
      hostname,
      mac_address,
      ip_address,
      username: resolvedUsername,
      os_version,
      app_version,
      last_seen: new Date().toISOString(),
      status: 'online'
    }, { onConflict: 'mac_address' }).select();

    if (pcErr) throw pcErr;
    const pc = pcRows[0];

    const settings = await loadAllSettings();
    const serverPolicyVersion = parseInt(settings.policy_version, 10) || 0;
    const clientVer = parseInt(clientPolicyVersion, 10) || 0;
    const policyChanged = serverPolicyVersion !== clientVer;

    let policy = null;
    if (policyChanged || clientVer === 0) {
      policy = {
        blocked_extensions: settings.blocked_extensions || ['exe', 'bat', 'cmd', 'ps1', 'sh', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'hwp'],
        blocked_sites: settings.blocked_sites || [],
        usb_blocking_enabled: settings.usb_blocking_enabled !== false,
        mail_blocking_enabled: settings.mail_blocking_enabled !== false,
        clipboard_monitoring_enabled: settings.clipboard_monitoring_enabled !== false,
        process_monitoring_enabled: settings.process_monitoring_enabled !== false,
        screen_capture_guard_enabled: settings.screen_capture_guard_enabled !== false,
        email_whitelist: settings.email_whitelist || [],
        email_blacklist: settings.email_blacklist || [],
        allowed_mail_servers: settings.allowed_mail_servers || [],
        smtp_ports: settings.smtp_ports || [25, 465, 587, 993, 995, 110, 143],
        groupware_domains: settings.groupware_domains || ['oksooht.daouoffice.com'],
        admin_password: settings.admin_password || null,
        relay_url: settings.relay_url || process.env.RELAY_PUBLIC_URL || ''
      };
    }

    let approvals = null;
    if (needsApprovals) {
      const { data: appr } = await supabase
        .from('approvals')
        .select('*')
        .eq('pc_id', pc.id)
        .order('timestamp', { ascending: false })
        .limit(100);
      approvals = appr || [];
    }

    // 원격 업데이트 — settings에 update_version + update_url 이 있으면 클라이언트에 전달
    let update = null;
    if (settings.update_version && settings.update_url) {
      update = {
        version: String(settings.update_version),
        url: String(settings.update_url),
        sha256: settings.update_sha256 || null,
        size: settings.update_size ? parseInt(settings.update_size, 10) : null
      };
    }

    return res.status(200).json({
      pc_id: pc.id,
      policy_version: serverPolicyVersion,
      policy_changed: policyChanged,
      policy,
      approvals,
      update   // null이면 클라이언트가 무시, 값이 있으면 checkAndApply 실행
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// server-api/api/sync.js — 하트비트 + 정책 + 승인 + 원격업데이트 통합
const supabase = require('./lib/supabase');
const { bumpAdminNotify } = require('./lib/notify-admin');
const { resolveUsernameForUpsert } = require('./lib/pc-nickname');
const { isUpdateTargetedTo } = require('./lib/app-update-utils');

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

async function resolveUpdatePayload(settings, macAddress) {
  // 1) 신규 배포 형식: settings.app_update (GitHub Releases URL 또는 Supabase Storage)
  const appUpdate = settings.app_update;
  if (appUpdate && appUpdate.published && appUpdate.version) {
    if (!isUpdateTargetedTo(appUpdate, macAddress)) {
      return null;
    }

    let downloadUrl = appUpdate.download_url || null;
    if (!downloadUrl && appUpdate.storage_path) {
      try {
        const { data: signedData } = await supabase.storage
          .from('app-updates')
          .createSignedUrl(appUpdate.storage_path, 3600);
        if (signedData?.signedUrl) {
          downloadUrl = signedData.signedUrl;
        }
      } catch (_) {}
    }

    if (downloadUrl) {
      return {
        version: String(appUpdate.version),
        url: String(downloadUrl),
        sha256: appUpdate.sha256 || null,
        size: appUpdate.size ? parseInt(appUpdate.size, 10) : null
      };
    }
  }

  // 2) 레거시 형식 호환: settings.update_version && settings.update_url
  if (settings.update_version && settings.update_url) {
    return {
      version: String(settings.update_version),
      url: String(settings.update_url),
      sha256: settings.update_sha256 || null,
      size: settings.update_size ? parseInt(settings.update_size, 10) : null
    };
  }

  return null;
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
    needs_approvals: needsApprovals = false,
    update_status = null
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

    const upsertPayload = {
      hostname,
      mac_address,
      ip_address,
      username: resolvedUsername,
      last_seen: new Date().toISOString(),
      status: 'online'
    };
    if (app_version) upsertPayload.app_version = app_version;
    if (update_status) upsertPayload.update_status = update_status;

    let pc = null;
    try {
      const { data: pcRows, error: pcErr } = await supabase.from('pcs').upsert(upsertPayload, { onConflict: 'mac_address' }).select();
      if (pcErr) throw pcErr;
      pc = pcRows[0];
    } catch (upsertErr) {
      // app_version, update_status 컬럼이 없는 스키마 대비 폴백
      delete upsertPayload.app_version;
      delete upsertPayload.update_status;
      const { data: pcRows, error: pcErr } = await supabase.from('pcs').upsert(upsertPayload, { onConflict: 'mac_address' }).select();
      if (pcErr) throw pcErr;
      pc = pcRows[0];
    }

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

    // 원격 업데이트 — settings의 app_update(URL 또는 Storage) 확인 후 전달
    const update = await resolveUpdatePayload(settings, mac_address);

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

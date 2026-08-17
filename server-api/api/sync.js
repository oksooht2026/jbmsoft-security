// server-api/api/sync.js — 하트비트 + 정책 + 승인 + 원격 업데이트 통합
const supabase = require('./lib/supabase');
const { bumpAdminNotify } = require('./lib/notify-admin');
const { resolveUsernameForUpsert } = require('./lib/pc-nickname');
const { isNewerVersion, isUpdateTargetedTo } = require('./lib/app-update-utils');

async function loadAppUpdate() {
  const { data, error } = await supabase.from('settings').select('value').eq('key', 'app_update').single();
  if (error || !data) return null;
  try { return JSON.parse(data.value); } catch (_) { return null; }
}

/** 원격 업데이트 대상 여부 판단 + 다운로드 URL 해석 (실패해도 sync 자체는 절대 실패시키지 않음)
 *  우선순위: 외부 download_url(무료 티어) → Supabase Storage 서명 URL
 */
async function resolveUpdatePayload(macAddress, clientAppVersion) {
  try {
    const appUpdate = await loadAppUpdate();
    if (!appUpdate || !isUpdateTargetedTo(appUpdate, macAddress)) return null;
    if (!isNewerVersion(appUpdate.version, clientAppVersion)) return null;

    let url = null;
    if (appUpdate.download_url && /^https?:\/\//i.test(appUpdate.download_url)) {
      url = appUpdate.download_url;
    } else if (appUpdate.storage_path) {
      const { data: signed, error: signErr } = await supabase.storage
        .from('app-updates')
        .createSignedUrl(appUpdate.storage_path, 60 * 60 * 6); // 6시간 유효
      if (signErr || !signed?.signedUrl) return null;
      url = signed.signedUrl;
    } else {
      return null;
    }

    return {
      version: appUpdate.version,
      url,
      filename: appUpdate.filename,
      size: appUpdate.size || 0,
      sha256: appUpdate.sha256 || null,
      notes: appUpdate.notes || '',
      silent: appUpdate.silent !== false
    };
  } catch (_) {
    return null;
  }
}

/** pcs 테이블에 app_version/update_status 기록 — 컬럼 마이그레이션 전이어도 sync 자체는 영향 없음 */
async function recordAppVersionBestEffort(macAddress, appVersion, updateStatus) {
  try {
    const patch = {};
    if (appVersion) patch.app_version = appVersion;
    if (updateStatus !== undefined) patch.update_status = updateStatus || null;
    if (Object.keys(patch).length === 0) return;
    await supabase.from('pcs').update(patch).eq('mac_address', macAddress);
  } catch (err) {
    console.warn('[Sync] app_version/update_status 기록 스킵 (마이그레이션 필요 가능):', err.message);
  }
}

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
    needs_approvals: needsApprovals = false,
    update_status: updateStatus
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
        .order('created_at', { ascending: false })
        .limit(100);
      approvals = appr || [];
    }

    // 원격 업데이트: 대상 여부·버전 비교 후 다운로드 URL 발급 (실패해도 하트비트에는 영향 없음)
    // Vercel 서버리스는 응답 전송 후 즉시 함수를 종료할 수 있으므로 반드시 응답 전에 await 처리
    const [update] = await Promise.all([
      resolveUpdatePayload(mac_address, app_version),
      recordAppVersionBestEffort(mac_address, app_version, updateStatus)
    ]);

    return res.status(200).json({
      pc_id: pc.id,
      policy_version: serverPolicyVersion,
      policy_changed: policyChanged,
      policy,
      approvals,
      update
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

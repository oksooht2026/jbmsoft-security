// server-api/api/app-update.js — 원격 자동 업데이트 배포 관리 (관리자 패널 전용)
// PC 클라이언트는 이 API를 직접 호출하지 않고, /api/sync 응답의 `update` 필드로 전달받습니다.
//
// 무료 티어 권장: action=publish-url — GitHub Releases 등 외부 URL만 저장 (Supabase Storage 불필요)
// 선택: action=upload-url + publish — Supabase Storage에 직접 업로드 (프로젝트 용량 한도 필요)
const supabase = require('./lib/supabase');
const { bumpAdminNotify } = require('./lib/notify-admin');

const BUCKET = 'app-updates';
const DESIRED_BUCKET_LIMIT = 250 * 1024 * 1024;
const KEY = 'app_update';

function safeName(name) {
  return String(name || 'update.exe').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 150);
}

function isHttpUrl(url) {
  try {
    const u = new URL(String(url || ''));
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch (_) {
    return false;
  }
}

async function ensureBucket() {
  const { data: buckets, error } = await supabase.storage.listBuckets();
  if (error) throw error;
  const exists = (buckets || []).some(b => b.name === BUCKET);
  if (!exists) {
    const { error: createErr } = await supabase.storage.createBucket(BUCKET, { public: false });
    if (createErr && !/already exists/i.test(createErr.message)) throw createErr;
  }

  let limitWarning = null;
  const { error: updateErr } = await supabase.storage.updateBucket(BUCKET, { fileSizeLimit: DESIRED_BUCKET_LIMIT });
  if (updateErr) {
    limitWarning = 'Supabase Storage 업로드는 현재 프로젝트 용량 한도 때문에 사용할 수 없습니다. ' +
      '대신 "다운로드 URL로 배포"(GitHub Releases 등)를 사용하세요. ' +
      `(${updateErr.message})`;
  }
  return { limitWarning };
}

async function getAppUpdateSetting() {
  const { data, error } = await supabase.from('settings').select('value').eq('key', KEY).single();
  if (error || !data) return null;
  try { return JSON.parse(data.value); } catch (_) { return null; }
}

async function saveAppUpdateSetting(value) {
  const { error } = await supabase.from('settings').upsert(
    { key: KEY, value: JSON.stringify(value), updated_at: new Date().toISOString() },
    { onConflict: 'key' }
  );
  if (error) throw error;
}

function buildPublishValue(body) {
  const {
    version, filename, size, notes, sha256,
    target_mode = 'all', target_macs = [],
    download_url = null, storage_path = null
  } = body || {};

  return {
    version: String(version).trim(),
    storage_path: storage_path || null,
    download_url: download_url || null,
    filename: filename || (storage_path ? String(storage_path).split('/').pop() : 'OksooSecurity_Setup.exe'),
    size: Number(size) || 0,
    sha256: sha256 || null,
    notes: notes || '',
    target_mode: target_mode === 'selected' ? 'selected' : 'all',
    target_macs: Array.isArray(target_macs) ? target_macs : [],
    silent: true,
    published: true,
    published_at: new Date().toISOString()
  };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const apiKey = req.headers['x-api-key'];
  if (apiKey !== process.env.API_SECRET_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    if (req.method === 'GET') {
      // URL 배포만 쓰면 버킷 생성 불필요 — 실패해도 현재 배포 정보는 반환
      let limitWarning = null;
      try {
        ({ limitWarning } = await ensureBucket());
      } catch (err) {
        limitWarning = 'Supabase Storage 점검 실패. 다운로드 URL 배포는 그대로 사용 가능합니다. (' + err.message + ')';
      }
      const current = await getAppUpdateSetting();
      return res.status(200).json({ update: current, bucketLimitWarning: limitWarning });
    }

    if (req.method === 'DELETE') {
      await saveAppUpdateSetting(null);
      await bumpAdminNotify().catch(() => {});
      return res.status(200).json({ success: true });
    }

    if (req.method === 'POST') {
      const { action } = req.body || {};

      // ─── 무료 티어 핵심: 외부 URL만 저장 (GitHub Releases 등) ───
      if (action === 'publish-url') {
        const { version, download_url } = req.body || {};
        if (!version) return res.status(400).json({ error: 'version required' });
        if (!isHttpUrl(download_url)) {
          return res.status(400).json({ error: '유효한 http(s) 다운로드 URL이 필요합니다' });
        }
        const value = buildPublishValue({ ...req.body, download_url: String(download_url).trim(), storage_path: null });
        await saveAppUpdateSetting(value);
        await bumpAdminNotify().catch(() => {});
        return res.status(200).json({ success: true, update: value });
      }

      if (action === 'upload-url') {
        const { limitWarning } = await ensureBucket();
        const { filename } = req.body || {};
        const path = `installers/${Date.now()}-${safeName(filename)}`;
        const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path, { upsert: true });
        if (error) throw error;
        return res.status(200).json({ uploadUrl: data.signedUrl, path: data.path, bucketLimitWarning: limitWarning });
      }

      if (action === 'publish') {
        const { version, path } = req.body || {};
        if (!version || !path) return res.status(400).json({ error: 'version, path required' });
        const value = buildPublishValue({ ...req.body, storage_path: path, download_url: null });
        await saveAppUpdateSetting(value);
        await bumpAdminNotify().catch(() => {});
        return res.status(200).json({ success: true, update: value });
      }

      if (action === 'unpublish') {
        const current = await getAppUpdateSetting();
        if (current) {
          current.published = false;
          await saveAppUpdateSetting(current);
        }
        await bumpAdminNotify().catch(() => {});
        return res.status(200).json({ success: true });
      }

      return res.status(400).json({ error: 'invalid action' });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

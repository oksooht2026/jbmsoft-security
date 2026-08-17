// server-api/api/documents.js — 문서 열기 미리보기 (Storage 기반, 별도 DB 테이블 불필요)
const supabase = require('./lib/supabase');
const path = require('path');
const crypto = require('crypto');

const MAX_BYTES = 10 * 1024 * 1024;
const BUCKET = 'document-previews';
const SIGNED_TTL = 60 * 60;
const DAILY_UPLOAD_LIMIT = 10;           // 전체 PC 합산, 하루 파일 업로드 최대
const TOTAL_STORAGE_CAP = 500 * 1024 * 1024; // Supabase Storage 총 한도

function guessMime(filename) {
  const ext = (path.extname(filename || '') || '').toLowerCase();
  const map = {
    '.pdf': 'application/pdf',
    '.txt': 'text/plain',
    '.csv': 'text/csv',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.ppt': 'application/vnd.ms-powerpoint',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.hwp': 'application/x-hwp',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg'
  };
  return map[ext] || 'application/octet-stream';
}

function safeName(name) {
  return String(name || 'file').replace(/[^a-zA-Z0-9._\-가-힣]/g, '_').slice(0, 100);
}

function newId() {
  return `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

async function ensureBucket() {
  const { data: buckets, error } = await supabase.storage.listBuckets();
  if (error) throw error;
  if (buckets?.some(b => b.name === BUCKET)) {
    await supabase.storage.updateBucket(BUCKET, { fileSizeLimit: MAX_BYTES }).catch(() => {});
    return;
  }
  const { error: createErr } = await supabase.storage.createBucket(BUCKET, {
    public: false,
    fileSizeLimit: MAX_BYTES
  });
  if (createErr && !/already exists/i.test(createErr.message)) {
    throw createErr;
  }
}

async function signedUrl(storagePath) {
  if (!storagePath) return null;
  const { data } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, SIGNED_TTL);
  return data?.signedUrl || null;
}

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

function fileSizeOf(entry) {
  return entry?.metadata?.size ?? entry?.metadata?.contentLength ?? 0;
}

/** 버킷 내 실제 문서 파일 용량 + 오늘 업로드 건수 (meta.json 제외) */
async function getUploadQuota() {
  let totalFileBytes = 0;
  let todayFileUploads = 0;
  const today = todayUtc();
  let offset = 0;
  const pageSize = 1000;

  while (true) {
    const { data: files, error } = await supabase.storage.from(BUCKET).list('', {
      limit: pageSize,
      offset,
      sortBy: { column: 'created_at', order: 'desc' }
    });
    if (error) throw error;
    if (!files?.length) break;

    for (const f of files) {
      if (f.name.endsWith('.meta.json')) continue;
      const size = fileSizeOf(f);
      totalFileBytes += size;
      const created = (f.created_at || f.updated_at || '').slice(0, 10);
      if (created === today) todayFileUploads++;
    }

    if (files.length < pageSize) break;
    offset += pageSize;
  }

  return { totalFileBytes, todayFileUploads };
}

function canUploadFile(quota, incomingBytes) {
  if (quota.todayFileUploads >= DAILY_UPLOAD_LIMIT) {
    return { ok: false, reason: `daily_limit (${DAILY_UPLOAD_LIMIT}/day reached)` };
  }
  if (quota.totalFileBytes + incomingBytes > TOTAL_STORAGE_CAP) {
    return { ok: false, reason: `storage_cap (${Math.round(TOTAL_STORAGE_CAP / 1024 / 1024)}MB exceeded)` };
  }
  return { ok: true };
}

async function mapMeta(meta, filePath) {
  const preview_url = await signedUrl(filePath);
  return {
    id: meta.id,
    hostname: meta.hostname,
    document_name: meta.document_name,
    application: meta.application,
    process: meta.process_name,
    window_title: meta.window_title,
    file_path: meta.file_path,
    mime_type: meta.mime_type,
    file_size: meta.file_size,
    has_preview: !!filePath,
    upload_skip_reason: meta.upload_skip_reason || null,
    preview_url,
    created_at: meta.created_at
  };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    await ensureBucket();
  } catch (err) {
    return res.status(500).json({ error: 'Storage init failed: ' + err.message });
  }

  if (req.method === 'GET') {
    const limit = Math.min(parseInt(req.query.limit || '100', 10), 200);
    try {
      const { data: files, error } = await supabase.storage.from(BUCKET).list('', {
        limit: 1000,
        sortBy: { column: 'created_at', order: 'desc' }
      });
      if (error) throw error;

      const metaFiles = (files || [])
        .filter(f => f.name.endsWith('.meta.json'))
        .slice(0, limit);

      const items = await Promise.all(metaFiles.map(async (f) => {
        const { data: blob, error: dlErr } = await supabase.storage.from(BUCKET).download(f.name);
        if (dlErr || !blob) return null;
        const text = await blob.text();
        let meta;
        try { meta = JSON.parse(text); } catch (_) { return null; }
        const filePath = meta.storage_path || null;
        return mapMeta(meta, filePath);
      }));

      const sorted = items
        .filter(Boolean)
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .slice(0, limit);

      return res.status(200).json(sorted);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === 'POST') {
    const body = req.body || {};
    const {
      hostname, mac_address, document_name, application,
      process, window_title, file_path, file_base64, file_size, mime_type
    } = body;

    if (!document_name) {
      return res.status(400).json({ error: 'document_name required' });
    }

    try {
      const id = newId();
      const created_at = new Date().toISOString();
      let storage_path = null;
      let storedSize = file_size || 0;
      let storedMime = mime_type || guessMime(document_name);
      let upload_skip_reason = null;

      if (file_base64) {
        const buffer = Buffer.from(file_base64, 'base64');
        if (buffer.length > MAX_BYTES) {
          return res.status(413).json({ error: 'File too large (max 10MB)' });
        }
        storedSize = buffer.length;

        const quota = await getUploadQuota();
        const check = canUploadFile(quota, buffer.length);
        if (check.ok) {
          const ext = path.extname(document_name) || '.bin';
          storage_path = `${id}${ext}`;
          const { error: upErr } = await supabase.storage.from(BUCKET).upload(storage_path, buffer, {
            contentType: storedMime,
            upsert: false
          });
          if (upErr) {
            console.warn('[Documents] file upload failed:', upErr.message);
            storage_path = null;
          }
        } else {
          upload_skip_reason = check.reason;
          console.warn('[Documents] file upload skipped:', check.reason);
          storage_path = null;
        }
      }

      const meta = {
        id,
        hostname: hostname || null,
        mac_address: mac_address || null,
        document_name,
        application: application || null,
        process_name: process || null,
        window_title: window_title || null,
        file_path: file_path || null,
        storage_path,
        mime_type: storedMime,
        file_size: storage_path ? storedSize : null,
        upload_skip_reason,
        created_at
      };

      const metaPath = `${id}.meta.json`;
      const { error: metaErr } = await supabase.storage.from(BUCKET).upload(
        metaPath,
        Buffer.from(JSON.stringify(meta), 'utf8'),
        { contentType: 'application/json', upsert: false }
      );
      if (metaErr) throw metaErr;

      const mapped = await mapMeta(meta, storage_path);
      return res.status(201).json(mapped);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  res.status(405).json({ error: 'Method not allowed' });
};

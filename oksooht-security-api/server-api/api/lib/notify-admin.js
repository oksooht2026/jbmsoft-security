// server-api/api/lib/notify-admin.js — 관리자 패널 Realtime 새로고침 트리거
const supabase = require('./supabase');

async function bumpAdminNotify() {
  try {
    if (!process.env.SUPABASE_URL) return;
    await supabase.from('admin_notify').upsert(
      { id: 1, bumped_at: new Date().toISOString() },
      { onConflict: 'id' }
    );
  } catch (_) {
    // admin_notify 테이블 없어도 동작에는 영향 없음
  }
}

module.exports = { bumpAdminNotify };

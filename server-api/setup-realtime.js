// Supabase Realtime 푸시 1회 설정
// Supabase 대시보드 → Settings → API → anon public key 복사 후 실행:
//   node setup-realtime.js eyJhbGci...
require('dotenv').config();
const supabase = require('./api/lib/supabase');

const anonKey = process.argv[2] || process.env.SUPABASE_ANON_KEY;

async function main() {
  if (!anonKey || anonKey.length < 20) {
    console.error('사용법: node setup-realtime.js <SUPABASE_ANON_KEY>');
    console.error('또는 server-api/.env 에 SUPABASE_ANON_KEY=... 추가 후 실행');
    process.exit(1);
  }

  const { error } = await supabase.from('settings').upsert(
    { key: 'supabase_anon_key', value: anonKey },
    { onConflict: 'key' }
  );
  if (error) throw error;

  console.log('✅ supabase_anon_key 저장 완료');
  console.log('');
  console.log('Vercel에도 추가하세요:');
  console.log('  cd server-api');
  console.log('  npx vercel env add SUPABASE_ANON_KEY production');
  console.log('  (값 붙여넣기 후 API 재배포: ..\\admin-panel\\deploy-api.ps1)');
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});

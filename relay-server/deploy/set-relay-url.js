/**
 * Supabase settings.relay_url 자동 등록
 * 사용: node relay-server/deploy/set-relay-url.js "wss://relay.example.com"
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../server-api/.env') });
const supabase = require('../../server-api/api/lib/supabase');

const relayUrl = process.argv[2];

if (!relayUrl || !relayUrl.startsWith('ws')) {
  console.error('사용법: node relay-server/deploy/set-relay-url.js "wss://your-relay-url"');
  console.error('예: node relay-server/deploy/set-relay-url.js "wss://relay.yourdomain.com"');
  process.exit(1);
}

async function main() {
  const version = Date.now().toString();
  const { error: e1 } = await supabase.from('settings').upsert(
    { key: 'relay_url', value: JSON.stringify(relayUrl), updated_at: new Date().toISOString() },
    { onConflict: 'key' }
  );
  if (e1) throw e1;

  const { error: e2 } = await supabase.from('settings').upsert(
    { key: 'policy_version', value: version },
    { onConflict: 'key' }
  );
  if (e2) throw e2;

  console.log('✅ relay_url 저장:', relayUrl);
  console.log('✅ policy_version 갱신 — 5분 이내 42대 PC 자동 반영');
  console.log('');
  console.log('Vercel API에도 환경변수 추가 권장:');
  console.log('  RELAY_PUBLIC_URL =', relayUrl);
}

main().catch(err => {
  console.error('실패:', err.message);
  process.exit(1);
});

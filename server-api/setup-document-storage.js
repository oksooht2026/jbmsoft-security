#!/usr/bin/env node
// Supabase document-previews 버킷 초기화
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const supabase = require('./api/lib/supabase');

const BUCKET = 'document-previews';
const MAX_BYTES = 3 * 1024 * 1024;

async function main() {
  console.log('Supabase document-previews 설정 중...');

  const { data: buckets, error } = await supabase.storage.listBuckets();
  if (error) {
    console.error('버킷 목록 조회 실패:', error.message);
    process.exit(1);
  }

  const exists = buckets?.some(b => b.name === BUCKET);
  if (exists) {
    console.log(`✅ 버킷 "${BUCKET}" 이미 존재`);
  } else {
    const { error: createErr } = await supabase.storage.createBucket(BUCKET, {
      public: false,
      fileSizeLimit: MAX_BYTES
    });
    if (createErr) {
      console.error('버킷 생성 실패:', createErr.message);
      process.exit(1);
    }
    console.log(`✅ 버킷 "${BUCKET}" 생성 완료`);
  }

  // API 동작 확인
  const { data: list, error: listErr } = await supabase.storage.from(BUCKET).list('', { limit: 1 });
  if (listErr) {
    console.error('버킷 접근 테스트 실패:', listErr.message);
    process.exit(1);
  }
  console.log('✅ Storage 접근 정상 (파일 수:', (list || []).length, ')');
  console.log('완료 — document_opens 테이블 없이 Storage만 사용합니다.');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});

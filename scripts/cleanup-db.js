const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const supabaseUrl = 'https://jswvsywvzfeevaxmthkl.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impzd3ZzeXd2emZlZXZheG10aGtsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Nzg5ODc1MSwiZXhwIjoyMDkzNDc0NzUxfQ.u7IXruVGur5a-2bGy5gFH6yUCuih5tS1LlcSIu8r-Ng';
const supabase = createClient(supabaseUrl, supabaseKey);

async function runCleanup() {
  console.log('=== DB 더미 데이터 정리 시작 ===');
  
  // 1. 모든 mail_send_audit 로그 가져오기
  const { data: logs, error } = await supabase
    .from('logs')
    .select('id, message, details')
    .eq('event_type', 'mail_send_audit');

  if (error) {
    console.error('Logs fetch error:', error);
    return;
  }

  console.log(`전체 메일 발송 로그 수: ${logs.length}`);

  const toDeleteIds = [];

  for (const log of logs) {
    const details = log.details || {};
    const recipients = details.recipients || [];
    const message = log.message || '';

    // 더미 로그 기준:
    // - 수신자가 없거나 빈 배열인 경우
    // - 본문, 제목, 수신자가 모두 없는 경우
    // - 메일 주소가 올바르지 않은 경우 (예: 'in:sent')
    // - 메시지에 'in:sent'가 포함되어 있는 경우 (UIA 검색창 오인식)
    const hasNoRecipients = !Array.isArray(recipients) || recipients.length === 0;
    const isSearchQuery = message.includes('in:sent') || (recipients.length > 0 && recipients.some(r => r.includes('in:sent')));
    
    if (hasNoRecipients || isSearchQuery) {
      toDeleteIds.push(log.id);
    }
  }

  console.log(`삭제 예정 더미 로그 수: ${toDeleteIds.length}`);

  if (toDeleteIds.length > 0) {
    // 100개씩 청크로 나누어 삭제 진행
    const chunkSize = 100;
    for (let i = 0; i < toDeleteIds.length; i += chunkSize) {
      const chunk = toDeleteIds.slice(i, i + chunkSize);
      const { error: delError } = await supabase
        .from('logs')
        .delete()
        .in('id', chunk);
      
      if (delError) {
        console.error(`청크 삭제 중 에러 발생 (${i}~${i + chunk.length}):`, delError);
      } else {
        console.log(`청크 삭제 성공: ${i + chunk.length} / ${toDeleteIds.length}`);
      }
    }
  }

  console.log('=== 로컬 오프라인 큐 파일 정리 시작 ===');
  const appData = process.env.APPDATA;
  if (appData) {
    const dirs = [
      path.join(appData, 'oksoo-security'),
      path.join(appData, '옥수하이테크 보안솔루션'),
      path.join(appData, 'com.oksoohitech.security'),
      path.join(appData, 'Electron')
    ];

    let clearedCount = 0;
    dirs.forEach(dir => {
      const qPath = path.join(dir, 'mail-log-queue.json');
      if (fs.existsSync(qPath)) {
        try {
          fs.writeFileSync(qPath, JSON.stringify({ items: [] }), 'utf8');
          console.log(`로컬 큐 정리 성공: ${qPath}`);
          clearedCount++;
        } catch (e) {
          console.warn(`로컬 큐 정리 실패: ${qPath}`, e.message);
        }
      }
    });

    if (clearedCount === 0) {
      console.log('로컬 큐 파일을 찾지 못했거나 이미 정리되었습니다.');
    }
  }

  console.log('=== 정리 작업 완료 ===');
}

runCleanup();

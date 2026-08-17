const { createClient } = require('@supabase/supabase-js');
const supabaseUrl = 'https://jswvsywvzfeevaxmthkl.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impzd3ZzeXd2emZlZXZheG10aGtsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Nzg5ODc1MSwiZXhwIjoyMDkzNDc0NzUxfQ.u7IXruVGur5a-2bGy5gFH6yUCuih5tS1LlcSIu8r-Ng';
const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
  // Query PC information
  const { data: pcs, error: pcError } = await supabase
    .from('pcs')
    .select('*')
    .eq('hostname', 'DESKTOP-CFQOPOM');
  
  if (pcError) {
    console.error('Error fetching pcs:', pcError);
    return;
  }
  
  console.log('PC details in DB:');
  console.log(pcs);

  // Query recent logs
  const { data: logs, error: logError } = await supabase
    .from('logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(10);
    
  if (logError) {
    console.error('Error fetching logs:', logError);
    return;
  }
  
  console.log('\nRecent logs in DB:');
  logs.forEach(l => {
    console.log(`[${l.created_at}] PC:${l.pc_id} - ${l.event_type} - ${l.message}`);
  });
}
check();

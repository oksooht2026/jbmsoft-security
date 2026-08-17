const { createClient } = require('@supabase/supabase-js');
const supabaseUrl = 'https://jswvsywvzfeevaxmthkl.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impzd3ZzeXd2emZlZXZheG10aGtsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Nzg5ODc1MSwiZXhwIjoyMDkzNDc0NzUxfQ.u7IXruVGur5a-2bGy5gFH6yUCuih5tS1LlcSIu8r-Ng';
const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
  const { data, error } = await supabase
    .from('logs')
    .select('*')
    .eq('pc_id', '63903f5f-642b-4139-8f82-ce09e99323c4')
    .order('created_at', { ascending: false })
    .limit(30);
  
  if (error) {
    console.error(error);
  } else {
    console.log('Logs from DESKTOP-CFQOPOM:');
    data.forEach(l => {
      console.log(`[${l.created_at}] - ${l.event_type} - ${l.message}`);
    });
  }
}
check();

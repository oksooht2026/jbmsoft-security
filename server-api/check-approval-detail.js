const { createClient } = require('@supabase/supabase-js');
const supabaseUrl = 'https://jswvsywvzfeevaxmthkl.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impzd3ZzeXd2emZlZXZheG10aGtsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Nzg5ODc1MSwiZXhwIjoyMDkzNDc0NzUxfQ.u7IXruVGur5a-2bGy5gFH6yUCuih5tS1LlcSIu8r-Ng';
const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
  const { data, error } = await supabase
    .from('approvals')
    .select('*')
    .eq('id', '6c8efb06-5e43-4718-bfcf-ce1c7fea1daf')
    .single();
  
  if (error) {
    console.error(error);
  } else {
    console.log('Approval Details:', JSON.stringify(data, null, 2));
  }
}
check();

const { createClient } = require('@supabase/supabase-js');
const supabaseUrl = 'https://jswvsywvzfeevaxmthkl.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impzd3ZzeXd2emZlZXZheG10aGtsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Nzg5ODc1MSwiZXhwIjoyMDkzNDc0NzUxfQ.u7IXruVGur5a-2bGy5gFH6yUCuih5tS1LlcSIu8r-Ng';
const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
  const { data, error } = await supabase.from('settings').select('*');
  if (error) {
    console.error('Error fetching settings:', error);
  } else {
    console.log('Current settings in DB:');
    data.forEach(item => {
      console.log(`${item.key} = ${item.value} (${typeof item.value})`);
    });
  }
}
check();

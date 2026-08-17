const { createClient } = require('@supabase/supabase-js');
const supabaseUrl = 'https://jswvsywvzfeevaxmthkl.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impzd3ZzeXd2emZlZXZheG10aGtsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Nzg5ODc1MSwiZXhwIjoyMDkzNDc0NzUxfQ.u7IXruVGur5a-2bGy5gFH6yUCuih5tS1LlcSIu8r-Ng';
const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
  const { data: logs, error } = await supabase
    .from('logs')
    .select('id, event_type, message, details, created_at')
    .order('created_at', { ascending: false });
  if (error) {
    console.error(error);
  } else {
    console.log('Total retrieved:', logs.length);
    const sources = {};
    logs.forEach(l => {
      const src = l.details?.source || 'unknown';
      sources[src] = (sources[src] || 0) + 1;
    });
    console.log('Sources count:', sources);
    
    // Find logs from chrome_extension
    const extLogs = logs.filter(l => l.details?.source === 'chrome_extension');
    console.log('chrome_extension logs count:', extLogs.length);
    console.log('Sample chrome_extension logs:', extLogs.slice(0, 10).map(l => ({
      message: l.message,
      details: l.details,
      created_at: l.created_at
    })));
  }
}
check();

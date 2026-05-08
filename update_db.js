require('dotenv').config({ path: require('path').join(__dirname, 'server-api', '.env') });
const supabase = require('./server-api/api/lib/supabase');

async function updateDB() {
    console.log('Updating DB...');
    // Update blocked_extensions
    const defaultExts = ['exe', 'bat', 'cmd', 'ps1', 'sh', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'pdf', 'hwp', 'dwg', 'dxf', 'dwf'];
    await supabase.from('settings').update({ value: JSON.stringify(defaultExts) }).eq('key', 'blocked_extensions');
    console.log('Extensions updated');
    
    // Update admin_password
    await supabase.from('settings').update({ value: 'oksooht2026' }).eq('key', 'admin_password');
    console.log('Password updated');
}

updateDB().catch(console.error);

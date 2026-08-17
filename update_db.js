require('dotenv').config({ path: require('path').join(__dirname, 'server-api', '.env') });
const supabase = require('./server-api/api/lib/supabase');

async function updateDB() {
    console.log('Synchronizing DB Settings...');
    
    const settings = [
        { key: 'blocked_extensions', value: JSON.stringify(['exe', 'bat', 'cmd', 'ps1', 'sh', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'pdf', 'hwp', 'dwg', 'dxf', 'dwf']) },
        { key: 'admin_password', value: 'oksooht0731' },
        { key: 'usb_blocking_enabled', value: 'true' },
        { key: 'clipboard_monitoring_enabled', value: 'false' },
        { key: 'process_monitoring_enabled', value: 'true' },
        { key: 'mail_blocking_enabled', value: 'false' },
        { key: 'groupware_domains', value: JSON.stringify(['oksooht.daouoffice.com']) },
        { key: 'email_whitelist', value: JSON.stringify([]) },
        { key: 'email_blacklist', value: JSON.stringify([]) },
        { key: 'smtp_ports', value: JSON.stringify([25, 465, 587, 993, 995, 110, 143]) },
        { key: 'relay_url', value: JSON.stringify(process.env.RELAY_PUBLIC_URL || '') },
        { key: 'license_limit', value: '42' },
        { key: 'policy_version', value: String(Date.now()) },
        { key: 'admin_notify_version', value: '0' }
    ];

    for (const item of settings) {
        const { error } = await supabase.from('settings').upsert(item, { onConflict: 'key' });
        if (error) console.error(`Error syncing ${item.key}:`, error.message);
        else console.log(`✅ ${item.key} synced.`);
    }
}

updateDB().catch(console.error);

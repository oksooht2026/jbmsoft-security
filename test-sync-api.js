const https = require('https');

console.log('Testing Node.js HTTPS POST to /sync with API key...');

const postData = JSON.stringify({
  hostname: 'DESKTOP-CFQOPOM',
  mac_address: '24:4b:fe:8b:a3:aa',
  ip_address: '192.168.123.107',
  username: '개발자 PC',
  os_version: 'Windows 10',
  app_version: '1.0.0',
  policy_version: 1781900176405,
  needs_approvals: true
});

const options = {
  hostname: 'oksooht-security-api.vercel.app',
  port: 443,
  path: '/api/sync',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': postData.length,
    'x-api-key': 'oksooht-security-2026'
  }
};

const req = https.request(options, (res) => {
  console.log('Status Code:', res.statusCode);
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    console.log('Response length:', data.length);
    try {
      const parsed = JSON.parse(data);
      console.log('Parsed response keys:', Object.keys(parsed));
      if (parsed.policy) {
        console.log('Policy keys:', Object.keys(parsed.policy));
        console.log('clipboard_monitoring_enabled:', parsed.policy.clipboard_monitoring_enabled);
      } else {
        console.log('No policy returned. policy_changed:', parsed.policy_changed);
      }
    } catch (e) {
      console.log('Raw response:', data.substring(0, 500));
    }
  });
});

req.on('error', (e) => {
  console.error('HTTPS POST Connection Error:', e);
});

req.write(postData);
req.end();

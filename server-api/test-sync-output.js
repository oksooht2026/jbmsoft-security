const https = require('https');

const data = JSON.stringify({
  mac_address: '24:4b:fe:8b:a3:aa',
  hostname: 'DESKTOP-CFQOPOM',
  policy_version: 0
});

const req = https.request({
  hostname: 'oksooht-security-api.vercel.app',
  path: '/api/sync',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length,
    'x-api-key': 'oksooht-security-2026'
  }
}, res => {
  let body = '';
  res.on('data', chunk => body += chunk);
  res.on('end', () => {
    try {
      console.log('Sync Response:', JSON.parse(body));
    } catch (e) {
      console.log('Raw Response:', body);
    }
  });
});

req.write(data);
req.end();

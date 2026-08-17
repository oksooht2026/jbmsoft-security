const https = require('https');

console.log('Testing Node.js HTTPS connection to Vercel API...');

const req = https.get('https://oksooht-security-api.vercel.app/api/settings', (res) => {
  console.log('Status Code:', res.statusCode);
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    console.log('Response length:', data.length);
    try {
      console.log('Parsed response keys:', Object.keys(JSON.parse(data)));
    } catch (e) {
      console.log('Raw response:', data.substring(0, 200));
    }
  });
});

req.on('error', (e) => {
  console.error('HTTPS Connection Error:', e);
});

req.end();

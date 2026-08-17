const fs = require('fs');
const path = require('path');

const storePath = path.join(
  process.env.APPDATA,
  'OksooSecurity',
  'jbmsoft-security-config.json'
);

console.log('Target Store Path:', storePath);

if (fs.existsSync(storePath)) {
  try {
    const data = JSON.parse(fs.readFileSync(storePath, 'utf8'));
    console.log('\n--- Local Store Content ---');
    console.log(JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('Error parsing store file:', e.message);
  }
} else {
  console.log('Store file does not exist at this path.');
}

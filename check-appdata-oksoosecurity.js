const fs = require('fs');
const path = require('path');

const p = path.join(process.env.APPDATA, 'OksooSecurity');
console.log('Checking AppData path:', p);

if (fs.existsSync(p)) {
  console.log('Folder exists.');
  try {
    const files = fs.readdirSync(p);
    console.log('Files inside:', files);
  } catch (e) {
    console.error('Error reading folder:', e.message);
  }
} else {
  console.log('Folder does NOT exist.');
}

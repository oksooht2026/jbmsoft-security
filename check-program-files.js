const fs = require('fs');

const path = 'C:\\Program Files\\OksooSecurity';
console.log('Checking Program Files folder:', path);

if (fs.existsSync(path)) {
  console.log('Folder exists.');
  try {
    const files = fs.readdirSync(path);
    console.log('Files inside:', files);
  } catch (e) {
    console.error('Error reading folder:', e.message);
  }
} else {
  console.log('Folder does NOT exist.');
}

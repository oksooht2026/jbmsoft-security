const fs = require('fs');
const path = require('path');

function findConfig(dir) {
  try {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        findConfig(fullPath);
      } else if (file === 'jbmsoft-security-config.json') {
        console.log('Found config file:', fullPath);
        try {
          const content = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
          console.log('Content:', JSON.stringify(content, null, 2));
        } catch (e) {
          console.log('Error reading content:', e.message);
        }
      }
    }
  } catch (_) {}
}

const appData = process.env.APPDATA;
console.log('Searching in AppData:', appData);
findConfig(appData);

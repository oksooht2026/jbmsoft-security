const fs = require('fs');
const path = require('path');

function findLogs(dir) {
  try {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        findLogs(fullPath);
      } else if (file.endsWith('.log')) {
        console.log('Found log file:', fullPath);
        try {
          const content = fs.readFileSync(fullPath, 'utf8');
          console.log('--- Content (last 50 lines) ---');
          console.log(content.split('\n').slice(-50).join('\n'));
        } catch (e) {
          console.log('Error reading content:', e.message);
        }
      }
    }
  } catch (_) {}
}

const dir = path.join(process.env.APPDATA, 'oksoo-security');
console.log('Searching in:', dir);
findLogs(dir);

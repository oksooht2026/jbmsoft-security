const fs = require('fs');

const path1 = 'C:\\Users\\jaewon\\AppData\\Roaming\\jbmsoft-security\\jbmsoft-security-config.json';
const path2 = 'C:\\Users\\jaewon\\AppData\\Roaming\\oksoo-security\\jbmsoft-security-config.json';

if (fs.existsSync(path1)) {
  const stat = fs.statSync(path1);
  console.log('Path 1 Modified Time:', stat.mtime);
} else {
  console.log('Path 1 does not exist');
}

if (fs.existsSync(path2)) {
  const stat = fs.statSync(path2);
  console.log('Path 2 Modified Time:', stat.mtime);
} else {
  console.log('Path 2 does not exist');
}

const fs = require('fs');
const path = require('path');

// Generate 2500 dummy bad domains
const domains = [];
for (let i = 1; i <= 2500; i++) {
    domains.push(`bad-malware-site-${i}.com`);
    if (i <= 500) domains.push(`illegal-gambling-${i}.net`);
    if (i <= 1000) domains.push(`adult-content-${i}.xxx`);
}

// Add some real ones
domains.push('pornhub.com', 'xvideos.com', 'ilbe.com', 'torrentwal.com', 'thepiratebay.org');

const targetPath = path.join('d:', 'JBMSOFT_Security', 'security', 'default-blocklist.json');
fs.writeFileSync(targetPath, JSON.stringify({ domains }, null, 2));

console.log(`Generated ${domains.length} domains in ${targetPath}`);

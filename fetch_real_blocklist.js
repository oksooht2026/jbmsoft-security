const fs = require('fs');
const path = require('path');
const https = require('https');

// Using a subset of Blocklist Project (Gambling + Porn) for a focused "harmful" list
const SOURCES = [
    'https://raw.githubusercontent.com/blocklistproject/Lists/master/gambling.txt',
    'https://raw.githubusercontent.com/blocklistproject/Lists/master/porn.txt',
    'https://raw.githubusercontent.com/blocklistproject/Lists/master/malware.txt'
];

async function fetchList(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
        }).on('error', reject);
    });
}

async function run() {
    console.log('Fetching real blocklists...');
    const domains = new Set();

    for (const url of SOURCES) {
        try {
            const raw = await fetchList(url);
            const lines = raw.split('\n');
            lines.forEach(line => {
                const trimmed = line.trim();
                // Skip comments and empty lines
                if (!trimmed || trimmed.startsWith('#')) return;
                
                // Blocklist project usually has "0.0.0.0 domain.com" or just "domain.com"
                const parts = trimmed.split(/\s+/);
                const domain = parts[parts.length - 1].toLowerCase();
                
                if (domain && domain.includes('.') && domain.length > 3) {
                    domains.add(domain);
                }
            });
            console.log(`Fetched ${url}, current total unique domains: ${domains.size}`);
        } catch (e) {
            console.error(`Failed to fetch ${url}:`, e.message);
        }
    }

    const domainList = Array.from(domains);
    
    // Shuffle and pick 10,000 for efficiency if it's too large, or just keep all if reasonable.
    // Let's keep around 15,000 domains for a good balance.
    const finalDomains = domainList.slice(0, 15000);

    const targetPath = path.join(__dirname, 'security', 'default-blocklist.json');
    fs.writeFileSync(targetPath, JSON.stringify({ domains: finalDomains }, null, 2));

    console.log(`Updated ${targetPath} with ${finalDomains.length} real harmful domains.`);
}

run();

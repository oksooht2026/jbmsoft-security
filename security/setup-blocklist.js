#!/usr/bin/env node
// setup-blocklist.js - 앱 최초 설치 시 실제 유해 사이트 블랙리스트를 다운로드하여 적용합니다.
// electron-builder의 afterInstall 훅 또는 앱 최초 실행 시 호출합니다.
const fs = require('fs');
const path = require('path');
const https = require('https');

const SOURCES = [
    'https://raw.githubusercontent.com/blocklistproject/Lists/master/gambling.txt',
    'https://raw.githubusercontent.com/blocklistproject/Lists/master/porn.txt',
    'https://raw.githubusercontent.com/blocklistproject/Lists/master/malware.txt'
];

const TARGET = path.join(__dirname, 'default-blocklist.json');

async function fetchList(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
        }).on('error', reject);
    });
}

async function setupBlocklist() {
    if (fs.existsSync(TARGET)) {
        console.log('[Blocklist] 이미 블랙리스트가 존재합니다. 건너뜁니다.');
        return;
    }
    
    console.log('[Blocklist] 실제 유해 사이트 목록을 다운로드 중...');
    const domains = new Set();

    for (const url of SOURCES) {
        try {
            const raw = await fetchList(url);
            raw.split('\n').forEach(line => {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith('#')) return;
                const parts = trimmed.split(/\s+/);
                const domain = parts[parts.length - 1].toLowerCase();
                if (domain && domain.includes('.') && domain.length > 3) domains.add(domain);
            });
        } catch (e) {
            console.warn('[Blocklist] 다운로드 실패:', url, e.message);
        }
    }

    const finalDomains = Array.from(domains).slice(0, 15000);
    fs.writeFileSync(TARGET, JSON.stringify({ domains: finalDomains }, null, 2));
    console.log(`[Blocklist] ${finalDomains.length}개 유해 도메인 차단 목록 적용 완료.`);
}

module.exports = setupBlocklist;

if (require.main === module) {
    setupBlocklist().catch(console.error);
}

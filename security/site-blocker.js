// security/site-blocker.js
const fs = require('fs');

const HOSTS_PATH = 'C:\\Windows\\System32\\drivers\\etc\\hosts';
const MARKER_START = '# --- JBMSOFT_SECURITY_START ---';
const MARKER_END = '# --- JBMSOFT_SECURITY_END ---';

/**
 * 유해 사이트를 Windows hosts 파일을 수정하여 차단합니다.
 * (주의: Electron 앱이 관리자 권한으로 실행되어야 합니다)
 * @param {string[]} sitesToBlock - 차단할 도메인 배열 (예: ['pornhub.com', 'ilbe.com'])
 */
function updateBlockedSites(sitesToBlock) {
    if (!Array.isArray(sitesToBlock)) return false;
    
    try {
        let hostsContent = '';
        if (fs.existsSync(HOSTS_PATH)) {
            hostsContent = fs.readFileSync(HOSTS_PATH, 'utf8');
        }
        
        // 기존 보안 프로그램이 추가한 차단 내역 제거
        const regex = new RegExp(`\\n?${MARKER_START}[\\s\\S]*?${MARKER_END}\\n?`, 'g');
        hostsContent = hostsContent.replace(regex, '');

        // 새로운 차단 목록 추가
        if (sitesToBlock.length > 0) {
            let blockData = `\n${MARKER_START}\n`;
            blockData += `# 이 섹션은 JBMSOFT Security에 의해 관리됩니다.\n`;
            sitesToBlock.forEach(site => {
                const cleanSite = site.trim();
                if (cleanSite) {
                    blockData += `127.0.0.1 ${cleanSite}\n`;
                    blockData += `127.0.0.1 www.${cleanSite}\n`;
                }
            });
            blockData += `${MARKER_END}\n`;
            hostsContent += blockData;
        }

        // hosts 파일 쓰기
        fs.writeFileSync(HOSTS_PATH, hostsContent, 'utf8');
        console.log(`[SiteBlocker] Hosts 파일 업데이트 성공. 차단된 사이트 수: ${sitesToBlock.length}`);
        return true;
    } catch (error) {
        if (error.code === 'EPERM' || error.code === 'EACCES') {
            console.error('[SiteBlocker] Hosts 파일 쓰기 실패 (관리자 권한 필요):', error.message);
        } else {
            console.error('[SiteBlocker] 알 수 없는 오류:', error.message);
        }
        return false;
    }
}

module.exports = {
    updateBlockedSites
};

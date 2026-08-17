// security/site-blocker.js
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const HOSTS_PATH = 'C:\\Windows\\System32\\drivers\\etc\\hosts';
const MARKER_START = '# --- JBMSOFT_SECURITY_START ---';
const MARKER_END = '# --- JBMSOFT_SECURITY_END ---';

let baseSites = [];
const tempAllowed = new Map(); // domain -> expiresAt

function setBaseSites(sites) {
  baseSites = Array.isArray(sites) ? [...sites] : [];
  rebuildHosts();
}

function allowDomainsTemporarily(domains, ttlMs = 30 * 60 * 1000) {
  if (!Array.isArray(domains) || !domains.length) return false;
  const exp = Date.now() + ttlMs;
  domains.forEach(d => {
    const clean = d.trim().toLowerCase();
    if (clean) tempAllowed.set(clean, exp);
  });
  console.log(`[SiteBlocker] 임시 허용 (${ttlMs / 60000}분):`, domains.join(', '));
  return rebuildHosts();
}

function getEffectiveBlockList() {
  const now = Date.now();
  for (const [d, exp] of tempAllowed) {
    if (now > exp) tempAllowed.delete(d);
  }
  const allowed = new Set(tempAllowed.keys());
  return baseSites.filter(s => !allowed.has(s.trim().toLowerCase()));
}

function rebuildHosts() {
  let defaultSites = [];
  try {
    const blocklistPath = path.join(__dirname, 'default-blocklist.json');
    if (fs.existsSync(blocklistPath)) {
      const data = JSON.parse(fs.readFileSync(blocklistPath, 'utf8'));
      if (data && Array.isArray(data.domains)) defaultSites = data.domains;
    }
  } catch (_) {}

  const mergedSites = Array.from(new Set([...defaultSites, ...getEffectiveBlockList()]));
  return writeHosts(mergedSites);
}

function updateBlockedSites(sitesToBlock) {
  setBaseSites(sitesToBlock);
  return true;
}

/** 웹메일 등 특정 도메인을 차단 목록에서 제거 (메일 접속 복구) */
function unblockDomains(domains) {
  if (!Array.isArray(domains) || !domains.length) return rebuildHosts();
  const drop = new Set(domains.map(d => d.trim().toLowerCase()).filter(Boolean));
  baseSites = baseSites.filter(s => !drop.has(s.trim().toLowerCase()));
  for (const d of drop) tempAllowed.delete(d);
  return rebuildHosts();
}

function writeHosts(mergedSites) {
  try {
    let hostsContent = '';
    if (fs.existsSync(HOSTS_PATH)) {
      hostsContent = fs.readFileSync(HOSTS_PATH, 'utf8');
    }

    const regex = new RegExp(`\\n?${MARKER_START}[\\s\\S]*?${MARKER_END}\\n?`, 'g');
    hostsContent = hostsContent.replace(regex, '');

    if (mergedSites.length > 0) {
      let blockData = `\n${MARKER_START}\n`;
      blockData += `# JBMSOFT Security 관리 구역\n`;
      mergedSites.forEach(site => {
        const cleanSite = site.trim();
        if (cleanSite) blockData += `127.0.0.1 ${cleanSite}\n`;
      });
      blockData += `${MARKER_END}\n`;
      hostsContent += blockData;
    }

    fs.writeFileSync(HOSTS_PATH, hostsContent, 'utf8');
    exec('ipconfig /flushdns', { windowsHide: true }, () => {});
    console.log(`[SiteBlocker] Hosts 업데이트 — 차단 ${mergedSites.length}개, 임시허용 ${tempAllowed.size}개`);
    return true;
  } catch (error) {
    console.error('[SiteBlocker] Hosts 쓰기 실패:', error.message);
    return false;
  }
}

module.exports = {
  updateBlockedSites,
  unblockDomains,
  allowDomainsTemporarily,
  getEffectiveBlockList,
  /** 일시 중지·종료 시 hosts 차단 전부 제거 (웹메일 포함) */
  clearAllBlocks() {
    baseSites = [];
    tempAllowed.clear();
    try {
      let hostsContent = '';
      if (fs.existsSync(HOSTS_PATH)) {
        hostsContent = fs.readFileSync(HOSTS_PATH, 'utf8');
      }
      const regex = new RegExp(`\\n?${MARKER_START}[\\s\\S]*?${MARKER_END}\\n?`, 'g');
      hostsContent = hostsContent.replace(regex, '').trimEnd() + '\n';
      fs.writeFileSync(HOSTS_PATH, hostsContent, 'utf8');
      console.log('[SiteBlocker] hosts 차단 구역 전체 제거');
      return true;
    } catch (error) {
      console.error('[SiteBlocker] hosts 복구 실패:', error.message);
      return false;
    }
  }
};

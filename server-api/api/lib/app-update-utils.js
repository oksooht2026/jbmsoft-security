// server-api/api/lib/app-update-utils.js — 원격 업데이트 버전 비교 · 타겟팅 공통 유틸
function isNewerVersion(a, b) {
  const pa = String(a || '0').split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b || '0').split('.').map(n => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}

function isUpdateTargetedTo(appUpdate, macAddress) {
  if (!appUpdate || !appUpdate.published) return false;
  if (appUpdate.target_mode === 'selected') {
    return Array.isArray(appUpdate.target_macs) && appUpdate.target_macs.includes(macAddress);
  }
  return true; // 'all' (또는 미지정) — 전체 배포
}

module.exports = { isNewerVersion, isUpdateTargetedTo };

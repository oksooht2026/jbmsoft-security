// security/pc-registry.js - 허용 PC 관리 모듈
const os = require('os');

function getThisPCInfo() {
  const interfaces = os.networkInterfaces();
  const ifaces = Object.entries(interfaces)
    .flatMap(([name, list]) =>
      (list || [])
        .filter(i => i.family === 'IPv4' && !i.internal)
        .map(i => ({ name, address: i.address, mac: i.mac }))
    );

  return {
    hostname: os.hostname(),
    username: os.userInfo().username,
    platform: os.platform(),
    arch: os.arch(),
    networkInterfaces: ifaces,
    primaryIP: ifaces[0]?.address || '',
    primaryMAC: ifaces[0]?.mac || ''
  };
}

function isPCTrusted(trustedList, targetMAC) {
  return trustedList.some(pc =>
    pc.mac && pc.mac.toLowerCase() === targetMAC.toLowerCase()
  );
}

module.exports = { getThisPCInfo, isPCTrusted };

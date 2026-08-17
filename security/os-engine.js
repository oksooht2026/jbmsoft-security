// security/os-engine.js
const { exec } = require('child_process');
const { clipboard } = require('electron');
const serverSync = require('./server-sync');
const approvalManager = require('./approval-manager');
const chokidar = require('chokidar');
const os = require('os');
const fs = require('fs');
const Store = require('electron-store');
const store = new Store();

let knownRemovableDrives = new Set(); // 이동식 드라이브 판정 결과를 캐시하여 중복 프로세스 생성 방지

let processInterval = null;
let clipboardInterval = null;
let usbPollInterval = null;
let isEngineRunning = false;
let usbDriveWatchers = [];
let watchedLetters = new Set();
let blockedDrives = new Set();
let knownUsbLetters = new Set();
let lastKnownSerials = new Set(); // 물리적 USB 디스크 시리얼 번호 추적 (wmic 기반)
let blockedDriveSerials = new Map(); // 드라이브 문자 → 물리 디스크 시리얼 매핑 (차단 해제 추적용)
let knownUsbSerials = new Set();    // 이미 매핑된 시리얼 번호 (중복 방지)
let _onUsbFileEvent = null;
let _onUsbApprovalRequest = null;
let _isUsbGranted = () => false;
let _scanExistingComplete = false; // scanExistingUsbDrives 완료 전 poll 중복 처리 방지
const approvalRequestCooldown = new Map(); // 드라이브별 마지막 승인 요청 팝업 시간 (반복 팝업 방지)
const APPROVAL_REQUEST_COOLDOWN_MS = 5 * 60 * 1000; // 5분 이내 동일 드라이브 중복 팝업 방지

let currentPolicy = {
    blockedExtensions: ['exe', 'bat', 'cmd', 'ps1', 'sh', 'doc', 'docx', 'xls', 'xlsx', 'pdf', 'hwp', 'dwg'],
    usbBlockingEnabled: true,
    clipboardGuardEnabled: false
};

function execAsync(cmd) {
    return new Promise((resolve) => {
        exec(cmd, { windowsHide: true }, (err, stdout) => {
            resolve({ ok: !err, stdout: (stdout || '').trim(), err });
        });
    });
}

function updateEnginePolicy(policy) {
    if (!policy) return;
    if (policy.blocked_extensions) currentPolicy.blockedExtensions = policy.blocked_extensions;
    if (policy.usb_blocking_enabled !== undefined) currentPolicy.usbBlockingEnabled = policy.usb_blocking_enabled;
    if (policy.clipboard_monitoring_enabled !== undefined) currentPolicy.clipboardGuardEnabled = policy.clipboard_monitoring_enabled;
}

function shouldBlockUsb() {
    return currentPolicy.usbBlockingEnabled !== false;
}


function startClipboardGuard() {
    if (clipboardInterval) clearInterval(clipboardInterval);

    let lastText = clipboard.readText();

    clipboardInterval = setInterval(() => {
        if (!currentPolicy.clipboardGuardEnabled) return;

        const currentText = clipboard.readText();
        if (currentText !== lastText && currentText.trim().length > 0) {
            const juminRegex = /\d{6}[-\s]?\d{7}/;
            const cardRegex = /\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}/;

            if (juminRegex.test(currentText) || cardRegex.test(currentText)) {
                const type = juminRegex.test(currentText) ? '주민등록번호' : '카드번호';
                clipboard.clear();
                lastText = '';
                console.log(`[OSEngine] 중요 개인정보(${type} 패턴) 클립보드 차단됨`);
                serverSync.sendLog(
                    'clipboard_blocked',
                    'warning',
                    `중요 개인정보(${type} 패턴) 클립보드 복사 시도 차단됨`
                ).catch(() => {});
            } else {
                lastText = currentText;
            }
        }
    }, 1500);
}

// ─── 이동식 드라이브 목록 및 복구 — wmic 물리 디스크 시리얼 기반 ───

/**
 * 현재 물리적으로 연결된 모든 외장/이동식 디스크 목록 반환
 * - CSV 포맷으로 파싱 오류 없음 (모든 Windows 로케일 대응)
 * - InterfaceType 필터 없음: USB가 SCSI로 잡히는 드라이브도 감지
 *   (이동식 여부는 fsutil drivetype으로 별도 검증)
 */
function getPhysicalUsbDisks() {
    return new Promise((resolve) => {
        // WMIC 실행 시도
        exec('wmic diskdrive get DeviceID,SerialNumber /format:csv', { windowsHide: true }, (err, stdout) => {
            if (err || !stdout || !stdout.includes('DeviceID')) {
                // WMIC 실패 시 PowerShell Fallback (Get-CimInstance Win32_DiskDrive)
                exec('powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_DiskDrive | Select-Object DeviceID, SerialNumber | ConvertTo-Json"', { windowsHide: true }, (psErr, psStdout) => {
                    if (psErr || !psStdout) { resolve([]); return; }
                    try {
                        const parsed = JSON.parse(psStdout.trim());
                        const list = Array.isArray(parsed) ? parsed : [parsed];
                        const disks = list
                            .filter(d => d && d.DeviceID)
                            .map(d => ({
                                deviceId: d.DeviceID.trim(),
                                serial: (d.SerialNumber || '').trim()
                            }));
                        resolve(disks);
                    } catch (_) {
                        resolve([]);
                    }
                });
                return;
            }
            const lines = stdout.split('\n').filter(l => l.trim());
            const dataLines = lines.slice(1);
            const disks = [];
            for (const line of dataLines) {
                const cols = line.trim().split(',');
                if (cols.length < 3) continue;
                const deviceId = (cols[1] || '').trim();
                const serial = (cols[2] || '').trim();
                if (deviceId && serial) {
                    disks.push({ deviceId, serial });
                }
            }
            resolve(disks);
        });
    });
}

async function getDriveLetterSerial(driveLetter) {
    const letter = driveLetter.replace(':', '').toUpperCase();
    
    // 1단계: PowerShell을 사용한 현대적 매핑 시도 (관리자 권한 상태이므로 매우 정확하고 빠름)
    const psRes = await execAsync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "(Get-Partition -DriveLetter '${letter}' | Get-Disk).SerialNumber"`);
    if (psRes.ok && psRes.stdout.trim().length > 0) {
        return psRes.stdout.trim();
    }
    
    // 2단계: WMIC Fallback
    try {
        const r1 = await execAsync('wmic path Win32_LogicalDiskToPartition get Dependent,Antecedent');
        if (!r1.ok) return null;
        
        let diskIndex = null;
        let partitionIndex = null;
        for (const line of r1.stdout.split('\n')) {
            if (line.toUpperCase().includes(`DEVICEID="${letter}:"`)) {
                const match = line.match(/Disk #(\d+), Partition #(\d+)/i);
                if (match) {
                    diskIndex = match[1];
                    partitionIndex = match[2];
                    break;
                }
            }
        }
        if (diskIndex === null) return null;

        const r2 = await execAsync('wmic path Win32_DiskDriveToDiskPartition get Antecedent,Dependent');
        if (!r2.ok) return null;
        
        let physicalDriveNum = null;
        for (const line of r2.stdout.split('\n')) {
            if (line.includes(`Disk #${diskIndex}, Partition #${partitionIndex}`)) {
                const match = line.match(/PHYSICALDRIVE(\d+)/i);
                if (match) {
                    physicalDriveNum = match[1];
                    break;
                }
            }
        }
        if (physicalDriveNum === null) return null;

        const r3 = await execAsync('wmic diskdrive get DeviceID,SerialNumber /format:csv');
        if (!r3.ok) return null;
        
        const targetDevId = `\\\\.\\PHYSICALDRIVE${physicalDriveNum}`.toUpperCase();
        for (const line of r3.stdout.split('\n').filter(l => l.trim()).slice(1)) {
            const cols = line.trim().split(',');
            if (cols.length < 3) continue;
            const devId = (cols[1] || '').trim().toUpperCase();
            const serial = (cols[2] || '').trim();
            const cleanDevId = devId.replace(/\\\\/g, '\\');
            const cleanTarget = targetDevId.replace(/\\\\/g, '\\');
            if (cleanDevId === cleanTarget && serial) {
                return serial;
            }
        }
    } catch (_) {}
    return null;
}

/** wmic 및 PowerShell을 사용하여 이동식(Removable, DriveType=2) 드라이브 목록 반환 */
function getConnectedRemovableDrives() {
    return new Promise((resolve) => {
        exec('wmic logicaldisk get DeviceID,DriveType,FileSystem /format:csv', { windowsHide: true }, (err, stdout) => {
            if (err || !stdout || !stdout.includes('DeviceID')) {
                // Fallback to PowerShell
                exec('powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_LogicalDisk -Filter \'DriveType=2\' | Select-Object DeviceID, FileSystem | ConvertTo-Json"', { windowsHide: true }, (psErr, psStdout) => {
                    if (psErr || !psStdout) { resolve([]); return; }
                    try {
                        const parsed = JSON.parse(psStdout.trim());
                        const list = Array.isArray(parsed) ? parsed : [parsed];
                        const drives = list
                            .filter(d => d && d.DeviceID)
                            .map(d => {
                                const deviceId = d.DeviceID.trim().toUpperCase();
                                const letter = deviceId.charAt(0);
                                return { letter, deviceId, fs: d.FileSystem || 'UNKNOWN' };
                            });
                        resolve(drives);
                    } catch (_) {
                        resolve([]);
                    }
                });
                return;
            }
            const lines = stdout.split('\n').filter(l => l.trim());
            const drives = [];
            const dataLines = lines.slice(1);
            for (const line of dataLines) {
                const cols = line.trim().split(',');
                if (cols.length < 4) continue;
                const deviceId = (cols[1] || '').trim().toUpperCase();
                const driveType = (cols[2] || '').trim();
                const fileSystem = (cols[3] || '').trim();
                if (driveType === '2' && deviceId) {
                    const letter = deviceId.charAt(0);
                    drives.push({ letter, deviceId, fs: fileSystem || 'UNKNOWN' });
                }
            }
            resolve(drives);
        });
    });
}

/** mountvol 출력에서 모든 볼륨 GUID 파싱 (드라이브 문자 매핑 포함) */
function parseMountvol(stdout) {
    const result = { guidToLetter: {}, unmountedGuids: [] };
    const lines = stdout.split('\n');
    let currentGuid = null;
    for (let line of lines) {
        line = line.trim();
        if (line.toUpperCase().startsWith('\\\\?\\VOLUME{')) {
            currentGuid = line;
        } else if (currentGuid) {
            if (line.includes('***')) {
                result.unmountedGuids.push(currentGuid);
                currentGuid = null;
            } else if (/^[A-Z]:\\/i.test(line)) {
                result.guidToLetter[currentGuid] = line.charAt(0).toUpperCase();
                currentGuid = null;
            } else if (line) {
                currentGuid = null;
            }
        }
    }
    return result;
}

/** 지정한 드라이브 문자가 네트워크 공유 드라이브(NAS)인지 감지 */
function isNetworkShare(letter) {
    return new Promise((resolve) => {
        const cleanLetter = letter.replace(':', '').toUpperCase();
        
        // 1. WMI를 통해 네트워크 경로(ProviderName) 조회 (예: \\file_server\견적)
        exec(`powershell -NoProfile -ExecutionPolicy Bypass -Command "(Get-CimInstance Win32_LogicalDisk -Filter \\"DeviceID='${cleanLetter}:'\\").ProviderName"`, { windowsHide: true }, (psErr, psStdout) => {
            if (!psErr && psStdout && psStdout.trim().startsWith('\\\\')) {
                console.log(`[OSEngine] ${cleanLetter}: WMI ProviderName이 네트워크 경로이므로 차단 제외 (${psStdout.trim()})`);
                resolve(true);
                return;
            }
            
            // 2. net use 명령어를 통한 네트워크 드라이브 매핑 확인 (Fallback)
            exec('net use', { windowsHide: true }, (netErr, netStdout) => {
                if (!netErr && netStdout) {
                    const lines = netStdout.split('\n');
                    for (const line of lines) {
                        if (line.toUpperCase().includes(`${cleanLetter}:`)) {
                            console.log(`[OSEngine] ${cleanLetter}: net use에 등록된 네트워크 드라이브이므로 차단 제외`);
                            resolve(true);
                            return;
                        }
                    }
                }
                
                // 3. 특정 NAS 관련 키워드 확인 (견적, oks, file_server, 192.168.10.194 등 볼륨명 및 연결 정보 매칭)
                exec(`wmic logicaldisk where "DeviceID='${cleanLetter}:'" get VolumeName,ProviderName /format:csv`, { windowsHide: true }, (werr, wstdout) => {
                    if (!werr && wstdout) {
                        const wupper = wstdout.toUpperCase();
                        if (wupper.includes('FILE_SERVER') || wupper.includes('192.168.10.194') || wupper.includes('견적') || wupper.includes('OKS') || wupper.includes('\\\\')) {
                            console.log(`[OSEngine] ${cleanLetter}: 볼륨 정보에 NAS 키워드 또는 네트워크 주소가 감지되어 차단 제외`);
                            resolve(true);
                            return;
                        }
                    }
                    resolve(false);
                });
            });
        });
    });
}

/** 드라이브 문자(예: "E")를 받아 이동식 드라이브인지 초고속으로 검증 (일반 HDD/SSD 필터링 용도) */
function isRemovableDrive(letter) {
    return new Promise((resolve) => {
        const cleanLetter = letter.replace(':', '').toUpperCase();
        
        // 1단계: PowerShell Get-CimInstance DriveType=2 검증 (Windows 10/11 가장 정확)
        const psCmd = `powershell -NoProfile -ExecutionPolicy Bypass -Command "(Get-CimInstance Win32_LogicalDisk -Filter \\"DeviceID='${cleanLetter}:'\\").DriveType"`;
        exec(psCmd, { windowsHide: true }, (psErr, psStdout) => {
            if (!psErr && psStdout && psStdout.trim() === '2') {
                // 추가 검증: 만약 드라이브가 네트워크 공유(NAS) 상태라면 제외
                isNetworkShare(cleanLetter).then(isNet => {
                    resolve(!isNet);
                });
                return;
            }

            // 2단계: fsutil (Buffer 수집 후 UTF-8 및 한글 CP949 C7CCB5BFBD4D 바이너리 대응)
            exec(`fsutil fsinfo drivetype ${cleanLetter}:`, { windowsHide: true, encoding: 'buffer' }, (err, stdoutBuf) => {
                if (!err && stdoutBuf) {
                    const hexStr = stdoutBuf.toString('hex').toUpperCase();
                    const textAscii = stdoutBuf.toString('utf8').toUpperCase();
                    
                    // 'REMOVABLE', 'DRIVE_REMOVABLE' 또는 한글 '이동식' CP949 바이너리 (C7CC B5BF BD4D)
                    if (textAscii.includes('REMOVABLE') || textAscii.includes('DRIVE_REMOVABLE') || hexStr.includes('C7CCB5BFBD4D')) {
                        // 추가 검증: 만약 드라이브가 네트워크 공유(NAS) 상태라면 제외
                        isNetworkShare(cleanLetter).then(isNet => {
                            resolve(!isNet);
                        });
                        return;
                    }
                }
                
                // 3단계: WMIC Fallback (구형 Windows 대응)
                exec(`wmic logicaldisk where "DeviceID='${cleanLetter}:'" get DriveType /format:csv`, { windowsHide: true }, (werr, wstdout) => {
                    if (!werr && wstdout) {
                        // CSV 파싱으로 DriveType 컬럼 값이 정확히 '2'인지 검사
                        // (느슨한 includes('2')는 PC이름·경로 등에 '2'가 있으면 오탐 발생)
                        const lines = wstdout.split('\n').map(l => l.trim()).filter(l => l);
                        const headerIdx = lines.findIndex(l => l.toUpperCase().includes('DRIVETYPE'));
                        if (headerIdx >= 0) {
                            const headers = lines[headerIdx].split(',').map(h => h.trim().toUpperCase());
                            const driveTypeCol = headers.indexOf('DRIVETYPE');
                            const dataLine = lines[headerIdx + 1];
                            if (dataLine && driveTypeCol >= 0) {
                                const cols = dataLine.split(',');
                                const driveTypeVal = (cols[driveTypeCol] || '').trim();
                                if (driveTypeVal === '2') {
                                    isNetworkShare(cleanLetter).then(isNet => {
                                        resolve(!isNet);
                                    });
                                    return;
                                }
                            }
                        }
                    }
                    resolve(false);
                });
            });
        });
    });
}

/** 마운트 포인트 없는 볼륨에 드라이브 문자를 임시 할당하여 이동식 드라이브로 복구 */
async function recoverOrphanedRemovableVolumes() {
    // 숨겨진 시스템 예약 파티션 이나 복구 파티션이 탐색기에 불필요하게 마운트(F:, Z: 등)되는 현상을 방지하기 위해 
    // 마운트 해제된 볼륨 강제 마운트 로직을 비활성화합니다.
    // Windows PnP가 USB 연결 시 드라이브 문자를 자동으로 할당하므로, 이 복구 로직이 없어도 실시간 차단/감지에 아무런 문제가 없습니다.
    return 'NO_RECOVERED';
}

const blockedVolumeGuids = {
    get(key) {
        const guids = store.get('blockedVolumeGuids', {});
        return guids[key];
    },
    set(key, value) {
        const guids = store.get('blockedVolumeGuids', {});
        guids[key] = value;
        store.set('blockedVolumeGuids', guids);
        return this;
    },
    delete(key) {
        const guids = store.get('blockedVolumeGuids', {});
        const hasKey = key in guids;
        delete guids[key];
        store.set('blockedVolumeGuids', guids);
        return hasKey;
    },
    clear() {
        store.set('blockedVolumeGuids', {});
    }
};

function getVolumeGuidForLetter(driveLetter) {
    return new Promise((resolve) => {
        const letter = driveLetter.replace(':', '').toUpperCase();
        exec('mountvol', { windowsHide: true }, (err, stdout) => {
            if (err) {
                resolve(null);
                return;
            }
            const lines = stdout.split('\n');
            let currentGuid = null;
            for (let line of lines) {
                line = line.trim();
                if (line.toUpperCase().startsWith('\\\\?\\VOLUME{')) {
                    currentGuid = line;
                } else if (line.toUpperCase() === `${letter}:\\` && currentGuid) {
                    resolve(currentGuid);
                    return;
                }
            }
            resolve(null);
        });
    });
}

function getAllConnectedVolumeGuids() {
    return new Promise((resolve) => {
        exec('mountvol', { windowsHide: true }, (err, stdout) => {
            if (err) {
                resolve([]);
                return;
            }
            const guids = [];
            const lines = stdout.split('\n');
            for (let line of lines) {
                line = line.trim();
                if (line.toUpperCase().startsWith('\\\\?\\VOLUME{')) {
                    guids.push(line);
                }
            }
            resolve(guids);
        });
    });
}

// ─── USB 드라이브 접근 차단 (mountvol을 사용해 드라이브 문자를 마운트 해제하고, 승인 시 GUID로 복원) ───
async function blockDriveFullAccess(driveLetter, fsType) {
    const letter = driveLetter.replace(':', '').toUpperCase();
    if (blockedDrives.has(letter)) return true;

    // Get the volume GUID for the drive letter before unmounting it
    let guid = blockedVolumeGuids.get(letter);
    if (!guid) {
        guid = await getVolumeGuidForLetter(letter);
        if (guid) {
            blockedVolumeGuids.set(letter, guid);
        }
    }

    if (!guid) {
        console.warn(`[OSEngine] ${letter}: Volume GUID를 가져오지 못해 mountvol 차단을 수행할 수 없습니다. icacls 폴백을 시도합니다.`);
        const username = os.userInfo().username;
        const r1 = await execAsync(`icacls "${letter}:\\" /deny "${username}":(F) /C /Q`);
        if (r1.ok) {
            blockedDrives.add(letter);
            return true;
        }
        return false;
    }

    console.log(`[OSEngine] ${letter}: mountvol /D 차단 실행 (GUID: ${guid})`);
    const r = await execAsync(`mountvol ${letter}:\\ /D`);
    if (r.ok) {
        blockedDrives.add(letter);
        // 앱 강제 종료 시에도 복구 가능하도록 레지스트리에 GUID 백업
        exec(`reg add "HKCU\\Software\\JBMSOFT_Security\\BlockedDrives" /v "${letter}" /t REG_SZ /d "${guid}" /f`, { windowsHide: true }, () => {});
        return true;
    }

    console.warn(`[OSEngine] ${letter}: mountvol 차단 실패. icacls 폴백을 시도합니다.`);
    const username = os.userInfo().username;
    const r1 = await execAsync(`icacls "${letter}:\\" /deny "${username}":(F) /C /Q`);
    if (r1.ok) {
        blockedDrives.add(letter);
        return true;
    }
    return false;
}

function blockDriveReadAccess(driveLetter) {
    return blockDriveFullAccess(driveLetter, 'UNKNOWN');
}

async function unblockDriveReadAccess(driveLetter) {
    const letter = driveLetter.replace(':', '').toUpperCase();
    const guid = blockedVolumeGuids.get(letter);

    if (!guid) {
        // GUID가 저장되어 있지 않은 경우, icacls 권한 해제 시도
        const username = os.userInfo().username;
        const r = await execAsync(`icacls "${letter}:\\" /remove:d "${username}" /C /Q`);
        if (r.ok) blockedDrives.delete(letter);
        console.log(`[OSEngine] ${letter}: icacls 차단 해제 시도 (결과: ${r.ok})`);
        return r.ok;
    }

    // mountvol을 사용해 드라이브 문자 복원 (GUID의 마지막 역슬래시가 따옴표를 이스케이프하는 버그 방지를 위해 따옴표 제거)
    const r = await execAsync(`mountvol ${letter}:\\ ${guid}`);
    if (r.ok) {
        blockedDrives.delete(letter);
        blockedVolumeGuids.delete(letter);
        // 복구 성공 시 레지스트리 백업 삭제
        exec(`reg delete "HKCU\\Software\\JBMSOFT_Security\\BlockedDrives" /v "${letter}" /f`, { windowsHide: true }, () => {});
        console.log(`[OSEngine] ${letter}: mountvol 드라이브 문자 복구 완료 (GUID: ${guid})`);
        return true;
    }

    console.warn(`[OSEngine] ${letter}: mountvol 복구 실패. icacls 해제 폴백 시도`);
    const username = os.userInfo().username;
    const r2 = await execAsync(`icacls "${letter}:\\" /remove:d "${username}" /C /Q`);
    if (r2.ok) blockedDrives.delete(letter);
    return r2.ok;
}

function addUsbWatcher(letter) {
    if (watchedLetters.has(letter)) return;
    const drivePath = `${letter}:\\`;
    try {
        const watcher = chokidar.watch(drivePath, {
            persistent: true,
            ignoreInitial: true,
            depth: 3,
            awaitWriteFinish: { stabilityThreshold: 600, pollInterval: 200 }
        });
        watcher
            .on('unlink', filePath => {
                console.log(`[OSEngine] USB 파일 삭제/이동 감지: ${filePath}`);
                if (_onUsbFileEvent) _onUsbFileEvent('unlink', filePath);
            })
            .on('add', filePath => {
                console.log(`[OSEngine] USB 새 파일 추가 감지: ${filePath}`);
                if (_onUsbFileEvent) _onUsbFileEvent('add', filePath);
            })
            .on('error', err => console.error(`[OSEngine] USB 감시 에러 (${drivePath}):`, err));
        usbDriveWatchers.push(watcher);
        watchedLetters.add(letter);
        console.log(`[OSEngine] USB 드라이브 감시 시작: ${drivePath}`);
    } catch (e) {
        console.error(`[OSEngine] USB 감시 실패 (${drivePath}):`, e);
    }
}

function startUsbDriveWatcher(driveLetters, onEvent) {
    stopUsbDriveWatchers();
    if (!driveLetters || driveLetters.length === 0) return;
    if (onEvent) _onUsbFileEvent = onEvent;
    driveLetters.forEach(letter => addUsbWatcher(letter.replace(':', '').toUpperCase()));
}

function stopUsbDriveWatchers() {
    usbDriveWatchers.forEach(w => { try { w.close(); } catch (_) {} });
    usbDriveWatchers = [];
    watchedLetters.clear();
}

async function handleUsbDrive(driveLetter, fsType, { isNewInsert = false, requestApproval = false } = {}) {
    const letter = driveLetter.replace(':', '').toUpperCase();
    const fs = fsType || 'UNKNOWN';

    if (isNewInsert) {
        const severity = shouldBlockUsb() && !_isUsbGranted(letter) ? 'critical' : 'warning';
        const msg = shouldBlockUsb() && !_isUsbGranted(letter)
            ? `USB 저장장치 연결 — 접근 차단됨 (${letter}:, ${fs}) · 관리자 승인 필요`
            : `USB 저장장치 연결 (${letter}:, ${fs})`;
        console.log(`[OSEngine] ${msg}`);
        serverSync.sendLog('usb_detected', severity, msg).catch(() => {});
    }

    addUsbWatcher(letter);

    if (!shouldBlockUsb()) return;

    if (_isUsbGranted(letter)) {
        if (blockedDrives.has(letter)) {
            await unblockDriveReadAccess(letter);
        }
        return;
    }

    if (!blockedDrives.has(letter)) {
        await blockDriveFullAccess(letter, fs);
    }

    if ((isNewInsert || requestApproval) && _onUsbApprovalRequest) {
        _onUsbApprovalRequest(letter, fs);
    }
}

async function pollUsbDrives() {
    if (!isEngineRunning) return;

    // ── 1. activeLetters 및 모든 연결된 Volume GUID 수집 ──────────────
    // A부터 Z까지 모든 드라이브 문자를 비동기로 동시 체크 (C드라이브 시스템용은 제외)
    const activeLetters = [];
    const checkPromises = [];
    for (let i = 65; i <= 90; i++) {
        if (i === 67) continue; // C: 드라이브 제외
        const letter = String.fromCharCode(i);
        checkPromises.push(new Promise((resolve) => {
            let resolved = false;
            // 1초 타임아웃을 지정하여 응답하지 않는 네트워크 드라이브 대기 방지
            const timer = setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    resolve();
                }
            }, 1000);
            
            // fs.access는 비동기로 동작하여 메인 이벤트 루프를 막지 않습니다.
            fs.access(letter + ':\\', (err) => {
                clearTimeout(timer);
                if (!resolved) {
                    resolved = true;
                    if (!err) {
                        activeLetters.push(letter);
                    }
                    resolve();
                }
            });
        }));
    }
    await Promise.all(checkPromises);

    // mountvol은 프로세스 생성 비용이 거의 없는 초경량 C 바이너리임
    const currentGuids = await getAllConnectedVolumeGuids();

    // ── 2. 물리적 분리(언플러그) 감지 및 스토어 정리 ──────────────
    // blockedDrives 중 더 이상 mountvol 목록에 볼륨 GUID가 존재하지 않는 경우
    for (const letter of [...blockedDrives]) {
        const guid = blockedVolumeGuids.get(letter);
        if (guid) {
            const isStillConnected = currentGuids.some(g => g.toUpperCase() === guid.toUpperCase());
            if (!isStillConnected) {
                console.log(`[OSEngine] 차단된 USB 물리 해제 감지: ${letter}:`);
                blockedDrives.delete(letter);
                blockedVolumeGuids.delete(letter);
                knownUsbLetters.delete(letter);
                knownRemovableDrives.delete(letter);
                
                const serialForLetter = blockedDriveSerials.get(letter);
                if (serialForLetter) {
                    knownUsbSerials.delete(serialForLetter);
                    blockedDriveSerials.delete(letter);
                }
                // USB 분리 시 pending 승인 요청도 정리 → 재삽입 시 새 승인 요청 정상 생성
                approvalManager.clearPendingForDrive(letter);
                if (_onUsbFileEvent) _onUsbFileEvent('unlink', `${letter}:\\`);
            }
        }
    }

    // 일반 활성 상태였던 USB가 물리적으로 그냥 뽑힌 경우 감지 및 정리
    for (const letter of [...knownRemovableDrives]) {
        if (!activeLetters.includes(letter) && !blockedDrives.has(letter)) {
            console.log(`[OSEngine] USB 물리 해제 감지 (활성 상태): ${letter}:`);
            knownRemovableDrives.delete(letter);
            knownUsbLetters.delete(letter);
            
            const serialForLetter = blockedDriveSerials.get(letter);
            if (serialForLetter) {
                knownUsbSerials.delete(serialForLetter);
                blockedDriveSerials.delete(letter);
            }
            // USB 분리 시 pending 승인 요청도 정리 → 재삽입 시 새 승인 요청 정상 생성
            approvalManager.clearPendingForDrive(letter);
            if (_onUsbFileEvent) _onUsbFileEvent('unlink', `${letter}:\\`);
        }
    }

    // ── 3. 새로운 드라이브 삽입 처리 ──────────────
    for (const letter of activeLetters) {
        if (!knownUsbLetters.has(letter) && !knownRemovableDrives.has(letter)) {
            // 새로 연결된 드라이브 문자 발견 -> 이동식(USB) 디스크인지 1회 검증
            const isRemovable = await isRemovableDrive(letter);
            if (isRemovable) {
                knownRemovableDrives.add(letter);
                console.log(`[OSEngine] 새 이동식 드라이브 감지: ${letter}:`);
                await handleUsbDrive(letter, 'UNKNOWN', { isNewInsert: true });

                // 물리 시리얼 번호 매핑 (WMI 또는 PowerShell 사용) -> 삽입 시 1회만 호출됨
                if (!blockedDriveSerials.has(letter)) {
                    const serial = await getDriveLetterSerial(letter);
                    if (serial) {
                        blockedDriveSerials.set(letter, serial);
                        knownUsbSerials.add(serial);
                        console.log(`[OSEngine] 드라이브 ${letter}: ↔ Serial ${serial} 매핑 완료`);
                    }
                }
            } else {
                // 일반 HDD/SSD/네트워크 드라이브 등으로 판명된 경우 루프 제외용 보관
                knownUsbLetters.add(letter);
            }
        }
    }

    // ── 4. 정책 적용 및 복원 ──────────────
    // scanExistingUsbDrives가 완료되기 전에는 poll의 재차단/재승인 로직 생략
    // (앱 시작 직후 레이스 컨디션으로 인한 중복 승인 요청 방지)
    if (!_scanExistingComplete) return;

    const removableActiveLetters = activeLetters.filter(l => knownRemovableDrives.has(l));

    if (shouldBlockUsb()) {
        for (const letter of removableActiveLetters) {
            if (!_isUsbGranted(letter) && !blockedDrives.has(letter)) {
                const blockedBefore = blockedDrives.size;
                await blockDriveFullAccess(letter, 'UNKNOWN');
                const blockSucceeded = blockedDrives.has(letter); // 실제로 차단 성공했는지 확인

                if (_onUsbApprovalRequest) {
                    // 차단 성공 시: 반드시 한 번 팝업
                    // 차단 실패 시(내부 HDD 오탐 등): 쿨다운(5분)이 지난 경우에만 팝업 — 반복 팝업 방지
                    const lastAt = approvalRequestCooldown.get(letter) || 0;
                    const cooldownExpired = Date.now() - lastAt > APPROVAL_REQUEST_COOLDOWN_MS;
                    if (blockSucceeded || cooldownExpired) {
                        approvalRequestCooldown.set(letter, Date.now());
                        _onUsbApprovalRequest(letter, 'UNKNOWN');
                    } else {
                        console.log(`[OSEngine] ${letter}: 승인 팝업 쿨다운 중 (내부 HDD 오탐 방지) — 남은 시간: ${Math.round((APPROVAL_REQUEST_COOLDOWN_MS - (Date.now() - lastAt)) / 1000)}s`);
                    }
                }
            }
        }
    }

    // blockedDrives에 존재하는데 승인(grant)이 활성화되어 있다면 복원 시도
    for (const letter of [...blockedDrives]) {
        if (_isUsbGranted(letter)) {
            console.log(`[OSEngine] ${letter}: grant 활성 + blockedDrives 잔존 → mountvol 복원 재시도`);
            await unblockDriveReadAccess(letter).catch(() => {});
        }
    }

    // 전체 드라이브 문자 맵 동기화
    knownUsbLetters = new Set([...activeLetters, ...blockedDrives]);
}

function startUsbDetector() {
    if (usbPollInterval) clearInterval(usbPollInterval);
    pollUsbDrives();
    usbPollInterval = setInterval(() => pollUsbDrives(), 3500);
    console.log('[OSEngine] USB 폴링 감시 시작 (3.5초 간격)');
}

async function scanExistingUsbDrives(onEvent) {
    _onUsbFileEvent = onEvent;
    const drives = await getConnectedRemovableDrives();
    _scanExistingComplete = false; // 스캔 시작 시 플래그 리셋
    if (!drives.length) {
        knownUsbLetters = new Set();
        _scanExistingComplete = true;
        console.log('[OSEngine] 기존 연결된 이동식 드라이브 없음');
        return;
    }

    knownUsbLetters = new Set(drives.map(d => d.letter));
    for (const drive of drives) {
        await handleUsbDrive(drive.letter, drive.fs, {
            requestApproval: shouldBlockUsb() && !_isUsbGranted(drive.letter)
        });
    }

    startUsbDriveWatcher(drives.map(d => d.letter), onEvent);
    serverSync.sendLog('usb_existing_detected', 'info',
        `앱 시작 시 이동식 드라이브: ${drives.map(d => d.letter + ':').join(', ')}`,
        { drives: drives.map(d => d.letter) }
    ).catch(() => {});
    _scanExistingComplete = true; // 스캔 완료 후 플래그 설정
}

function setUsbApprovalRequestCallback(cb) { _onUsbApprovalRequest = cb; }
function setUsbGrantChecker(fn) { _isUsbGranted = fn; }

function allowUsbDrive(driveLetter) {
    const letter = driveLetter.replace(':', '').toUpperCase();
    return unblockDriveReadAccess(letter);
}

async function startEngine(onUsbFileEvent) {
    if (isEngineRunning) return;
    isEngineRunning = true;
    if (onUsbFileEvent) _onUsbFileEvent = onUsbFileEvent;
    console.log('[OSEngine] 보안 감시 엔진 시작');

    // 시작 시 물리적 디스크 시리얼 목록 초기화 (재연결 감지 기준점)
    try {
        const disks = await getPhysicalUsbDisks();
        lastKnownSerials = new Set(disks.map(d => d.serial));
        console.log(`[OSEngine] 초기 물리 디스크 시리얼: ${[...lastKnownSerials].join(', ') || '없음'}`);
    } catch (e) {
        lastKnownSerials = new Set();
    }

    // 마운트 포인트 없는 볼륨 복구 (이전 차단 후 재연결된 경우 등)
    await recoverOrphanedRemovableVolumes().catch(() => {});

    // ※ knownUsbLetters는 여기서 채우지 않음:
    //   main.js에서 scanExistingUsbDrives()가 호출될 때 기존 연결 드라이브를
    //   requestApproval: true로 처리하여 알림+차단이 정상 실행되도록 함.
    //   미리 채우면 pollUsbDrives()에서 isNew=false가 되어 알림이 누락됨.
    knownUsbLetters = new Set();

    startClipboardGuard();
    startUsbDetector();
}


async function stopEngine() {
    isEngineRunning = false;
    if (processInterval) { clearInterval(processInterval); processInterval = null; }
    if (clipboardInterval) { clearInterval(clipboardInterval); clipboardInterval = null; }
    if (usbPollInterval) { clearInterval(usbPollInterval); usbPollInterval = null; }
    stopUsbDriveWatchers();
    knownUsbLetters.clear();
    lastKnownSerials.clear();
    blockedDriveSerials.clear();
    knownUsbSerials.clear();

    const letters = [...blockedDrives];
    await Promise.all(letters.map(l => unblockDriveReadAccess(l).catch(() => {})));
    blockedVolumeGuids.clear();
    await recoverOrphanedRemovableVolumes().catch(() => {});
    console.log('[OSEngine] 보안 감시 엔진 정지 (USB 차단 해제 완료)');
}

function getStatus() {
    return {
        isRunning: isEngineRunning,
        policy: currentPolicy,
        blockedDrives: [...blockedDrives]
    };
}

function getBlockedExtensions() {
    return currentPolicy.blockedExtensions;
}

module.exports = {
    startEngine,
    stopEngine,
    updateEnginePolicy,
    getStatus,
    getBlockedExtensions,
    getConnectedRemovableDrives,
    scanExistingUsbDrives,
    blockDriveReadAccess,
    blockDriveFullAccess,
    unblockDriveReadAccess,
    allowUsbDrive,
    recoverOrphanedRemovableVolumes,
    setUsbApprovalRequestCallback,
    setUsbGrantChecker
};

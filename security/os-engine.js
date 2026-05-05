// security/os-engine.js
const { exec, spawn } = require('child_process');
const { clipboard } = require('electron');
const serverSync = require('./server-sync');

let processInterval = null;
let clipboardInterval = null;
let usbProcess = null;
let isEngineRunning = false;

// 차단 정책 로컬 캐시
let currentPolicy = {
    blockedExtensions: ['exe', 'bat', 'cmd', 'ps1'],
    usbBlockingEnabled: true,
    clipboardGuardEnabled: true
};

function updateEnginePolicy(policy) {
    if (!policy) return;
    
    // settings API에서 내려오는 형식: { blocked_extensions: [...], usb_blocking_enabled: true }
    if (policy.blocked_extensions) currentPolicy.blockedExtensions = policy.blocked_extensions;
    if (policy.usb_blocking_enabled !== undefined) currentPolicy.usbBlockingEnabled = policy.usb_blocking_enabled;
    if (policy.clipboard_guard_enabled !== undefined) currentPolicy.clipboardGuardEnabled = policy.clipboard_guard_enabled;
}

function startProcessMonitor() {
    if (processInterval) clearInterval(processInterval);
    
    processInterval = setInterval(() => {
        // Windows tasklist 명령어로 현재 실행 중인 프로세스 확인
        // 주의: 모든 프로세스를 매초 확인하는 것은 부하가 큼. 
        // 보안 프로그램에서는 보통 드라이버를 쓰지만 여기서는 간단히 이름 기반으로 5초마다 체크.
        exec('tasklist /fo csv /nh', (err, stdout) => {
            if (err) return;
            
            const processes = stdout.split('\n');
            const exts = currentPolicy.blockedExtensions.map(ext => `.${ext.toLowerCase()}`);
            
            processes.forEach(procLine => {
                const match = procLine.match(/^"([^"]+)"/);
                if (match) {
                    const procName = match[1].toLowerCase();
                    // 금지된 확장자로 끝나는 프로세스인지 확인 (보통 실행 파일은 .exe지만 특정 악성코드 이름 차단용으로 확장 가능)
                    // 예: "torrent.exe" 가 리스트에 있다면 차단
                    // 여기서는 기본적으로 '차단 목록에 명시된 이름'을 차단하는 로직으로 응용.
                    // 단순화를 위해 정책의 blockedExtensions에 들어있는 '문자열'을 포함하면 차단
                    const isBlocked = exts.some(ext => procName.includes(ext)) || 
                                      currentPolicy.blockedExtensions.some(name => procName === name.toLowerCase());
                    
                    if (isBlocked && procName !== 'jbmsoft-security.exe' && procName !== 'cmd.exe') {
                        exec(`taskkill /F /IM "${procName}"`, (killErr) => {
                            if (!killErr) {
                                console.log(`[OSEngine] 차단된 프로세스 종료: ${procName}`);
                                serverSync.sendLog('process_suspicious', 'critical', `비인가 프로세스 강제 종료: ${procName}`);
                            }
                        });
                    }
                }
            });
        });
    }, 5000);
}

function startClipboardGuard() {
    if (clipboardInterval) clearInterval(clipboardInterval);
    
    let lastText = clipboard.readText();
    
    clipboardInterval = setInterval(() => {
        if (!currentPolicy.clipboardGuardEnabled) return;

        const currentText = clipboard.readText();
        if (currentText !== lastText && currentText.trim().length > 0) {
            // 간단한 패턴 검사 (예: 주민등록번호 6자리-7자리)
            const juminRegex = /\d{6}[-\s]?\d{7}/;
            if (juminRegex.test(currentText)) {
                clipboard.clear(); // 클립보드 비우기
                lastText = '';
                console.log('[OSEngine] 중요 개인정보(주민번호 패턴) 복사 차단됨');
                serverSync.sendLog('clipboard_blocked', 'warning', '중요 개인정보(주민번호 패턴) 복사 시도 차단됨');
            } else {
                lastText = currentText;
            }
        }
    }, 1500);
}

function startUsbDetector() {
    if (usbProcess) {
        usbProcess.kill();
        usbProcess = null;
    }

    if (!currentPolicy.usbBlockingEnabled) return;

    // PowerShell을 사용해 WMI 이벤트 등록 및 감시 (USB 삽입 이벤트)
    // -Query "SELECT * FROM __InstanceCreationEvent WITHIN 2 WHERE TargetInstance ISA 'Win32_LogicalDisk' AND TargetInstance.DriveType = 2"
    const psScript = `
        $query = "SELECT * FROM __InstanceCreationEvent WITHIN 2 WHERE TargetInstance ISA 'Win32_LogicalDisk' AND TargetInstance.DriveType = 2"
        Register-WmiEvent -Query $query -SourceIdentifier "USB_Insert" -Action {
            Write-Host "USB_DETECTED:$($event.SourceEventArgs.NewEvent.TargetInstance.DeviceID)"
        }
        Write-Host "USB_MONITOR_STARTED"
        while ($true) { Start-Sleep -Seconds 1 }
    `;

    usbProcess = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psScript]);

    usbProcess.stdout.on('data', (data) => {
        const output = data.toString().trim();
        if (output.includes('USB_DETECTED')) {
            const driveLetter = output.split(':')[1];
            console.log(`[OSEngine] USB 연결 감지됨: ${driveLetter}`);
            serverSync.sendLog('usb_detected', 'critical', `인가되지 않은 USB 저장장치 연결 감지 (${driveLetter} 드라이브)`);
            
            // USB 차단 로직 (드라이브 마운트 해제 등)은 시스템 권한과 복잡한 API가 필요하므로 여기서는 경고 로그만 남기거나 사용자에게 알림을 띄웁니다.
        }
    });

    usbProcess.on('error', (err) => {
        console.error('[OSEngine] USB 감시 프로세스 에러:', err);
    });
}

function startEngine() {
    if (isEngineRunning) return;
    isEngineRunning = true;
    
    console.log('[OSEngine] OS 레벨 보안 감시 엔진 시작');
    startProcessMonitor();
    startClipboardGuard();
    startUsbDetector();
}

function stopEngine() {
    isEngineRunning = false;
    if (processInterval) clearInterval(processInterval);
    if (clipboardInterval) clearInterval(clipboardInterval);
    if (usbProcess) {
        usbProcess.kill();
        usbProcess = null;
    }
    console.log('[OSEngine] OS 레벨 보안 감시 엔진 정지');
}

module.exports = {
    startEngine,
    stopEngine,
    updateEnginePolicy
};

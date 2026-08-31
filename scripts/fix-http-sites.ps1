#Requires -Version 5.1
# HTTP site emergency fix for OksooSecurity proxy issue
# Run via: 01_HTTP사이트_긴급복구.bat (as Administrator)

$ErrorActionPreference = 'Continue'
try {
  chcp 65001 | Out-Null
  [Console]::InputEncoding  = [System.Text.UTF8Encoding]::new($false)
  [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
  $OutputEncoding = [Console]::OutputEncoding
} catch {}

$Host.UI.RawUI.WindowTitle = 'OKSOOHT HTTP Emergency Fix'

function Test-Admin {
  $p = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
  return $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Write-Step([string]$msg) { Write-Host ""; Write-Host "==> $msg" -ForegroundColor Cyan }
function Write-Ok([string]$msg)   { Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Warn([string]$msg) { Write-Host "  [!] $msg" -ForegroundColor Yellow }
function Write-Fail([string]$msg) { Write-Host "  [X] $msg" -ForegroundColor Red }

function Refresh-WinInetProxy {
  $code = @'
$sig = @"
[DllImport("wininet.dll", SetLastError=true)]
public static extern bool InternetSetOption(IntPtr hInternet, int dwOption, IntPtr lpBuffer, int dwBufferLength);
"@
try {
  $t = Add-Type -MemberDefinition $sig -Name WU -Namespace InetFix -PassThru -ErrorAction Stop
  [void]$t::InternetSetOption([IntPtr]::Zero, 39, [IntPtr]::Zero, 0)
  [void]$t::InternetSetOption([IntPtr]::Zero, 37, [IntPtr]::Zero, 0)
} catch {}
'@
  powershell -NoProfile -ExecutionPolicy Bypass -Command $code 2>$null | Out-Null
}

function Disable-SystemProxy {
  $regPath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings'
  Set-ItemProperty -Path $regPath -Name ProxyEnable -Value 0 -Type DWord -Force -ErrorAction SilentlyContinue
  Remove-ItemProperty -Path $regPath -Name ProxyServer -ErrorAction SilentlyContinue
  Set-ItemProperty -Path $regPath -Name ProxyOverride -Value 'localhost;127.0.0.1;<local>' -Force -ErrorAction SilentlyContinue
  try { netsh winhttp reset proxy | Out-Null } catch {}
  Refresh-WinInetProxy
}

function Stop-OksooProcesses {
  Get-Process -Name 'OksooSecurity' -ErrorAction SilentlyContinue | ForEach-Object {
    Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
    Write-Ok ("Stopped: {0} (PID {1})" -f $_.ProcessName, $_.Id)
  }
  Get-Process -ErrorAction SilentlyContinue | Where-Object {
    $_.ProcessName -match 'electron' -and $_.Path -and ($_.Path -match 'OksooSecurity|oksoo-security')
  } | ForEach-Object {
    Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
    Write-Ok ("Stopped: {0} (PID {1})" -f $_.ProcessName, $_.Id)
  }
  try { cmd /c "wmic process where ""name='OksooSecurity.exe'"" call terminate" 2>$null | Out-Null } catch {}
  Start-Sleep -Seconds 1
}

function Disable-OksooAutostart {
  $markerDir = Join-Path $env:APPDATA 'OksooSecurity'
  if (-not (Test-Path $markerDir)) { New-Item -ItemType Directory -Path $markerDir -Force | Out-Null }
  $marker = Join-Path $markerDir 'http-fix-autostart-disabled.json'
  $backup = [ordered]@{
    disabledAt = (Get-Date).ToString('o')
    tasks = @()
    runKeys = @()
  }

  foreach ($tn in @('OksooSecurityStartupTask', 'OksooSecurity', 'oksoo-security')) {
    schtasks /Query /TN $tn 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) {
      schtasks /Change /TN $tn /DISABLE 2>$null | Out-Null
      if ($LASTEXITCODE -eq 0) {
        $backup.tasks += $tn
        Write-Ok ("Autostart disabled: {0}" -f $tn)
      } else {
        Write-Warn ("Failed to disable task: {0}" -f $tn)
      }
    }
  }

  $runPaths = @(
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run',
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\Run',
    'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Run'
  )
  foreach ($rp in $runPaths) {
    if (-not (Test-Path $rp)) { continue }
    $item = Get-Item $rp -ErrorAction SilentlyContinue
    if (-not $item) { continue }
    foreach ($prop in @($item.Property)) {
      if ($prop -match 'Oksoo|oksoo|JBMSOFT') {
        $val = (Get-ItemProperty $rp -Name $prop).$prop
        $backup.runKeys += @{ path = $rp; name = $prop; value = $val }
        Remove-ItemProperty -Path $rp -Name $prop -Force -ErrorAction SilentlyContinue
        Write-Ok ("Removed Run key: {0}\{1}" -f $rp, $prop)
      }
    }
  }

  ($backup | ConvertTo-Json -Depth 5) | Set-Content -Path $marker -Encoding UTF8
  Write-Ok ("Saved restore info: {0}" -f $marker)
}

function Remove-MailFirewallRules {
  netsh advfirewall firewall delete rule name="OKSOOHT-MailGuard-Block" 2>$null | Out-Null
  $out = netsh advfirewall firewall show rule name=all 2>$null
  if ($out) {
    foreach ($line in ($out -split "`n")) {
      if ($line -match 'Rule Name:\s+(OKSOOHT-MailGuard-.+)') {
        $rn = $Matches[1].Trim()
        netsh advfirewall firewall delete rule name="$rn" 2>$null | Out-Null
        Write-Ok ("Removed firewall rule: {0}" -f $rn)
      }
    }
  }
}

Clear-Host
Write-Host '===================================================='
Write-Host '  OKSOOHT - HTTP Site Emergency Fix'
Write-Host '  (glos / incoil / pfckorea 등 HTTP 접속 복구)'
Write-Host '===================================================='
Write-Host ''
Write-Host '이 도구가 하는 일:'
Write-Host '  1) Windows 시스템 프록시 끄기'
Write-Host '  2) OksooSecurity 프로세스 종료 (직접 종료할 필요 없음)'
Write-Host '  3) 자동실행 임시 끄기 (재부팅 후에도 HTTP 유지)'
Write-Host '  4) 메일 방화벽 잔여 규칙 제거'
Write-Host ''
Write-Host '보안을 다시 켜려면: 02_보안프로그램_다시켜기.bat' -ForegroundColor Yellow
Write-Host ''

if (-not (Test-Admin)) {
  Write-Fail '관리자 권한이 필요합니다. bat을 우클릭 → 관리자 권한으로 실행하세요.'
  Read-Host 'Press Enter to exit'
  exit 1
}

Write-Host '계속: Enter / 취소: Ctrl+C' -ForegroundColor Yellow
[void](Read-Host)

Write-Step '1/4 Disable Windows system proxy'
Disable-SystemProxy
Write-Ok 'ProxyEnable=0, ProxyServer removed, WinHTTP reset'

Write-Step '2/4 Stop OksooSecurity'
Stop-OksooProcesses
Disable-SystemProxy
Write-Ok 'Process stop + proxy re-check done'

Write-Step '3/4 Disable autostart temporarily'
Disable-OksooAutostart

Write-Step '4/4 Remove leftover mail firewall rules'
Remove-MailFirewallRules
Write-Ok 'Firewall cleanup attempted'

Write-Host ''
Write-Host '====================================================' -ForegroundColor Green
Write-Host '  DONE - 복구 완료' -ForegroundColor Green
Write-Host '====================================================' -ForegroundColor Green
Write-Host ''
Write-Host '다음 확인:'
Write-Host '  1. 브라우저를 모두 종료 후 다시 실행'
Write-Host '  2. http://glos.co.kr 등 HTTP 사이트 접속 테스트'
Write-Host '  3. 재부팅해도 HTTP는 유지됩니다 (자동실행 끔)'
Write-Host ''
Write-Host '보안 프로그램 재가동은 정식 HTTP 수정본 배포 후에:' -ForegroundColor Cyan
Write-Host '  02_보안프로그램_다시켜기.bat'
Write-Host ''
Read-Host 'Press Enter to exit'

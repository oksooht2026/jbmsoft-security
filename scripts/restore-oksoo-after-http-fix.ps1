#Requires -Version 5.1
# Restore OksooSecurity autostart after HTTP emergency fix

$ErrorActionPreference = 'Continue'
try {
  chcp 65001 | Out-Null
  [Console]::InputEncoding  = [System.Text.UTF8Encoding]::new($false)
  [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
  $OutputEncoding = [Console]::OutputEncoding
} catch {}

$Host.UI.RawUI.WindowTitle = 'OKSOOHT Restore Security'

function Test-Admin {
  $p = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
  return $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Write-Step([string]$msg) { Write-Host ""; Write-Host "==> $msg" -ForegroundColor Cyan }
function Write-Ok([string]$msg)   { Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Warn([string]$msg) { Write-Host "  [!] $msg" -ForegroundColor Yellow }
function Write-Fail([string]$msg) { Write-Host "  [X] $msg" -ForegroundColor Red }

Clear-Host
Write-Host '===================================================='
Write-Host '  OKSOOHT - Restore Security Autostart'
Write-Host '  보안 프로그램 자동실행 복구'
Write-Host '===================================================='
Write-Host ''

if (-not (Test-Admin)) {
  Write-Fail '관리자 권한이 필요합니다.'
  Read-Host 'Press Enter to exit'
  exit 1
}

$markerCandidates = @(
  (Join-Path $env:APPDATA 'OksooSecurity\http-fix-autostart-disabled.json'),
  (Join-Path $env:APPDATA 'oksoo-security\http-fix-autostart-disabled.json')
)
$marker = $markerCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1

if ($marker) {
  Write-Step ("Load restore info: {0}" -f $marker)
  try {
    $backup = Get-Content $marker -Raw -Encoding UTF8 | ConvertFrom-Json
  } catch {
    $backup = $null
    Write-Warn '복구 정보 파싱 실패 — 기본 복구만 진행'
  }

  if ($backup -and $backup.tasks) {
    foreach ($tn in $backup.tasks) {
      schtasks /Change /TN $tn /ENABLE 2>$null | Out-Null
      if ($LASTEXITCODE -eq 0) { Write-Ok ("Enabled task: {0}" -f $tn) }
      else { Write-Warn ("Failed to enable task: {0}" -f $tn) }
    }
  }

  if ($backup -and $backup.runKeys) {
    foreach ($rk in $backup.runKeys) {
      $path = $rk.path
      $name = $rk.name
      $value = $rk.value
      if (-not (Test-Path $path)) { continue }
      Set-ItemProperty -Path $path -Name $name -Value $value -Force -ErrorAction SilentlyContinue
      Write-Ok ("Restored Run key: {0}\{1}" -f $path, $name)
    }
  }

  Remove-Item $marker -Force -ErrorAction SilentlyContinue
} else {
  Write-Warn '복구 마커 없음 — 알려진 작업명만 재활성 시도'
  foreach ($tn in @('OksooSecurityStartupTask', 'OksooSecurity')) {
    schtasks /Change /TN $tn /ENABLE 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { Write-Ok ("Enabled task: {0}" -f $tn) }
  }
}

Write-Step 'Start OksooSecurity'
$exeCandidates = @(
  "${env:ProgramFiles}\OksooSecurity\OksooSecurity.exe",
  "${env:ProgramFiles(x86)}\OksooSecurity\OksooSecurity.exe",
  "$env:LOCALAPPDATA\Programs\oksoo-security\OksooSecurity.exe",
  "$env:LOCALAPPDATA\Programs\OksooSecurity\OksooSecurity.exe"
)
$exe = $exeCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($exe) {
  Start-Process -FilePath $exe
  Write-Ok ("Started: {0}" -f $exe)
  Write-Warn '보안 프로그램이 다시 뜨면 HTTP 사이트가 또 막힐 수 있습니다.'
  Write-Warn 'HTTP 수정본 배포 후에만 이 복구를 사용하세요.'
} else {
  Write-Warn '실행 파일을 찾지 못했습니다. 시작 메뉴에서 OksooSecurity를 직접 실행하세요.'
}

Write-Host ''
Write-Host '복구 절차 완료.' -ForegroundColor Green
Read-Host 'Press Enter to exit'

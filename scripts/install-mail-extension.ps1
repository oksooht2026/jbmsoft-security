# OKSOOHT Security — Chrome 확장 + Native Messaging 설치 스크립트
# 관리자 권한 PowerShell에서 실행

param(
    [string]$ExtensionPath = "",
    [string]$InstallDir = "",
    [string]$ExtensionId = ""
)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
if (-not $ExtensionPath) { $ExtensionPath = Join-Path $root "chrome-extension" }
if (-not $InstallDir) {
    $InstallDir = Join-Path $env:LOCALAPPDATA "Programs\oksoo-security"
}

Write-Host "=== OKSOOHT Mail Logger 설치 ===" -ForegroundColor Cyan
Write-Host "확장 경로: $ExtensionPath"
Write-Host "설치 경로: $InstallDir"

# 1) Native Host 파일 복사
$nativeSrc = Join-Path $root "native-host"
$nativeDst = Join-Path $InstallDir "native-host"
New-Item -ItemType Directory -Path $nativeDst -Force | Out-Null
Copy-Item "$nativeSrc\*" $nativeDst -Recurse -Force

# 2) 브리지 env (Electron 실행 후 자동 생성되지만 템플릿 생성)
$appData = Join-Path $env:APPDATA "oksoo-security"
New-Item -ItemType Directory -Path $appData -Force | Out-Null
$envFile = Join-Path $appData "mail-bridge.env"
if (-not (Test-Path $envFile)) {
    @(
        "PORT=38471",
        "TOKEN="
    ) | Set-Content $envFile -Encoding UTF8
}

# 3) Native Messaging manifest
$origins = @("chrome-extension://keoikkfimipminfdbjlekjhgcjkjolil/")
if ($ExtensionId) {
    $origins = @("chrome-extension://$ExtensionId/")
}

$manifest = @{
    name = "com.oksoohitech.security.mail"
    description = "OKSOOHT Security Mail Logger Native Host"
    path = (Join-Path $nativeDst "OksooMailHost.cmd")
    type = "stdio"
    allowed_origins = $origins
} | ConvertTo-Json -Depth 4

$manifestPath = Join-Path $appData "native-host-manifest.json"
$manifest | Set-Content $manifestPath -Encoding UTF8

$regKeys = @(
    "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.oksoohitech.security.mail",
    "HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.oksoohitech.security.mail",
    "HKCU\Software\Naver\Whale\NativeMessagingHosts\com.oksoohitech.security.mail"
)

foreach ($key in $regKeys) {
    reg add $key /ve /d $manifestPath /f | Out-Null
    Write-Host "등록: $key" -ForegroundColor Green
}

Write-Host ""
Write-Host "다음 단계:" -ForegroundColor Yellow
Write-Host "1. Chrome → chrome://extensions → 개발자 모드 → '압축해제된 확장 프로그램 로드'"
Write-Host "   경로: $ExtensionPath"
Write-Host "2. 확장 ID를 복사한 뒤 이 스크립트를 -ExtensionId <ID> 로 다시 실행"
Write-Host "3. 옥수하이테크 보안솔루션(Electron) 앱이 트레이에서 실행 중이어야 합니다."
Write-Host ""
Write-Host "완료." -ForegroundColor Green

# OKSOOHT Security — 브라우저 확장 자동 설치 (NSIS / 수동)
param(
    [string]$ResourcesDir = ""
)

$ErrorActionPreference = "Continue"
$ExtensionId = "keoikkfimipminfdbjlekjhgcjkjolil"
$ExtensionVersion = "1.0.0"

if (-not $ResourcesDir) {
    $ResourcesDir = Join-Path $PSScriptRoot ".."
}
$ExtDir = Join-Path $ResourcesDir "chrome-extension"
if (-not (Test-Path (Join-Path $ExtDir "manifest.json"))) {
    Write-Host "확장 폴더 없음: $ExtDir" -ForegroundColor Red
    exit 1
}

$ExtDirWin = $ExtDir -replace '/', '\'
$FileUrl = "file:///" + ($ExtDir -replace '\\', '/').Replace(' ', '%20')

$browsers = @(
    @{ Name = "Chrome"; Reg = "HKCU:\Software\Google\Chrome\Extensions\$ExtensionId" },
    @{ Name = "Edge";   Reg = "HKCU:\Software\Microsoft\Edge\Extensions\$ExtensionId" },
    @{ Name = "Whale";  Reg = "HKCU:\Software\Naver\Whale\Extensions\$ExtensionId" }
)

foreach ($b in $browsers) {
    try {
        New-Item -Path $b.Reg -Force | Out-Null
        Set-ItemProperty -Path $b.Reg -Name "path" -Value $ExtDirWin
        Set-ItemProperty -Path $b.Reg -Name "version" -Value $ExtensionVersion
        Write-Host "[OK] $($b.Name) 확장 등록" -ForegroundColor Green
    } catch {
        Write-Host "[WARN] $($b.Name): $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

$policies = @(
    @{ Name = "Chrome"; Reg = "HKCU:\Software\Policies\Google\Chrome\ExtensionInstallForcelist" },
    @{ Name = "Edge";   Reg = "HKCU:\Software\Policies\Microsoft\Edge\ExtensionInstallForcelist" }
)
$policyValue = "$ExtensionId;$FileUrl"

foreach ($p in $policies) {
    try {
        New-Item -Path $p.Reg -Force | Out-Null
        Set-ItemProperty -Path $p.Reg -Name "1" -Value $policyValue
        Write-Host "[OK] $($p.Name) 강제 설치 정책" -ForegroundColor Green
    } catch {
        Write-Host "[WARN] $($p.Name) 정책: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

Write-Host "확장 ID: $ExtensionId" -ForegroundColor Cyan
Write-Host "경로: $ExtDirWin" -ForegroundColor Cyan
Write-Host "브라우저 재시작 후 확장이 활성화됩니다." -ForegroundColor Yellow

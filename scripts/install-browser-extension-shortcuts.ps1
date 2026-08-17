# Chrome/Edge/Whale 바로가기에 --load-extension 자동 추가 (웹스토어 없이 무료 배포)
param(
    [string]$ExtensionDir = "",
    [string]$ResourcesDir = ""
)

$ErrorActionPreference = "Continue"

if (-not $ExtensionDir) {
    if ($ResourcesDir) {
        $ExtensionDir = Join-Path $ResourcesDir "chrome-extension"
    } else {
        $ExtensionDir = Join-Path (Split-Path $PSScriptRoot -Parent) "chrome-extension"
    }
}

$ExtensionDir = (Resolve-Path $ExtensionDir -ErrorAction SilentlyContinue).Path
if (-not $ExtensionDir -or -not (Test-Path (Join-Path $ExtensionDir "manifest.json"))) {
    Write-Host "[FAIL] 확장 폴더 없음: $ExtensionDir" -ForegroundColor Red
    exit 1
}

$loadArg = "--load-extension=`"$ExtensionDir`""
$browserExes = @("chrome.exe", "msedge.exe", "whale.exe")

$searchRoots = @(
    [Environment]::GetFolderPath("Desktop"),
    [Environment]::GetFolderPath("Programs"),
    "$env:ProgramData\Microsoft\Windows\Start Menu\Programs",
    "$env:APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar",
    "$env:APPDATA\Microsoft\Internet Explorer\Quick Launch"
) | Where-Object { $_ -and (Test-Path $_) }

$shell = New-Object -ComObject WScript.Shell
$patched = 0
$skipped = 0

function Update-Shortcut {
    param([string]$LnkPath)
    try {
        $lnk = $shell.CreateShortcut($LnkPath)
        $target = [string]$lnk.TargetPath
        if ([string]::IsNullOrWhiteSpace($target)) { return }
        $name = (Split-Path $target -Leaf).ToLowerInvariant()
        if ($browserExes -notcontains $name) { return }

        $args = [string]$lnk.Arguments
        if ($args -match [regex]::Escape($ExtensionDir)) {
            $script:skipped++
            return
        }
        if ($args -match "--load-extension") {
            $lnk.Arguments = ($args.Trim() + " " + $loadArg).Trim()
        } else {
            $lnk.Arguments = ($args.Trim() + " " + $loadArg).Trim()
        }
        $lnk.Save()
        Write-Host "[OK] $($name) 바로가기: $LnkPath" -ForegroundColor Green
        $script:patched++
    } catch {
        Write-Host "[WARN] $LnkPath : $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

foreach ($root in $searchRoots) {
    Get-ChildItem -Path $root -Filter "*.lnk" -Recurse -ErrorAction SilentlyContinue | ForEach-Object {
        Update-Shortcut $_.FullName
    }
}

# 작업 표시줄 고정(일부) — .lnk 직접 검색
$taskBand = "$env:APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar"
if (Test-Path $taskBand) {
    Get-ChildItem $taskBand -Filter "*.lnk" -ErrorAction SilentlyContinue | ForEach-Object {
        Update-Shortcut $_.FullName
    }
}

Write-Host ""
Write-Host "확장 경로: $ExtensionDir" -ForegroundColor Cyan
Write-Host "수정된 바로가기: $patched / 이미 적용: $skipped" -ForegroundColor Cyan
Write-Host ""
Write-Host "※ Chrome을 바로가기(또는 작업 표시줄)로 실행해야 확장이 로드됩니다." -ForegroundColor Yellow
Write-Host "※ 작업 표시줄에 고정된 아이콘이 예전 경로면, 고정 해제 후 시작 메뉴에서 다시 고정하세요." -ForegroundColor Yellow
Write-Host "※ 확장 옆에 '개발자 모드' 배너가 보일 수 있습니다 (정상)." -ForegroundColor Yellow

if ($patched -eq 0 -and $skipped -eq 0) {
    Write-Host ""
    Write-Host "바로가기를 찾지 못했습니다. 수동 설치:" -ForegroundColor Yellow
    Write-Host "  chrome://extensions → 개발자 모드 → 압축해제 로드 → $ExtensionDir"
    exit 2
}

exit 0

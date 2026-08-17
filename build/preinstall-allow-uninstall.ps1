# 재설치 전 1회 실행 — 구버전 삭제 보호 우회
# 관리자 PowerShell: .\build\preinstall-allow-uninstall.ps1

$regPath = 'HKCU:\Software\JBMSOFT_Security'
if (-not (Test-Path $regPath)) {
    New-Item -Path $regPath -Force | Out-Null
}
Set-ItemProperty -Path $regPath -Name 'UninstallAllowed' -Value '1' -Type String
Write-Host 'UninstallAllowed=1 설정 완료. 이제 OksooSecurity_Setup.exe 를 실행하세요.' -ForegroundColor Green

Get-Process | Where-Object { $_.ProcessName -match '옥수하이테크|OksooSecurity|Setup' } | ForEach-Object {
    Write-Host "종료: $($_.ProcessName)"
    Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
}

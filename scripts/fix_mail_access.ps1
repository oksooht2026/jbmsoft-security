# 메일(네이버·Gmail) 접속 복구 — OKSOOHT 보안 프로그램 잔여 차단 제거
# 관리자 PowerShell에서 실행:  Set-ExecutionPolicy Bypass -Scope Process; .\fix_mail_access.ps1

Write-Host "OKSOOHT 메일 접속 복구 스크립트" -ForegroundColor Cyan

# 1) 방화벽 메일 포트 차단 규칙 제거
netsh advfirewall firewall delete rule name="OKSOOHT-MailGuard-Block" 2>$null
Get-NetFirewallRule -DisplayName "OKSOOHT-MailGuard*" -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue
Write-Host "[1/2] 방화벽 메일 차단 규칙 제거 완료"

# 2) hosts 파일에서 JBMSOFT 보안 구역 제거 (웹메일 도메인 복구)
$hosts = "$env:Windir\System32\drivers\etc\hosts"
if (Test-Path $hosts) {
    $content = Get-Content $hosts -Raw
    $content = $content -replace "(?s)\r?\n?# --- JBMSOFT_SECURITY_START ---.*?# --- JBMSOFT_SECURITY_END ---\r?\n?", "`n"
    Set-Content -Path $hosts -Value $content.TrimEnd() -Encoding UTF8
    ipconfig /flushdns | Out-Null
    Write-Host "[2/2] hosts 웹메일 차단 구역 제거 + DNS 캐시 초기화 완료"
}

Write-Host ""
Write-Host "완료. 브라우저를 완전히 닫았다가 다시 열어 mail.naver.com / gmail.com 을 확인하세요." -ForegroundColor Green
Write-Host "보안 프로그램을 최신 설치본으로 업데이트하면 자동으로 메일 차단이 꺼집니다." -ForegroundColor Yellow

# 메일/웹메일 hosts 차단 즉시 해제 (관리자 PowerShell)
# 보안 앱 끈 뒤에도 mail.naver.com 등 안 열릴 때 실행

$hostsPath = "$env:SystemRoot\System32\drivers\etc\hosts"
$start = '# --- JBMSOFT_SECURITY_START ---'
$end = '# --- JBMSOFT_SECURITY_END ---'

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Host "관리자 PowerShell로 다시 실행하세요." -ForegroundColor Red
  exit 1
}

$content = Get-Content $hostsPath -Raw -ErrorAction Stop
$pattern = "(?s)\r?\n?$([regex]::Escape($start)).*$([regex]::Escape($end))\r?\n?"
$newContent = [regex]::Replace($content, $pattern, "`n").TrimEnd() + "`n"
Set-Content -Path $hostsPath -Value $newContent -Encoding ASCII

Write-Host "hosts 차단 구역 제거 완료" -ForegroundColor Green
ipconfig /flushdns | Out-Null
Write-Host "DNS 캐시 초기화 완료 — 브라우저 새로고침 후 메일 접속해 보세요." -ForegroundColor Green

# 방화벽 메일 규칙 제거
netsh advfirewall firewall delete rule name="OKSOOHT-MailGuard-Block" 2>$null
Write-Host "메일 방화벽 규칙 제거 시도 완료" -ForegroundColor Green

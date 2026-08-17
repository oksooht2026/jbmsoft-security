# 관리자 권한으로 실행 — hosts 웹메일 차단 제거
$hosts = "$env:Windir\System32\drivers\etc\hosts"
if (-not (Test-Path $hosts)) { exit 1 }

$content = Get-Content $hosts -Raw -Encoding UTF8
$newContent = $content -replace "(?s)\r?\n?# --- JBMSOFT_SECURITY_START ---.*?# --- JBMSOFT_SECURITY_END ---\r?\n?", "`n"
$newContent = $newContent.TrimEnd() + "`n"
Set-Content -Path $hosts -Value $newContent -Encoding UTF8

netsh advfirewall firewall delete rule name="OKSOOHT-MailGuard-Block" 2>$null
Get-NetFirewallRule -DisplayName "OKSOOHT-MailGuard*" -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue
ipconfig /flushdns | Out-Null

Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.MessageBox]::Show(
  "메일 사이트 차단을 제거했습니다.`n`nChrome/Edge를 완전히 닫았다가 다시 열고`nmail.naver.com / gmail.com 을 확인하세요.",
  "OKSOOHT 메일 복구",
  [System.Windows.Forms.MessageBoxButtons]::OK,
  [System.Windows.Forms.MessageBoxIcon]::Information
) | Out-Null

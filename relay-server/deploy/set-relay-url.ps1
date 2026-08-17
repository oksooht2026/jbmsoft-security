# Supabase relay_url 등록 — API 경유 (로컬 .env 불필요)
param(
  [Parameter(Mandatory = $true)]
  [string]$RelayUrl
)

$ErrorActionPreference = "Stop"
$ApiBase = "https://oksooht-security-api.vercel.app/api"
$Headers = @{
  "Content-Type" = "application/json"
  "x-api-key"    = "oksooht-security-2026"
}

if ($RelayUrl -notmatch '^wss?://') {
  $RelayUrl = "wss://" + $RelayUrl.TrimStart('/')
}

Write-Host "Relay URL 등록 중: $RelayUrl"

$body = @{ key = "relay_url"; value = ($RelayUrl | ConvertTo-Json) } | ConvertTo-Json
$res = Invoke-RestMethod -Uri "$ApiBase/settings" -Method PUT -Headers $Headers -Body $body

if ($res.success) {
  Write-Host "OK — DB 저장 완료 (policy_version 자동 갱신)" -ForegroundColor Green
  Write-Host "5분 이내 42대 PC 자동 연결됩니다."
} else {
  throw "저장 실패"
}

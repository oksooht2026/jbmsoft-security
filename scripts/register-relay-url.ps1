# wss URL 받으면 DB 등록 (당신: URL만 알려주면 됨)
param(
  [Parameter(Mandatory = $true)]
  [string]$WssUrl
)

if ($WssUrl -notmatch '^wss?://') {
  $WssUrl = "wss://" + $WssUrl.TrimStart('/')
}

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root

& "$root\relay-server\deploy\set-relay-url.ps1" -RelayUrl $WssUrl

Write-Host ""
Write-Host "완료. 5분 후 PC들이 자동 연결됩니다." -ForegroundColor Green

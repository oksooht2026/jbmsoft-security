# OKSOOHT 릴레이 — 당신이 할 일: VM IP만 입력
# 사용: .\scripts\relay-one-shot.ps1 -VmIp "123.45.67.89"
param(
  [Parameter(Mandatory = $true)]
  [string]$VmIp,
  [string]$SshUser = "ubuntu"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$relay = Join-Path $root "relay-server"

Write-Host "=== 1/3 relay-server VM 업로드 ===" -ForegroundColor Cyan
scp -r "$relay" "${SshUser}@${VmIp}:~/"

Write-Host "=== 2/3 VM에서 24/7 설치 ===" -ForegroundColor Cyan
ssh "${SshUser}@${VmIp}" "cd ~/relay-server && chmod +x deploy/*.sh && bash deploy/oracle-setup.sh"

Write-Host "=== 3/3 health 확인 ===" -ForegroundColor Cyan
try {
  $r = Invoke-RestMethod -Uri "http://${VmIp}:8765/health" -TimeoutSec 15
  if ($r.ok) {
    Write-Host "OK: 릴레이 실행 중" -ForegroundColor Green
  }
} catch {
  Write-Host "health 확인 실패 — Oracle 방화벽 8765 포트 열었는지 확인" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host " 다음은 VM SSH에서 한 줄만 실행하세요:" -ForegroundColor Green
Write-Host " cloudflared tunnel --url http://127.0.0.1:8765" -ForegroundColor White
Write-Host " 나온 https://... 를 wss://... 로 바꿔서 알려주세요." -ForegroundColor Green
Write-Host " 그러면 relay URL DB 등록은 자동 처리합니다." -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green

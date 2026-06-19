# OKSOOHT Security Admin — Vercel 배포 스크립트
# 최초 1회: npx vercel login
# 이후: .\deploy.ps1

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "OKSOOHT Security Admin 배포 중..." -ForegroundColor Cyan

npx vercel link --project oksooht-security-admin --yes 2>$null
npx vercel --prod --yes

Write-Host ""
Write-Host "배포 완료 URL: https://oksooht-security-api.vercel.app/admin" -ForegroundColor Green
Write-Host "로그인 비밀번호: oksooht2026" -ForegroundColor Yellow

# OKSOOHT server-api Vercel 배포 (루트 node_modules 제외)
$ErrorActionPreference = "Stop"
$tmp = Join-Path $PSScriptRoot "..\oksooht-security-api"
$src = Join-Path $PSScriptRoot "..\server-api"

Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue

$apiDest = Join-Path $tmp "server-api"
New-Item -ItemType Directory -Path "$apiDest\api\lib" -Force | Out-Null
Copy-Item "$src\api\*" "$apiDest\api\" -Recurse -Force
Copy-Item "$src\public" "$apiDest\public" -Recurse -Force -ErrorAction SilentlyContinue
Copy-Item "$src\package.json","$src\vercel.json","$src\.vercelignore" $apiDest -Force

Push-Location $tmp
npx vercel link --scope oksooht2026s-projects --project oksooht-security-api --yes
npx vercel --prod --yes --archive=tgz
Pop-Location

Write-Host "API: https://oksooht-security-api.vercel.app" -ForegroundColor Green

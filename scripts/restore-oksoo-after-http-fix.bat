@echo off
setlocal
title OKSOOHT Restore Security
cd /d "%~dp0"

net session >nul 2>&1
if errorlevel 1 (
    echo Requesting Administrator privilege...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); & '%~dp0restore-oksoo-after-http-fix.ps1'"
endlocal

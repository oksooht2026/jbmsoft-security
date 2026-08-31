@echo off
setlocal
title OKSOOHT HTTP Emergency Fix
cd /d "%~dp0"

net session >nul 2>&1
if errorlevel 1 (
    echo Requesting Administrator privilege...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); & '%~dp0fix-http-sites.ps1'"
endlocal

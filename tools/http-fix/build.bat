@echo off
setlocal
cd /d "%~dp0"

set CSC=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe
if not exist "%CSC%" set CSC=%WINDIR%\Microsoft.NET\Framework\v4.0.30319\csc.exe
if not exist "%CSC%" (
  echo [ERROR] csc.exe not found
  exit /b 1
)

set OUTDIR=%~dp0..\..\dist\긴급복구_HTTP사이트
if not exist "%OUTDIR%" mkdir "%OUTDIR%"

"%CSC%" /nologo /target:winexe /optimize+ /utf8output ^
  /win32manifest:"%~dp0app.manifest" ^
  /reference:System.Windows.Forms.dll ^
  /reference:System.dll ^
  /reference:Microsoft.CSharp.dll ^
  /out:"%OUTDIR%\OksooHttpFix.exe" ^
  "%~dp0OksooHttpFix.cs"

if errorlevel 1 (
  echo BUILD FAILED
  exit /b 1
)

echo.
echo BUILD OK: %OUTDIR%\OksooHttpFix.exe
dir "%OUTDIR%\OksooHttpFix.exe"
endlocal

@echo off
REM admin-panel 변경사항을 server-api/public/admin 으로 복사 (Vercel 배포용)
xcopy /Y /I "%~dp0index.html" "%~dp0..\server-api\public\admin\"
xcopy /Y /I "%~dp0config.js" "%~dp0..\server-api\public\admin\"
xcopy /Y /I "%~dp0license-manager.html" "%~dp0..\server-api\public\admin\"
xcopy /Y /I "%~dp0file-logs.html" "%~dp0..\server-api\public\admin\"
echo Synced admin-panel -^> server-api/public/admin

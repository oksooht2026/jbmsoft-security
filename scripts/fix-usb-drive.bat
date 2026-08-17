@echo off
chcp 65001 >nul
echo ============================================
echo  USB 드라이브 문자 복구 (관리자 권한 필요)
echo  보안 프로그램 mountvol 차단 잔여분 해제
echo ============================================
echo.

net session >nul 2>&1
if errorlevel 1 (
    echo [오류] 관리자 권한으로 실행해 주세요.
    echo        파일 우클릭 -^> 관리자 권한으로 실행
    pause
    exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$recovered=@(); Get-Disk | Where-Object { $_.BusType -eq 'USB' } | ForEach-Object { Get-Partition -DiskNumber $_.Number | Where-Object { -not $_.DriveLetter -and $_.Size -gt 1MB } | ForEach-Object { $part=$_; for ($c=69; $c -le 90; $c++) { $letter=[char]$c; if (Get-Volume -DriveLetter $letter -ErrorAction SilentlyContinue) { continue }; try { Set-Partition -InputObject $part -NewDriveLetter $letter -ErrorAction Stop; $recovered+=$letter; Write-Host \"복구됨: $letter`:\ ($($_.DiskNumber)번 디스크)\"; break } catch { Write-Host \"${letter}: 할당 실패 - $($_.Exception.Message)\" } } } }; if (-not $recovered.Count) { Write-Host '복구할 USB 없음 (이미 드라이브 문자 있거나 USB 미연결)' } else { Write-Host \"완료: $($recovered -join ', ') 드라이브\" }"

echo.
pause

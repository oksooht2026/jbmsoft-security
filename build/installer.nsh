; OKSOOHT Security — NSIS 커스텀 훅

!macro customCheckAppRunning
  nsExec::Exec `wmic process where "ExecutablePath like '%oksoo-security%'" call terminate`
  Pop $0
  nsExec::Exec `powershell -NoProfile -ExecutionPolicy Bypass -Command "Stop-Process -Name OksooSecurity -ErrorAction SilentlyContinue -Force"`
  Pop $0
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Internet Settings" "ProxyEnable" 0
!macroend

!macro customInstall
  nsExec::Exec `wmic process where "ExecutablePath like '%oksoo-security%'" call terminate`
  Pop $0
  nsExec::Exec `powershell -NoProfile -ExecutionPolicy Bypass -Command "Stop-Process -Name OksooSecurity -ErrorAction SilentlyContinue -Force"`
  Pop $0
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Internet Settings" "ProxyEnable" 0
  ; ★ 설치 완료 후 UninstallAllowed 플래그 반드시 삭제
  ;   (customInit에서 업그레이드 언인스톨러 통과용으로 설정한 값이므로 설치 완료 후엔 제거해야 함)
  DeleteRegValue HKCU "Software\JBMSOFT_Security" "UninstallAllowed"
!macroend

!macro customUnInit
  ; 1. 삭제 승인 플래그(UninstallAllowed == "1") 검사
  ReadRegStr $0 HKCU "Software\JBMSOFT_Security" "UninstallAllowed"
  StrCmp $0 "1" uninstall_ok

  ; 2. 레지스트리에서 비밀번호 읽기
  ReadRegStr $2 HKCU "Software\JBMSOFT_Security" "AdminPassword"
  StrCmp $2 "" 0 +2
    StrCpy $2 "oksooht0731"

  ; 3. VBScript 파일 생성 (.vbs 확장자 필수 — wscript.exe 스크립트 엔진 인식용)
  StrCpy $R0 "$TEMP\oksoo_auth.vbs"
  StrCpy $R2 "$TEMP\oksoo_result.txt"

  FileOpen $R1 $R0 w
  FileWrite $R1 "Dim pw, fso, f, outFile$\r$\n"
  FileWrite $R1 "outFile = WScript.Arguments(0)$\r$\n"
  FileWrite $R1 'pw = InputBox("삭제를 위해 관리자 비밀번호를 입력하세요:", "OksooSecurity 삭제 인증", "")'
  FileWrite $R1 "$\r$\n"
  FileWrite $R1 'Set fso = CreateObject("Scripting.FileSystemObject")'
  FileWrite $R1 "$\r$\n"
  FileWrite $R1 "Set f = fso.OpenTextFile(outFile, 2, True)$\r$\n"
  FileWrite $R1 'If IsNull(pw) Or pw = "" Then'
  FileWrite $R1 "$\r$\n"
  FileWrite $R1 '    f.Write "CANCEL"'
  FileWrite $R1 "$\r$\n"
  FileWrite $R1 "Else$\r$\n"
  FileWrite $R1 "    f.Write pw$\r$\n"
  FileWrite $R1 "End If$\r$\n"
  FileWrite $R1 "f.Close$\r$\n"
  FileClose $R1

  ; 4. wscript.exe로 VBScript 실행 (GUI 앱 — InputBox 다이얼로그만 표시)
  nsExec::ExecToStack `wscript.exe "$R0" "$R2"`
  Pop $0

  ; 5. 결과 읽기
  FileOpen $R3 $R2 r
  FileRead $R3 $1
  FileClose $R3
  Delete $R0
  Delete $R2

  ; 6. 비교 (oksooht0731 마스터 비밀번호 또는 레지스트리 비밀번호 일치 시 100% 통과)
  StrCmp $1 "" uninstall_abort
  StrCmp $1 "CANCEL" uninstall_abort
  StrCmp $1 "oksooht0731" uninstall_ok
  StrCmp $1 "oksooht" uninstall_ok
  StrCmp $1 $2 uninstall_ok

  MessageBox MB_ICONSTOP|MB_OK "비밀번호 인증 실패$\n$\n마스터 비밀번호가 올바르지 않습니다. 삭제 작업을 중단합니다."

  uninstall_abort:
  Abort

  uninstall_ok:
  DeleteRegValue HKCU "Software\JBMSOFT_Security" "UninstallAllowed"
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Internet Settings" "ProxyEnable" 0
  nsExec::Exec `schtasks /Delete /TN "OksooSecurityStartupTask" /F`
!macroend

!macro customUnInstall
  ; 앱 제거 중: 레지스트리 + config.json 양쪽에서 차단된 드라이브 GUID를 읽어 모두 복구
  ; (구버전/신버전 모두 호환 — 앱 강제종료 여부와 관계없이 항상 복구)
  StrCpy $R6 "$TEMP\oksoo_uninstall_recover.ps1"
  FileOpen $R7 $R6 w
  FileWrite $R7 "$$guids = @{}$\r$\n"
  FileWrite $R7 "# 1) 레지스트리 백업에서 읽기 (신버전 방식)$\r$\n"
  FileWrite $R7 "try {$\r$\n"
  FileWrite $R7 "    $$regPath = 'HKCU:\Software\JBMSOFT_Security\BlockedDrives'$\r$\n"
  FileWrite $R7 "    if (Test-Path $$regPath) {$\r$\n"
  FileWrite $R7 "        Get-ItemProperty $$regPath | Get-Member -MemberType NoteProperty | Where-Object { $$_.Name -notlike 'PS*' } | ForEach-Object {$\r$\n"
  FileWrite $R7 "            $$guids[$$_.Name] = (Get-ItemProperty $$regPath).($$_.Name)$\r$\n"
  FileWrite $R7 "        }$\r$\n"
  FileWrite $R7 "    }$\r$\n"
  FileWrite $R7 "} catch {}$\r$\n"
  FileWrite $R7 "# 2) config.json에서 읽기 (구버전/폴백 방식)$\r$\n"
  FileWrite $R7 "try {$\r$\n"
  FileWrite $R7 "    $$cfg = Join-Path $$env:APPDATA 'oksoo-security\config.json'$\r$\n"
  FileWrite $R7 "    if (Test-Path $$cfg) {$\r$\n"
  FileWrite $R7 "        $$j = Get-Content $$cfg -Raw | ConvertFrom-Json$\r$\n"
  FileWrite $R7 "        $$j.blockedVolumeGuids.PSObject.Properties | ForEach-Object {$\r$\n"
  FileWrite $R7 "            if (-not $$guids.ContainsKey($$_.Name)) { $$guids[$$_.Name] = $$_.Value }$\r$\n"
  FileWrite $R7 "        }$\r$\n"
  FileWrite $R7 "    }$\r$\n"
  FileWrite $R7 "} catch {}$\r$\n"
  FileWrite $R7 "# 3) 복구 실행$\r$\n"
  FileWrite $R7 "foreach ($$letter in $$guids.Keys) {$\r$\n"
  FileWrite $R7 "    $$guid = $$guids[$$letter]$\r$\n"
  FileWrite $R7 "    try { mountvol $${letter}:\ $$guid } catch {}$\r$\n"
  FileWrite $R7 "}$\r$\n"
  FileWrite $R7 "# 4) 레지스트리 정리$\r$\n"
  FileWrite $R7 "try { Remove-Item 'HKCU:\Software\JBMSOFT_Security\BlockedDrives' -Recurse -ErrorAction SilentlyContinue } catch {}$\r$\n"
  FileClose $R7
  nsExec::Exec `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$R6"`
  Pop $0
  Delete $R6
!macroend

!macro customInit
  ; 1. 기존 프로세스 강제 종료
  nsExec::Exec `wmic process where "ExecutablePath like '%oksoo-security%'" call terminate`
  Pop $0
  nsExec::Exec `wmic process where "name='OksooSecurity.exe'" call terminate`
  Pop $0
  nsExec::Exec `powershell -NoProfile -ExecutionPolicy Bypass -Command "Stop-Process -Name OksooSecurity -ErrorAction SilentlyContinue -Force"`
  Pop $0

  ; 2. 재설치 시 기존 차단 드라이브 복구 (레지스트리 + config.json 양쪽)
  StrCpy $R6 "$TEMP\oksoo_init_recover.ps1"
  FileOpen $R7 $R6 w
  FileWrite $R7 "$$guids = @{}$\r$\n"
  FileWrite $R7 "try {$\r$\n"
  FileWrite $R7 "    $$regPath = 'HKCU:\Software\JBMSOFT_Security\BlockedDrives'$\r$\n"
  FileWrite $R7 "    if (Test-Path $$regPath) {$\r$\n"
  FileWrite $R7 "        Get-ItemProperty $$regPath | Get-Member -MemberType NoteProperty | Where-Object { $$_.Name -notlike 'PS*' } | ForEach-Object {$\r$\n"
  FileWrite $R7 "            $$guids[$$_.Name] = (Get-ItemProperty $$regPath).($$_.Name)$\r$\n"
  FileWrite $R7 "        }$\r$\n"
  FileWrite $R7 "    }$\r$\n"
  FileWrite $R7 "} catch {}$\r$\n"
  FileWrite $R7 "try {$\r$\n"
  FileWrite $R7 "    $$cfg = Join-Path $$env:APPDATA 'oksoo-security\config.json'$\r$\n"
  FileWrite $R7 "    if (Test-Path $$cfg) {$\r$\n"
  FileWrite $R7 "        $$j = Get-Content $$cfg -Raw | ConvertFrom-Json$\r$\n"
  FileWrite $R7 "        $$j.blockedVolumeGuids.PSObject.Properties | ForEach-Object {$\r$\n"
  FileWrite $R7 "            if (-not $$guids.ContainsKey($$_.Name)) { $$guids[$$_.Name] = $$_.Value }$\r$\n"
  FileWrite $R7 "        }$\r$\n"
  FileWrite $R7 "    }$\r$\n"
  FileWrite $R7 "} catch {}$\r$\n"
  FileWrite $R7 "foreach ($$letter in $$guids.Keys) {$\r$\n"
  FileWrite $R7 "    $$guid = $$guids[$$letter]$\r$\n"
  FileWrite $R7 "    try { mountvol $${letter}:\ $$guid } catch {}$\r$\n"
  FileWrite $R7 "}$\r$\n"
  FileClose $R7
  nsExec::Exec `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$R6"`
  Pop $0
  Delete $R6

  ; 3. 재설치 시 UninstallAllowed 플래그 선설정 (구버전 언인스톨러 통과용)
  WriteRegStr HKCU "Software\JBMSOFT_Security" "UninstallAllowed" "1"

  ; 4. Task Scheduler 기존 작업 삭제
  nsExec::Exec `schtasks /Delete /TN "OksooSecurityStartupTask" /F`

  ; 5. 시스템 프록시 비활성화
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Internet Settings" "ProxyEnable" 0

  ; 6. 구버전 User-level AppData 잔재 강제 제거
  RMDir /r "$LOCALAPPDATA\Programs\oksoo-security"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\com.oksoohitech.security"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\com.oksoohitech.security-NoUSB"
!macroend

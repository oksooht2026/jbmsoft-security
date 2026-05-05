!macro customUnInit
  ; 언인스톨 시작 시 레지스트리에 설정된 'UninstallAllowed' 플래그를 확인합니다.
  ; 이 플래그는 JBMSOFT Security 앱 내에서 관리자 비밀번호를 입력해야만 활성화됩니다.
  ReadRegStr $0 HKCU "Software\JBMSOFT_Security" "UninstallAllowed"
  
  ${If} $0 != "1"
    MessageBox MB_OK|MB_ICONSTOP "보안 위반: 관리자 승인 없이 삭제할 수 없습니다.$\n프로그램 내 [환경설정]에서 관리자 인증 후 삭제를 진행해주세요."
    Abort
  ${EndIf}
  
  ; 언인스톨이 승인되었으므로, 진행 시 플래그를 초기화합니다.
  DeleteRegValue HKCU "Software\JBMSOFT_Security" "UninstallAllowed"
!macroend

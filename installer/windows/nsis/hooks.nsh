; EmbedBay NSIS installer hooks
; Referenced from backend/tauri.conf.json via bundle.windows.nsis.installerHooks

!macro NSIS_HOOK_PREINSTALL
  ; Gracefully close background tray instance if still running before overwriting binaries
  nsExec::ExecToStack 'taskkill /F /IM EmbedBay.exe'
  Pop $0
  Pop $1
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; Never wipe user data during silent upgrades or automated uninstalls
  IfSilent keepData

  MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON1 "Do you want to keep your local EmbedBay vector databases and instance data in %LOCALAPPDATA%?$\r$\n$\r$\nSelect YES to keep your data, or NO to permanently delete all local instances and downloaded engines." IDYES keepData
  RMDir /r "$LOCALAPPDATA\com.embedbay.app"
  RMDir /r "$LOCALAPPDATA\EmbedBay"

  keepData:
!macroend

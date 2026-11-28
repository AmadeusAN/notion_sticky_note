; Sticky Note policy hooks for the pinned Tauri 2.11.4 template.
; No process is terminated, no startup preference is enabled, and no app data is deleted here.

LangString StickyCloseBeforeInstall 1033 "Sticky Note (or portable latest.exe) is running. Choose Quit from its tray menu, then run this installer or uninstaller again. No process has been terminated."
LangString StickyCloseBeforeInstall 2052 "Sticky Note（或便携版 latest.exe）正在运行。请先在托盘菜单选择退出，再重新运行安装或卸载程序。程序不会强制结束任何进程。"
LangString StickyStartupWriteFailed 1033 "The application was installed, but its existing Windows startup path could not be updated. Open Sticky Note and check Launch at startup in Settings."
LangString StickyStartupWriteFailed 2052 "应用已安装，但现有的 Windows 开机启动路径未能更新。请打开 Sticky Note，在设置中检查开机自动启动。"

!macro STICKY_CHECK_PROCESS executable
  ; FindProcess returns 0 for found and 1 for not found. Never invoke KillProcess.
  nsis_tauri_utils::FindProcess "${executable}"
  Pop $R0
  ${If} $R0 = 0
    IfSilent +2 0
      MessageBox MB_OK|MB_ICONEXCLAMATION "$(StickyCloseBeforeInstall)"
    SetErrorLevel 2
    Quit
  ${EndIf}
!macroend

!macro STICKY_REQUIRE_CLOSED
  !insertmacro STICKY_CHECK_PROCESS "${MAINBINARYNAME}.exe"
  !insertmacro STICKY_CHECK_PROCESS "latest.exe"
!macroend

Var StickyStartupBeforeInstall

!macro STICKY_CAPTURE_STARTUP
  ; Legacy uninstallers can delete Run even when passed /UPDATE.
  ; Capture before maintenance, so an existing preference survives that upgrade.
  ReadRegStr $StickyStartupBeforeInstall HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Sticky Note"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; Retarget an existing registration, including one removed by a legacy uninstaller.
  ; StartupApproved bytes are intentionally untouched. An absent preference stays absent.
  ReadRegStr $R0 HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Sticky Note"
  ${If} $R0 != ""
  ${OrIf} $StickyStartupBeforeInstall != ""
    ClearErrors
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Sticky Note" '$\"$INSTDIR\${MAINBINARYNAME}.exe$\"'
    ${If} ${Errors}
      IfSilent +2 0
        MessageBox MB_OK|MB_ICONEXCLAMATION "$(StickyStartupWriteFailed)"
      SetErrorLevel 2
      Quit
    ${EndIf}
  ${EndIf}
  ; Flush Windows Shell IconCache (Explorer, Taskbar, Command Palette) on install/upgrade.
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro STICKY_REMOVE_OWN_STARTUP
  ; Uninstalling an old install must not remove a deliberately enabled portable path.
  ReadRegStr $R0 HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Sticky Note"
  ${If} $R0 == '$\"$INSTDIR\${MAINBINARYNAME}.exe$\"'
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Sticky Note"
  ${EndIf}
!macroend

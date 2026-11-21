; The installer's own steps (electron-builder includes this file in the installer and its uninstaller; electron-builder.yml's
; nsis.include). The owner's of 10-28: an install over a running Filament asks it to quit first, as the tray's Quit does —
; Filament stops its server, and while a turn runs it asks the person, never cut unasked — and waits up to a minute for it
; to be gone. Only one still running after that meets electron-builder's own step: its box ("Filament is running. Click
; OK to close it."), which closes it by force, or Cancel, which leaves the installer.

; electron-builder includes these with its own check alone, which this one replaces.
!include "getProcessInfo.nsh"
Var pid

!macro customCheckAppRunning
  !insertmacro IS_POWERSHELL_AVAILABLE
  !insertmacro FIND_PROCESS "${APP_EXECUTABLE_FILENAME}" $R0
  ${if} $R0 == 0
    DetailPrint `Asking ${PRODUCT_NAME} to quit.`
    ; A second launch with --quit tells the first to quit and ends at once; with none holding its lock, it does nothing.
    nsExec::Exec `"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --quit`
    Pop $R0
    System::Call "kernel32::GetTickCount()i.R2"
    ${Do}
      Sleep 500
      !insertmacro FIND_PROCESS "${APP_EXECUTABLE_FILENAME}" $R0
      ${if} $R0 != 0
        ${ExitDo}
      ${endIf}
      System::Call "kernel32::GetTickCount()i.R3"
      IntOp $R3 $R3 - $R2
      ${if} $R3 >= 60000
        ${ExitDo}
      ${endIf}
    ${Loop}
  ${endIf}
  !insertmacro _CHECK_APP_RUNNING
!macroend

; The command line (the owner's of 11-05: "a full Filament CLI"): the app's bin folder — filament.cmd and Git Bash's
; filament, electron-builder.yml's extraFiles — on the person's own PATH (HKCU, no administrator), kept as it was
; written (its %VARIABLES% unexpanded) and named once; Windows is told the environment changed, so a terminal opened after
; finds it. The uninstall takes it away again — but not the uninstall an update runs before it installs.
!macro customInstall
  ; The folder goes to PowerShell in the environment, never inside its words: a ' in the install's path would end them.
  System::Call 'Kernel32::SetEnvironmentVariable(t "FILAMENT_BIN", t "$INSTDIR\bin")i'
  nsExec::Exec `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$$d = $$env:FILAMENT_BIN; $$k = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment'); $$p = [string]$$k.GetValue('Path', '', 'DoNotExpandEnvironmentNames'); $$k.SetValue('Path', ((@($$p -split ';' | Where-Object { $$_ -and $$_ -ne $$d }) + $$d) -join ';'), 'ExpandString'); $$k.Close()"`
  Pop $R0
  ; HWND_BROADCAST, WM_SETTINGCHANGE
  SendMessage 0xFFFF 0x1A 0 "STR:Environment" /TIMEOUT=500
  ; The app's id on its shortcuts (electron-builder.yml appId, which main.js sets as the app's): an install over one keeps
  ; the shortcuts that stand and stamps only those it makes or moves, so a shortcut, or the taskbar's pin, that carries
  ; another id would open the app as a button of its own beside the pin. Each is stamped with this id where it is there.
  ${if} ${FileExists} "$newStartMenuLink"
    WinShell::SetLnkAUMI "$newStartMenuLink" "${APP_ID}"
  ${endIf}
  ${if} ${FileExists} "$newDesktopLink"
    WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
  ${endIf}
  ${if} ${FileExists} "$APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\${SHORTCUT_NAME}.lnk"
    WinShell::SetLnkAUMI "$APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\${SHORTCUT_NAME}.lnk" "${APP_ID}"
  ${endIf}
!macroend

!macro customUnInstall
  ${ifNot} ${isUpdated}
    System::Call 'Kernel32::SetEnvironmentVariable(t "FILAMENT_BIN", t "$INSTDIR\bin")i'
    nsExec::Exec `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$$d = $$env:FILAMENT_BIN; $$k = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment'); $$p = [string]$$k.GetValue('Path', '', 'DoNotExpandEnvironmentNames'); $$k.SetValue('Path', (@($$p -split ';' | Where-Object { $$_ -and $$_ -ne $$d }) -join ';'), 'ExpandString'); $$k.Close()"`
    Pop $R0
    SendMessage 0xFFFF 0x1A 0 "STR:Environment" /TIMEOUT=500
  ${endIf}
!macroend

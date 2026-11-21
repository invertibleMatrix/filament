@echo off
rem Filament's command line, for cmd and PowerShell (electron-builder.yml's extraFiles puts it in the app's bin folder,
rem and the installer puts that folder on the person's PATH): the app's own Electron, run as Node, runs bin\filament.js.
setlocal
set ELECTRON_RUN_AS_NODE=1
"%~dp0..\Filament.exe" "%~dp0..\resources\app\bin\filament.js" %*
exit /b %ERRORLEVEL%

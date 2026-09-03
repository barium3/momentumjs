@echo off
setlocal

set "momentum_temp_dir=%TEMP%\momentum-uninstall-%RANDOM%-%RANDOM%"
mkdir "%momentum_temp_dir%" >nul 2>&1
copy /Y "%~dp0uninstall-windows.ps1" "%momentum_temp_dir%\uninstall-windows.ps1" >nul
if errorlevel 1 (
  copy /Y "%~dp0scripts\uninstall-windows.ps1" "%momentum_temp_dir%\uninstall-windows.ps1" >nul
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%momentum_temp_dir%\uninstall-windows.ps1" -AutoElevate %*
set "momentum_exit_code=%ERRORLEVEL%"
rmdir /S /Q "%momentum_temp_dir%" >nul 2>&1

if not "%momentum_exit_code%"=="0" (
  echo.
  echo Momentum removal failed with exit code %momentum_exit_code%.
  pause
)
exit /b %momentum_exit_code%

@echo off
setlocal

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-windows.ps1" -AutoElevate %*
set "momentum_exit_code=%ERRORLEVEL%"

if not "%momentum_exit_code%"=="0" (
  echo.
  echo Momentum installation failed with exit code %momentum_exit_code%.
  pause
)
exit /b %momentum_exit_code%

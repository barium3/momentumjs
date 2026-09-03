[CmdletBinding()]
param(
  [string]$PluginDirectory =
    'C:\Program Files\Adobe\Common\Plug-ins\7.0\MediaCore\Momentum',

  [string]$CepDirectory =
    (Join-Path $env:APPDATA 'Adobe\CEP\extensions\momentumjs'),

  [string]$RuntimeDirectory =
    (Join-Path $env:LOCALAPPDATA 'Momentum\runtime'),

  [string]$UninstallerDirectory =
    (Join-Path $env:LOCALAPPDATA 'Momentum\uninstall'),

  [switch]$RemoveUserData,

  [Parameter(DontShow = $true)]
  [switch]$AutoElevate,

  [Parameter(DontShow = $true)]
  [switch]$Elevated
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Test-Administrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  return $principal.IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator
  )
}

function Invoke-ElevatedUninstaller {
  $scriptArgument = '"' + $PSCommandPath + '"'
  $arguments = @(
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', $scriptArgument,
    '-Elevated'
  )
  if ($RemoveUserData) {
    $arguments += '-RemoveUserData'
  }
  $process = Start-Process `
    -FilePath 'powershell.exe' `
    -Verb RunAs `
    -ArgumentList $arguments `
    -Wait `
    -PassThru
  exit $process.ExitCode
}

if (!(Test-Administrator)) {
  if ($AutoElevate -and !$Elevated) {
    Invoke-ElevatedUninstaller
  }
  throw (
    'Momentum removes its native effect from Program Files. ' +
    'Run this script from an elevated PowerShell session or use uninstall.cmd.'
  )
}

if (Get-Process AfterFX -ErrorAction SilentlyContinue) {
  throw 'After Effects is running. Close it before removing Momentum.'
}

if (Test-Path $CepDirectory) {
  $userDirectory = Join-Path $CepDirectory 'user'
  if ($RemoveUserData -or !(Test-Path $userDirectory)) {
    Remove-Item -Recurse -Force $CepDirectory
    Write-Host "Removed: $CepDirectory"
  } else {
    Get-ChildItem -Force $CepDirectory | Where-Object {
      $_.Name -ne 'user'
    } | Remove-Item -Recurse -Force
    Write-Host "Preserved user workspace: $userDirectory"
  }
}

if (Test-Path $UninstallerDirectory) {
  Remove-Item -Recurse -Force $UninstallerDirectory
  Write-Host "Removed: $UninstallerDirectory"
}

if (Test-Path $PluginDirectory) {
  Remove-Item -Recurse -Force $PluginDirectory
  Write-Host "Removed: $PluginDirectory"
}
if (Test-Path $RuntimeDirectory) {
  Remove-Item -Recurse -Force $RuntimeDirectory
  Write-Host "Removed: $RuntimeDirectory"
}

Write-Host 'Momentum for Windows removed.'
Write-Host (
  'Unsigned CEP mode was left unchanged because other extensions may use it.'
)

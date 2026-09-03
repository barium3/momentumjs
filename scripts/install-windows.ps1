[CmdletBinding()]
param(
  [ValidateSet('Debug', 'Release')]
  [string]$Configuration = 'Release',

  [string]$ArtifactDirectory = '',

  [string]$PluginDirectory =
    'C:\Program Files\Adobe\Common\Plug-ins\7.0\MediaCore\Momentum',

  [string]$CepDirectory =
    (Join-Path $env:APPDATA 'Adobe\CEP\extensions\momentumjs'),

  [string]$RuntimeDirectory =
    (Join-Path $env:LOCALAPPDATA 'Momentum\runtime'),

  [ValidateRange(6, 20)]
  [int[]]$CepMajorVersions = @(6, 7, 8, 9, 10, 11, 12, 13, 14, 15),

  [switch]$SkipCepDebugMode,

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

function Invoke-ElevatedInstaller {
  $scriptArgument = '"' + $PSCommandPath + '"'
  $arguments = @(
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', $scriptArgument,
    '-Elevated'
  )
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
    Invoke-ElevatedInstaller
  }
  throw (
    'Momentum installs its native effect under Program Files. ' +
    'Run this script from an elevated PowerShell session or use install.cmd.'
  )
}

$rootDirectory = Split-Path -Parent $PSScriptRoot
$releaseExtensionDirectory = Join-Path $rootDirectory 'extension'
if (Test-Path (Join-Path $releaseExtensionDirectory 'CSXS\manifest.xml')) {
  $extensionDirectory = $releaseExtensionDirectory
} else {
  $extensionDirectory = $rootDirectory
}

if ([string]::IsNullOrWhiteSpace($ArtifactDirectory)) {
  $releaseArtifactDirectory = Join-Path $rootDirectory 'native\windows'
  $sourceArtifactDirectory = Join-Path `
    $rootDirectory "build-windows-static\$Configuration"
  if (Test-Path (Join-Path $releaseArtifactDirectory 'Momentum.aex')) {
    $ArtifactDirectory = $releaseArtifactDirectory
  } else {
    $ArtifactDirectory = $sourceArtifactDirectory
  }
}

$pluginSource = Join-Path $ArtifactDirectory 'Momentum.aex'
if (Get-Process AfterFX -ErrorAction SilentlyContinue) {
  throw 'After Effects is running. Close it before installing Momentum.'
}
if (!(Test-Path $pluginSource)) {
  throw "Missing plugin artifact: $pluginSource"
}
if (!(Test-Path (Join-Path $extensionDirectory 'CSXS\manifest.xml'))) {
  throw "Missing CEP extension payload: $extensionDirectory"
}

function Copy-DirectoryContents {
  param(
    [Parameter(Mandatory = $true)][string]$Source,
    [Parameter(Mandatory = $true)][string]$Destination
  )

  if (!(Test-Path $Source)) {
    throw "Missing extension directory: $Source"
  }
  New-Item -ItemType Directory -Force -Path $Destination | Out-Null
  Get-ChildItem -Force $Source | ForEach-Object {
    Copy-Item -Force -Recurse -Path $_.FullName -Destination $Destination
  }
}

New-Item -ItemType Directory -Force -Path $PluginDirectory | Out-Null
New-Item -ItemType Directory -Force -Path $RuntimeDirectory | Out-Null
Copy-Item -Force $pluginSource (Join-Path $PluginDirectory 'Momentum.aex')

$installedPlugin = Join-Path $PluginDirectory 'Momentum.aex'
$sourceHash = (Get-FileHash -Algorithm SHA256 $pluginSource).Hash
$installedHash = (Get-FileHash -Algorithm SHA256 $installedPlugin).Hash
if ($sourceHash -ne $installedHash) {
  throw "Installed plug-in verification failed: $installedPlugin"
}

$artifactDlls = @(Get-ChildItem $ArtifactDirectory -File -Filter '*.dll')
$artifactDllNames = @($artifactDlls | ForEach-Object { $_.Name })
$artifactDlls | ForEach-Object {
  Copy-Item -Force $_.FullName (Join-Path $PluginDirectory $_.Name)
}
Get-ChildItem $PluginDirectory -File -Filter '*.dll' | Where-Object {
  $artifactDllNames -notcontains $_.Name
} | ForEach-Object {
  Write-Host "Removing stale plugin dependency: $($_.Name)"
  Remove-Item -Force $_.FullName
}

$obsoletePluginRuntime = Join-Path $PluginDirectory 'runtime'
if (Test-Path $obsoletePluginRuntime) {
  Remove-Item -Recurse -Force $obsoletePluginRuntime
  Write-Host "Removed obsolete plugin runtime: $obsoletePluginRuntime"
}

New-Item -ItemType Directory -Force -Path $CepDirectory | Out-Null
foreach ($directoryName in @('bundle', 'CSXS', 'footage', 'js', 'jsx')) {
  $destination = Join-Path $CepDirectory $directoryName
  if (Test-Path $destination) {
    Remove-Item -Recurse -Force $destination
  }
  Copy-DirectoryContents `
    -Source (Join-Path $extensionDirectory $directoryName) `
    -Destination $destination
}
foreach ($fileName in @('index.html', 'styles.css')) {
  $source = Join-Path $extensionDirectory $fileName
  if (!(Test-Path $source)) {
    throw "Missing extension file: $source"
  }
  Copy-Item -Force $source (Join-Path $CepDirectory $fileName)
}

$userSource = Join-Path $extensionDirectory 'user'
$userDestination = Join-Path $CepDirectory 'user'
New-Item -ItemType Directory -Force -Path $userDestination | Out-Null
if (Test-Path $userSource) {
  Get-ChildItem $userSource -Recurse -File | ForEach-Object {
    $relativePath = $_.FullName.Substring($userSource.Length).TrimStart('\')
    $destinationPath = Join-Path $userDestination $relativePath
    if (!(Test-Path $destinationPath)) {
      New-Item -ItemType Directory -Force -Path `
        (Split-Path -Parent $destinationPath) | Out-Null
      Copy-Item $_.FullName $destinationPath
    }
  }
}

if (!$SkipCepDebugMode) {
  foreach ($version in ($CepMajorVersions | Sort-Object -Unique)) {
    $debugKey = "HKCU:\Software\Adobe\CSXS.$version"
    New-Item -Force -Path $debugKey | Out-Null
    New-ItemProperty `
      -Path $debugKey `
      -Name 'PlayerDebugMode' `
      -PropertyType String `
      -Value '1' `
      -Force | Out-Null
  }
}

Write-Host 'Momentum for Windows installed.'
Write-Host "Plugin: $installedPlugin"
Write-Host "Runtime: $RuntimeDirectory"
Write-Host "CEP extension: $CepDirectory"
if ($SkipCepDebugMode) {
  Write-Host 'Unsigned CEP mode was not changed.'
} else {
  Write-Host "Unsigned CEP mode enabled for CSXS versions: $CepMajorVersions"
}
Write-Host 'Restart After Effects before testing.'

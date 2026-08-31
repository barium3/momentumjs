[CmdletBinding()]
param(
  [ValidateSet('Debug', 'Release')]
  [string]$Configuration = 'Release',

  [string]$PluginDirectory =
    'C:\Program Files\Adobe\Common\Plug-ins\7.0\MediaCore\Momentum',

  [string]$CepDirectory =
    (Join-Path $env:APPDATA 'Adobe\CEP\extensions\momentumjs'),

  [switch]$EnableCepDebugMode,

  [ValidateRange(6, 20)]
  [int]$CepMajorVersion = 11
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$rootDirectory = Split-Path -Parent $PSScriptRoot
$artifactDirectory = Join-Path `
  $rootDirectory "build-windows-static-md\$Configuration"
$pluginSource = Join-Path $artifactDirectory 'Momentum.aex'
$runtimeDirectory = Join-Path $env:LOCALAPPDATA 'Momentum\runtime'

if (Get-Process AfterFX -ErrorAction SilentlyContinue) {
  throw 'After Effects is running. Close it before installing Momentum.'
}
if (!(Test-Path $pluginSource)) {
  throw "Missing plugin artifact: $pluginSource"
}
if (!(Test-Path (Join-Path $rootDirectory 'CSXS\manifest.xml'))) {
  throw "The repository does not contain a CEP manifest: $rootDirectory"
}

function Copy-DirectoryContents {
  param(
    [Parameter(Mandatory = $true)][string]$Source,
    [Parameter(Mandatory = $true)][string]$Destination
  )

  if (!(Test-Path $Source)) {
    return
  }
  New-Item -ItemType Directory -Force -Path $Destination | Out-Null
  Get-ChildItem -Force $Source | ForEach-Object {
    Copy-Item -Force -Recurse -Path $_.FullName -Destination $Destination
  }
}

New-Item -ItemType Directory -Force -Path $PluginDirectory | Out-Null
New-Item -ItemType Directory -Force -Path $runtimeDirectory | Out-Null
Copy-Item -Force $pluginSource (Join-Path $PluginDirectory 'Momentum.aex')
$artifactDlls = @(
  Get-ChildItem $artifactDirectory -File -Filter '*.dll'
)
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

New-Item -ItemType Directory -Force -Path $CepDirectory | Out-Null
foreach ($directoryName in @('bundle', 'CSXS', 'footage', 'js', 'jsx')) {
  Copy-DirectoryContents `
    -Source (Join-Path $rootDirectory $directoryName) `
    -Destination (Join-Path $CepDirectory $directoryName)
}
foreach ($fileName in @('index.html', 'styles.css')) {
  Copy-Item -Force `
    (Join-Path $rootDirectory $fileName) `
    (Join-Path $CepDirectory $fileName)
}

$userSource = Join-Path $rootDirectory 'user'
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

if ($EnableCepDebugMode) {
  $debugKey = "HKCU:\Software\Adobe\CSXS.$CepMajorVersion"
  New-Item -Force -Path $debugKey | Out-Null
  New-ItemProperty `
    -Path $debugKey `
    -Name 'PlayerDebugMode' `
    -PropertyType String `
    -Value '1' `
    -Force | Out-Null
}

Write-Host 'Momentum for Windows installed.'
Write-Host "Plugin: $PluginDirectory\Momentum.aex"
Write-Host "Runtime: $runtimeDirectory"
Write-Host "CEP extension: $CepDirectory"
if (!$EnableCepDebugMode) {
  Write-Host 'CEP debug mode was not changed.'
}
Write-Host 'Restart After Effects before testing.'

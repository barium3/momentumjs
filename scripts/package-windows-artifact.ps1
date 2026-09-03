[CmdletBinding()]
param(
  [ValidateSet('Debug', 'Release')]
  [string]$Configuration = 'Release',

  [string]$OutputDirectory = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$rootDirectory = Split-Path -Parent $PSScriptRoot
$artifactDirectory = Join-Path `
  $rootDirectory "build-windows-static\$Configuration"
$pluginSource = Join-Path $artifactDirectory 'Momentum.aex'

if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
  $OutputDirectory = Join-Path $rootDirectory "dist\windows\$Configuration"
}
if (!(Test-Path $pluginSource)) {
  throw "Missing Windows plug-in artifact: $pluginSource"
}

if (Test-Path $OutputDirectory) {
  Remove-Item -Recurse -Force $OutputDirectory
}
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null

Copy-Item -Force $pluginSource (Join-Path $OutputDirectory 'Momentum.aex')
Get-ChildItem $artifactDirectory -File -Filter '*.dll' | ForEach-Object {
  Copy-Item -Force $_.FullName (Join-Path $OutputDirectory $_.Name)
}

$stagedPlugin = Join-Path $OutputDirectory 'Momentum.aex'
$pluginHash = (Get-FileHash -Algorithm SHA256 $stagedPlugin).Hash.ToLowerInvariant()
$buildInfo = @(
  'Momentum Windows Artifact',
  '',
  "Configuration: $Configuration",
  'Architecture: Windows x86-64',
  "Created: $([DateTime]::Now.ToString('s'))",
  "SHA-256: $pluginHash"
)
Set-Content `
  -Path (Join-Path $OutputDirectory 'BUILD-INFO.txt') `
  -Value $buildInfo `
  -Encoding Ascii

Write-Host "Windows release artifact staged at: $OutputDirectory"

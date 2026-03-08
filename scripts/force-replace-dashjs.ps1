param(
  [Parameter(Mandatory=$true)]
  [string]$SourcePath,
  [string]$TargetPath = 'frontend\dash.js'
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $SourcePath)) {
  throw "SourcePath not found: $SourcePath"
}
if (-not (Test-Path -LiteralPath $TargetPath)) {
  throw "TargetPath not found: $TargetPath"
}

$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$backupPath = "$TargetPath.bak_$stamp"

Copy-Item -LiteralPath $TargetPath -Destination $backupPath -Force
Copy-Item -LiteralPath $SourcePath -Destination $TargetPath -Force

$srcHash = (Get-FileHash -Algorithm SHA1 -LiteralPath $SourcePath).Hash
$dstHash = (Get-FileHash -Algorithm SHA1 -LiteralPath $TargetPath).Hash

Write-Output "Backup: $backupPath"
Write-Output "Source SHA1: $srcHash"
Write-Output "Target SHA1: $dstHash"
Write-Output ("Applied=" + ($srcHash -eq $dstHash))

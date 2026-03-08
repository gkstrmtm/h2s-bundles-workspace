param([Parameter(Mandatory=$true)][string]$Url)
$ErrorActionPreference='Stop'
(Invoke-WebRequest -UseBasicParsing -Uri $Url -Headers @{ 'Cache-Control'='no-cache' }).Content | Write-Output

param([Parameter(Mandatory=$true)][string]$Url,[int]$Chars=240)
$ErrorActionPreference='Stop'
$t=(Invoke-WebRequest -UseBasicParsing -Uri $Url -Headers @{ 'Cache-Control'='no-cache' }).Content
if($t.Length -gt $Chars){ $t.Substring(0,$Chars) } else { $t }

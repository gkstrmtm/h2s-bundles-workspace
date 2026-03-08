param([string]$LocalPath = '.\frontend\dash.js', [string]$RemoteUrl = 'https://portal.home2smart.com/dash.js')

$ErrorActionPreference = 'Stop'

function Get-Sha256Text([string]$text) {
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($text)
  $sha = [System.Security.Cryptography.SHA256]::Create()
  ($sha.ComputeHash($bytes) | ForEach-Object { $_.ToString('x2') }) -join ''
}

$localText = Get-Content -Raw -Path $LocalPath
$localHash = Get-Sha256Text $localText

$remote = Invoke-WebRequest -UseBasicParsing -Uri $RemoteUrl -Headers @{ 'Cache-Control' = 'no-cache' }
$remoteText = $remote.Content
$remoteHash = Get-Sha256Text $remoteText

[pscustomobject]@{
  localPath = (Resolve-Path $LocalPath).Path
  localLength = $localText.Length
  localSha256 = $localHash
  remoteUrl = $RemoteUrl
  remoteLength = $remoteText.Length
  remoteSha256 = $remoteHash
  same = ($localHash -eq $remoteHash)
  cache_control = ($remote.Headers['cache-control'] -join ',')
  x_vercel_cache = ($remote.Headers['x-vercel-cache'] -join ',')
  x_vercel_id = ($remote.Headers['x-vercel-id'] -join ',')
} | Format-List | Out-String | Write-Output

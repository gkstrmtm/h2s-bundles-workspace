param(
  [string]$Path = 'frontend\dash.js',
  [int]$IntervalMs = 1000,
  [int]$MaxMinutes = 15,
  [string]$LogPath = '_tmp_dashjs_poll_monitor.log',
  [switch]$CaptureProcesses,
  [string]$ProcessCommandLineRegex = 'dash\\.js|frontend\\\\dash\\.js|force-patch-dashjs|touch-frontend-assets\\.ps1|deploy-frontend|audit-bundles|apply-patch|bundles|vercel'
)

$ErrorActionPreference = 'Stop'

function Get-Snapshot {
  param([string]$FullPath)

  if (-not (Test-Path -LiteralPath $FullPath)) {
    return [pscustomobject]@{
      Missing       = $true
      TimeUtc       = (Get-Date).ToUniversalTime().ToString('o')
      FullPath      = $FullPath
      Length        = $null
      LastWriteUtc  = $null
      Sha1          = $null
    }
  }

  $item = Get-Item -LiteralPath $FullPath -ErrorAction Stop
  $sha1 = (Get-FileHash -Algorithm SHA1 -LiteralPath $FullPath -ErrorAction Stop).Hash

  return [pscustomobject]@{
    Missing       = $false
    TimeUtc       = (Get-Date).ToUniversalTime().ToString('o')
    FullPath      = $FullPath
    Length        = $item.Length
    LastWriteUtc  = $item.LastWriteTimeUtc.ToString('o')
    Sha1          = $sha1
  }
}

$fullPath = (Resolve-Path -LiteralPath $Path).Path
$logFullPath = Join-Path (Get-Location).Path $LogPath

"--- monitor-dashjs-poll start $(Get-Date -Format o) ---" | Tee-Object -FilePath $logFullPath -Append
"Target=$fullPath" | Tee-Object -FilePath $logFullPath -Append
"IntervalMs=$IntervalMs MaxMinutes=$MaxMinutes" | Tee-Object -FilePath $logFullPath -Append
"Log=$logFullPath" | Tee-Object -FilePath $logFullPath -Append

$end = (Get-Date).AddMinutes($MaxMinutes)
$prev = Get-Snapshot -FullPath $fullPath
("Initial=" + ($prev | ConvertTo-Json -Compress)) | Tee-Object -FilePath $logFullPath -Append

while ((Get-Date) -lt $end) {
  Start-Sleep -Milliseconds $IntervalMs

  $cur = Get-Snapshot -FullPath $fullPath

  $changed = $false
  if ($cur.Missing -ne $prev.Missing) { $changed = $true }
  elseif ($cur.LastWriteUtc -ne $prev.LastWriteUtc) { $changed = $true }
  elseif ($cur.Length -ne $prev.Length) { $changed = $true }
  elseif ($cur.Sha1 -ne $prev.Sha1) { $changed = $true }

  if ($changed) {
    ("CHANGE=" + ($cur | ConvertTo-Json -Compress)) | Tee-Object -FilePath $logFullPath -Append

    if ($CaptureProcesses) {
      try {
        $procs = Get-CimInstance Win32_Process -ErrorAction Stop |
          Where-Object { $_.CommandLine -match $ProcessCommandLineRegex } |
          Select-Object ProcessId, Name, CommandLine

        $payload = @{
          TimeUtc = (Get-Date).ToUniversalTime().ToString('o')
          Regex   = $ProcessCommandLineRegex
          Count   = @($procs).Count
          Procs   = @($procs)
        } | ConvertTo-Json -Compress

        ("PROCS=" + $payload) | Tee-Object -FilePath $logFullPath -Append
      }
      catch {
        ("PROCS_ERROR=" + $_.Exception.Message) | Tee-Object -FilePath $logFullPath -Append
      }
    }

    $prev = $cur
  }
}

"--- monitor-dashjs-poll stop $(Get-Date -Format o) ---" | Tee-Object -FilePath $logFullPath -Append

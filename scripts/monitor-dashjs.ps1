param(
    [string]$WorkspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path,
    [string]$RelativePath = 'frontend\dash.js',
    [string]$LogPath = ''
)

$ErrorActionPreference = 'Stop'

$fullPath = Join-Path $WorkspaceRoot $RelativePath
if (-not (Test-Path $fullPath)) {
    throw "File not found: $fullPath"
}

if ([string]::IsNullOrWhiteSpace($LogPath)) {
    $LogPath = Join-Path $WorkspaceRoot '_tmp_dashjs_monitor.log'
}

function Get-FileSnapshot {
    param([string]$Path)

    $item = Get-Item $Path -ErrorAction Stop
    $hash = (Get-FileHash -Algorithm SHA1 -Path $Path -ErrorAction Stop).Hash

    [pscustomobject]@{
        Time          = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss.fff')
        Path          = $Path
        Length        = $item.Length
        LastWriteTime = $item.LastWriteTimeUtc.ToString('o')
        Sha1          = $hash
    }
}

function Write-LogLine {
    param([string]$Line)

    $Line | Tee-Object -FilePath $LogPath -Append
}

Write-LogLine "--- monitor-dashjs start $(Get-Date -Format o) ---"
Write-LogLine "Target=$fullPath"
Write-LogLine "Log=$LogPath"
Write-LogLine "InitialSnapshot=$(Get-FileSnapshot -Path $fullPath | ConvertTo-Json -Compress)"

$dir = Split-Path $fullPath -Parent
$name = Split-Path $fullPath -Leaf

$fsw = New-Object System.IO.FileSystemWatcher
$fsw.Path = $dir
$fsw.Filter = $name
$fsw.IncludeSubdirectories = $false
$fsw.NotifyFilter = [System.IO.NotifyFilters]'FileName, LastWrite, Size, Attributes'
$fsw.EnableRaisingEvents = $true

$handler = {
    $path = $using:fullPath
    $log = $using:LogPath

    function _writeLine {
        param([string]$Line)
        $Line | Tee-Object -FilePath $log -Append
    }

    try {
        $eventTime = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss.fff')
        $kind = $Event.SourceEventArgs.ChangeType

        if (Test-Path $path) {
            $item = Get-Item $path -ErrorAction Stop
            $hash = (Get-FileHash -Algorithm SHA1 -Path $path -ErrorAction Stop).Hash
            $snapshot = [pscustomobject]@{
                Time          = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss.fff')
                Path          = $path
                Length        = $item.Length
                LastWriteTime = $item.LastWriteTimeUtc.ToString('o')
                Sha1          = $hash
            } | ConvertTo-Json -Compress
        }
        else {
            $snapshot = '{"missing":true}'
        }

        _writeLine "[$eventTime] $kind Snapshot=$snapshot"
    }
    catch {
        _writeLine "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss.fff')] handler_error $($_.Exception.Message)"
    }
}

$subs = @()
$subs += Register-ObjectEvent -InputObject $fsw -EventName Changed -Action $handler
$subs += Register-ObjectEvent -InputObject $fsw -EventName Created -Action $handler
$subs += Register-ObjectEvent -InputObject $fsw -EventName Deleted -Action $handler
$subs += Register-ObjectEvent -InputObject $fsw -EventName Renamed -Action $handler

Write-LogLine "Watching... Press Ctrl+C to stop."
try {
    while ($true) {
        Start-Sleep -Seconds 1
    }
}
finally {
    foreach ($s in $subs) {
        try { Unregister-Event -SubscriptionId $s.Id -ErrorAction SilentlyContinue } catch {}
        try { Remove-Job -Id $s.Id -Force -ErrorAction SilentlyContinue } catch {}
    }
    try { $fsw.Dispose() } catch {}
    Write-LogLine "--- monitor-dashjs stop $(Get-Date -Format o) ---"
}

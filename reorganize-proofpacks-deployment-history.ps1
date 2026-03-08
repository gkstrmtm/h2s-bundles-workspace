param(
    [Parameter(Mandatory = $false)]
    [string]$Path = ".\\PROOFPACKS_DEPLOYMENT_HISTORY.md"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $Path)) {
    throw "File not found: $Path"
}

$raw = Get-Content -LiteralPath $Path -Raw

# Normalize newlines for processing, but write back with Windows newlines.
$raw = $raw -replace "`r`n", "`n"
$raw = $raw -replace "`r", "`n"
$lines = $raw -split "`n", -1

$sectionHeaderRegex = '^(##)\s+(.+)$'
$deploymentHeaderRegex = '^###\s+Deployment:\s+([^\s]+)\s+\((\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})\)$'

function Join-Lines([string[]]$arr) {
    return ($arr -join "`r`n")
}

function Reorg-Section([string[]]$sectionLines) {
    $hasDeployment = $false
    foreach ($ln in $sectionLines) {
        if ($ln -match $deploymentHeaderRegex) { $hasDeployment = $true; break }
    }
    if (-not $hasDeployment) {
        return $sectionLines
    }

    $prefix = New-Object System.Collections.Generic.List[string]
    $suffix = New-Object System.Collections.Generic.List[string]
    $blocksByDate = @{}
    $dateOrder = New-Object System.Collections.Generic.List[string]

    $i = 0
    $n = $sectionLines.Count

    # Collect everything before the first deployment header (keeps any explanatory text).
    while ($i -lt $n -and ($sectionLines[$i] -notmatch $deploymentHeaderRegex)) {
        $prefix.Add($sectionLines[$i])
        $i++
    }

    # Parse deployment blocks.
    while ($i -lt $n) {
        if ($sectionLines[$i] -match $deploymentHeaderRegex) {
            $deploymentId = $Matches[1]
            $date = $Matches[2]
            $time = $Matches[3]
            $fullTimestamp = "$date $time"

            $block = New-Object System.Collections.Generic.List[string]
            $block.Add("#### Deployment: $deploymentId ($fullTimestamp)")
            $i++

            while ($i -lt $n -and ($sectionLines[$i] -notmatch $deploymentHeaderRegex)) {
                $block.Add($sectionLines[$i])
                $i++
            }

            if (-not $blocksByDate.ContainsKey($date)) {
                $blocksByDate[$date] = New-Object System.Collections.Generic.List[object]
                $dateOrder.Add($date)
            }
            $blocksByDate[$date].Add($block)
            continue
        }

        # Anything after the last deployment block ends up here (e.g., '---' separators).
        $suffix.Add($sectionLines[$i])
        $i++
    }

    $out = New-Object System.Collections.Generic.List[string]
    $out.AddRange($prefix)

    foreach ($d in $dateOrder) {
        # Ensure spacing between groups is stable.
        if ($out.Count -gt 0 -and $out[$out.Count - 1] -ne "") {
            $out.Add("")
        }
        $out.Add("### $d")
        $out.Add("")

        foreach ($blkObj in $blocksByDate[$d]) {
            $blk = [System.Collections.Generic.List[string]]$blkObj
            $out.AddRange($blk)

            # Ensure a blank line after each deployment block for readability.
            if ($out.Count -gt 0 -and $out[$out.Count - 1] -ne "") {
                $out.Add("")
            }
        }
    }

    # Avoid accumulating extra blank lines before suffix.
    while ($out.Count -gt 0 -and $out[$out.Count - 1] -eq "") {
        $out.RemoveAt($out.Count - 1)
    }
    if ($suffix.Count -gt 0) {
        if ($out.Count -gt 0 -and $out[$out.Count - 1] -ne "") {
            $out.Add("")
        }
        $out.AddRange($suffix)
    }

    return $out.ToArray()
}

$result = New-Object System.Collections.Generic.List[string]

$currentSection = New-Object System.Collections.Generic.List[string]
$inSection = $false

for ($idx = 0; $idx -lt $lines.Count; $idx++) {
    $line = $lines[$idx]

    if ($line -match $sectionHeaderRegex) {
        # Flush previous section if we were in one.
        if ($inSection) {
            $reorged = Reorg-Section -sectionLines $currentSection.ToArray()
            $result.AddRange($reorged)
            $currentSection.Clear()
        }
        $inSection = $true
        $currentSection.Add($line)
        continue
    }

    if ($inSection) {
        $currentSection.Add($line)
    }
    else {
        $result.Add($line)
    }
}

if ($inSection) {
    $reorged = Reorg-Section -sectionLines $currentSection.ToArray()
    $result.AddRange($reorged)
}

$finalText = Join-Lines $result.ToArray()

# Write back as UTF-8 (no BOM) with stable newlines.
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText((Resolve-Path -LiteralPath $Path), $finalText, $utf8NoBom)

Write-Host "Reorganized date groupings in: $Path"

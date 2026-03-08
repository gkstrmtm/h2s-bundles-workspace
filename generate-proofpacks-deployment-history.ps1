param(
  [string]$OutputPath,
  [string]$InputGlob,
  [int]$MaxDeployments = 120,
  [int]$InspectTimeoutSec = 25
)

$ErrorActionPreference = 'Stop'

$vercelCmd = Get-Command vercel -ErrorAction SilentlyContinue
if (-not $vercelCmd) {
  throw "vercel CLI not found on PATH. Install Vercel CLI or open a shell where `vercel` works."
}

if (-not $OutputPath) {
  $OutputPath = Join-Path -Path $PSScriptRoot -ChildPath 'PROOFPACKS_DEPLOYMENT_HISTORY.md'
} elseif (-not [System.IO.Path]::IsPathRooted($OutputPath)) {
  $OutputPath = Join-Path -Path $PSScriptRoot -ChildPath $OutputPath
}

if (-not $InputGlob) {
  $InputGlob = Join-Path -Path $PSScriptRoot -ChildPath '_vercel_deployments_page*.txt'
} elseif (-not [System.IO.Path]::IsPathRooted($InputGlob)) {
  $InputGlob = Join-Path -Path $PSScriptRoot -ChildPath $InputGlob
}

$DeploymentUrlRegex = '^https://h2s-bundles-frontend-[a-z0-9]+-tabari-ropers-projects-6f2e090b\.vercel\.app$'

Write-Host ('=== ProofPacks Deployment History Generator ===') -ForegroundColor Cyan
Write-Host ("Start: {0}" -f (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')) -ForegroundColor DarkCyan
Write-Host ("InputGlob: {0}" -f $InputGlob) -ForegroundColor DarkCyan
Write-Host ("OutputPath: {0}" -f $OutputPath) -ForegroundColor DarkCyan
Write-Host ("MaxDeployments: {0}" -f $MaxDeployments) -ForegroundColor DarkCyan
Write-Host ("InspectTimeoutSec: {0}" -f $InspectTimeoutSec) -ForegroundColor DarkCyan
Write-Host ''

function Invoke-CmdTextWithTimeout {
  param(
    [Parameter(Mandatory=$true)][string]$CmdLine,
    [Parameter(Mandatory=$true)][int]$TimeoutSec
  )

  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = 'cmd.exe'
  $psi.Arguments = '/c ' + $CmdLine + ' 2^>^&1'
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true

  $p = New-Object System.Diagnostics.Process
  $p.StartInfo = $psi

  $null = $p.Start()
  if (-not $p.WaitForExit([Math]::Max(1, $TimeoutSec) * 1000)) {
    try { $p.Kill() } catch {}
    throw "Command timed out after ${TimeoutSec}s: $CmdLine"
  }

  $stdout = $p.StandardOutput.ReadToEnd()
  $stderr = $p.StandardError.ReadToEnd()
  return ($stdout + "`n" + $stderr)
}

function Convert-BytesToSizeString {
  param([Nullable[long]]$Bytes)
  if (-not $Bytes -or $Bytes -le 0) { return $null }

  $kb = $Bytes / 1024.0
  if ($kb -lt 1024) { return ("{0:N1} KB" -f $kb) }
  $mb = $kb / 1024.0
  return ("{0:N2} MB" -f $mb)
}

function Try-ParseVercelCreated {
  param(
    [Parameter(Mandatory = $true)][string]$CreatedText
  )

  # Expected examples:
  # "Sun Feb 22 2026 00:14:26 GMT-0500 (Eastern Standard Time)"
  # We parse the core: "Sun Feb 22 2026 00:14:26 GMT-0500" and ignore the rest.
  $t = ''
  if ($null -ne $CreatedText) { $t = $CreatedText.Trim() }
  if (-not $t) { return $null }

  if ($t -match '^([A-Za-z]{3})\s+([A-Za-z]{3})\s+(\d{1,2})\s+(\d{4})\s+(\d{2}):(\d{2}):(\d{2})\s+GMT([+-])(\d{2})(\d{2})') {
    $monthMap = @{
      Jan = 1; Feb = 2; Mar = 3; Apr = 4; May = 5; Jun = 6;
      Jul = 7; Aug = 8; Sep = 9; Oct = 10; Nov = 11; Dec = 12
    }

    $monAbbrev = $matches[2]
    if (-not $monthMap.ContainsKey($monAbbrev)) { return $null }

    $day = [int]$matches[3]
    $year = [int]$matches[4]
    $hour = [int]$matches[5]
    $minute = [int]$matches[6]
    $second = [int]$matches[7]
    $sign = $matches[8]
    $offH = [int]$matches[9]
    $offM = [int]$matches[10]

    $offsetMinutes = ($offH * 60) + $offM
    if ($sign -eq '-') { $offsetMinutes = -1 * $offsetMinutes }
    $offset = [TimeSpan]::FromMinutes($offsetMinutes)

    try {
      $dto = New-Object System.DateTimeOffset($year, $monthMap[$monAbbrev], $day, $hour, $minute, $second, $offset)
      return $dto.LocalDateTime
    } catch {
      return $null
    }
  }

  return $null
}

function Get-ContentLengthBytes {
  param(
    [Parameter(Mandatory=$true)][string]$Url
  )

  $candidates = @(
    "$Url/dash.html",
    "$Url/dash"
  )

  foreach ($candidate in $candidates) {
    try {
      $resp = Invoke-WebRequest -Method Head -Uri $candidate -MaximumRedirection 3 -TimeoutSec 20 -UseBasicParsing -ErrorAction Stop
      $len = $resp.Headers['Content-Length']
      if ($len) {
        [long]$bytes = 0
        if ([long]::TryParse(($len | Select-Object -First 1), [ref]$bytes) -and $bytes -gt 0) {
          return $bytes
        }
      }
    } catch {
      # ignore and try next
    }
  }

  return $null
}

function Parse-VercelInspect {
  param(
    [Parameter(Mandatory=$true)][string]$DeploymentUrl
  )

  $text = ''
  $inspectError = $null
  try {
    # In Windows PowerShell 5.1, native stderr becomes ErrorRecord objects.
    # Run via cmd.exe so `2>&1` yields plain text we can regex-parse.
    $cmdLine = 'vercel inspect "' + $DeploymentUrl + '" --no-color'
    $text = Invoke-CmdTextWithTimeout -CmdLine $cmdLine -TimeoutSec $InspectTimeoutSec
  } catch {
    $text = ''
    $inspectError = $_.Exception.Message
  }

  $vercelId = $null
  $target = $null
  $status = $null
  $created = $null

  foreach ($line in ($text -split "`r?`n")) {
    if (-not $vercelId -and $line -match '^\s*id\s+(\S+)\s*$') { $vercelId = $matches[1]; continue }
    if (-not $target -and $line -match '^\s*target\s+(\S+)\s*$') { $target = $matches[1]; continue }
    if (-not $status -and $line -match '^\s*status\s+.*\s(\w+)\s*$') { $status = $matches[1]; continue }
    if (-not $created -and $line -match '^\s*created\s+(.+?)\s+\[') {
      $created = Try-ParseVercelCreated -CreatedText $matches[1]
      continue
    }
  }

  if (-not $created) {
    # Fallback: the "url ... created ..." line can wrap, so scan full text
    if ($text -match 'created\s+([A-Za-z]{3}\s+[A-Za-z]{3}\s+\d{1,2}\s+\d{4}\s+\d{2}:\d{2}:\d{2}\s+GMT[+-]\d{4}.*?\))\s+\[') {
      $created = Try-ParseVercelCreated -CreatedText $matches[1]
    }
  }

  [pscustomobject]@{
    deploymentUrl = $DeploymentUrl
    vercelDeploymentId = $vercelId
    target = $target
    status = $status
    created = $created
    inspectError = $inspectError
  }
}

function Get-TimeBucket {
  param([Parameter(Mandatory=$true)][DateTime]$Created)

  $ageDays = ((Get-Date) - $Created).TotalDays

  if ($ageDays -lt 1) { return 'Last 24 Hours (Probably Broken)' }
  if ($ageDays -ge 1 -and $ageDays -lt 7) { return '2-7 Days Ago (Recent Changes)' }
  if ($ageDays -ge 7 -and $ageDays -lt 14) { return '1-2 Weeks Ago (Likely Working Version)' }
  if ($ageDays -ge 14 -and $ageDays -lt 28) { return '2-4 Weeks Ago (Earlier Stable)' }
  if ($ageDays -ge 28 -and $ageDays -lt 60) { return '1-2 Months Ago (Older Baselines)' }
  return 'Older (Not In Prompt Windows)'
}

$inputFiles = Get-ChildItem -Path $InputGlob -ErrorAction SilentlyContinue | Sort-Object Name
if (-not $inputFiles -or $inputFiles.Count -eq 0) {
  throw "No input files found matching: $InputGlob"
}

Write-Host ("Input files found: {0}" -f $inputFiles.Count) -ForegroundColor DarkCyan

$allUrls = @()
$unexpectedUrls = @()
foreach ($file in $inputFiles) {
  $lines = Get-Content -LiteralPath $file.FullName -ErrorAction Stop
  foreach ($line in $lines) {
    $u = ([string]$line).Trim()
    if (-not $u) { continue }
    if ($u.EndsWith('/')) { $u = $u.TrimEnd('/') }
    if ($u -notmatch '^https://') { continue }

    if ($u -match $DeploymentUrlRegex) {
      $allUrls += $u
    } else {
      $unexpectedUrls += $u
    }
  }
}

if ($unexpectedUrls.Count -gt 0) {
  Write-Warning ("Ignoring {0} unexpected URL(s) that don't look like h2s-bundles-frontend deployments. First few examples:`n{1}" -f $unexpectedUrls.Count, (($unexpectedUrls | Select-Object -First 5) -join "`n"))
}

$urls = $allUrls | Select-Object -Unique | Select-Object -First $MaxDeployments

Write-Host ("Candidate deployment URLs (after filtering/unique/max): {0}" -f $urls.Count) -ForegroundColor DarkCyan
if (-not $urls -or $urls.Count -eq 0) {
  throw "No matching deployment URLs found in input files. Expected lines like: https://h2s-bundles-frontend-<id>-tabari-ropers-projects-6f2e090b.vercel.app"
}

$rows = @()
$idx = 0
$inspectErrors = 0
foreach ($url in $urls) {
  $idx++
  Write-Host ("[{0}/{1}] Inspecting {2}" -f $idx, $urls.Count, $url)

  $info = Parse-VercelInspect -DeploymentUrl $url
  if ($info.inspectError) {
    $inspectErrors++
    Write-Warning ("Inspect failed for {0}: {1}" -f $url, $info.inspectError)
  }
  $sizeBytes = Get-ContentLengthBytes -Url $url

  $shortId = $null
  if ($url -match 'h2s-bundles-frontend-([a-z0-9]+)-tabari-ropers-projects-6f2e090b\.vercel\.app') {
    $shortId = $matches[1]
  }

  $created = $info.created
  $createdStr = if ($created) { $created.ToString('yyyy-MM-dd HH:mm:ss') } else { 'unknown' }

  $sizeStr = Convert-BytesToSizeString -Bytes $sizeBytes
  $likelySkeleton = $false
  if ($sizeBytes) {
    # Heuristic: the "skeleton" dash.html tends to be ~200KB.
    $likelySkeleton = ($sizeBytes -ge 180KB -and $sizeBytes -le 280KB)
  }

  $rows += [pscustomobject]@{
    bucket = if ($created) { Get-TimeBucket -Created $created } else { 'Unknown Time' }
    created = $created
    createdStr = $createdStr
    shortId = $shortId
    deploymentUrl = $url
    dashUrl = "$url/dash"
    vercelDeploymentId = $info.vercelDeploymentId
    target = $info.target
    status = $info.status
    sizeBytes = $sizeBytes
    sizeStr = $sizeStr
    likelySkeleton = $likelySkeleton
  }
}

if ($inspectErrors -gt 0) {
  Write-Warning ("Finished with {0} inspect error(s). Output still generated; entries may have 'unknown' created times." -f $inspectErrors)
}

$bucketOrder = @(
  'Last 24 Hours (Probably Broken)',
  '2-7 Days Ago (Recent Changes)',
  '1-2 Weeks Ago (Likely Working Version)',
  '2-4 Weeks Ago (Earlier Stable)',
  '1-2 Months Ago (Older Baselines)',
  'Older (Not In Prompt Windows)',
  'Unknown Time'
)

$groups = $rows |
  Sort-Object -Property created -Descending |
  Group-Object -Property bucket

$groupMap = @{}
foreach ($g in $groups) { $groupMap[$g.Name] = $g.Group }

$md = New-Object System.Collections.Generic.List[string]
$md.Add('# ProofPacks Version History - Click to Test')
$md.Add('')
$md.Add('## How to Use This File')
$md.Add('1. Click a deployment URL below')
$md.Add('2. Navigate to the ProofPacks tab')
$md.Add('3. Test these features:')
$md.Add('   - [ ] Click an asset in library -> Editor opens')
$md.Add('   - [ ] Drag to reposition image')
$md.Add('   - [ ] Click "Save Framing"')
$md.Add('   - [ ] Go to shop.home2smart.com/bundles')
$md.Add('   - [ ] Verify framing matches what you set in editor')
$md.Add('4. If it works perfectly, note the deployment ID')
$md.Add("5. IMPORTANT: Check that OTHER tabs (Jobs, Candidates, etc.) still work in current file - we're keeping those")
$md.Add('')
$md.Add('---')
$md.Add('')
$md.Add('## Quick Reference: What Each File Is For')
$md.Add('')
$md.Add('| File | Purpose | Keep/Replace |')
$md.Add('|------|---------|--------------|')
$md.Add('| **Current dash.html (212KB)** | All tabs EXCEPT ProofPacks are good | KEEP: all non-ProofPacks code |')
$md.Add('| **Old deployment URL** | ProofPacks tab was working here | EXTRACT: ProofPacks tab only |')
$md.Add('| **Final merged dash.html** | Best of both worlds | KEEP other tabs + REPLACE ProofPacks |')
$md.Add('')
$md.Add('---')

foreach ($bucketName in $bucketOrder) {
  if ($bucketName -eq 'Older (Not In Prompt Windows)' -or $bucketName -eq 'Unknown Time') {
    continue
  }

  $md.Add('')
  $md.Add("## $bucketName")
  $md.Add('')

  $items = $null
  if ($groupMap.ContainsKey($bucketName)) { $items = $groupMap[$bucketName] }

  if (-not $items -or $items.Count -eq 0) {
    $md.Add('_No deployments in this range in the captured set._')
    $md.Add('')
    $md.Add('---')
    continue
  }

  $dateGroups = $items |
    Where-Object { $null -ne $_.created } |
    Group-Object -Property { $_.created.Date } |
    Sort-Object { $_.Group[0].created } -Descending

  foreach ($dg in $dateGroups) {
    $day = [DateTime]$dg.Name
    $md.Add("### $($day.ToString('yyyy-MM-dd'))")
    $md.Add('')

    foreach ($d in ($dg.Group | Sort-Object created -Descending)) {
      $idLabel = if ($d.shortId) { $d.shortId } else { $d.deploymentUrl }

      $md.Add("#### Deployment: $idLabel ($($d.createdStr))")
      $md.Add("- **URL**: $($d.dashUrl)")
      if ($d.vercelDeploymentId) { $md.Add("- **Vercel Deployment ID**: $($d.vercelDeploymentId)") }
      if ($d.sizeStr) { $md.Add("- **Size**: $($d.sizeStr)") }

      $statusBits = @()
      if ($d.status) { $statusBits += $d.status }
      if ($d.target) { $statusBits += $d.target }

      $statusLine = if ($statusBits.Count -gt 0) { ($statusBits -join ' / ') } else { 'Unknown' }
      $md.Add("- **Status**: TODO - not yet tested ($statusLine)")

      $note = 'Check if editor opens; test framing + sync to bundles page.'
      if ($d.likelySkeleton) {
        $note = 'Likely 212KB-ish skeleton build (based on dash.html size). Validate ProofPacks editor presence.'
      }

      $md.Add("- **Notes**: $note")
      $md.Add('')
    }
  }

  $md.Add('---')
}

$md.Add('')
$md.Add('## How to Download Correct Version')
$md.Add('')
$md.Add('Once you find the working deployment:')
$md.Add('')
$md.Add('```bash')
$md.Add('# Get the deployment ID from the URL')
$md.Add('# Example: h2s-bundles-frontend-pqr345stu-tabari... -> pqr345stu is the ID')
$md.Add('')
$md.Add('cd c:\\Users\\tabar\\h2s-bundles-workspace\\frontend')
$md.Add('')
$md.Add('# Download the file from that deployment')
$md.Add('vercel inspect <DEPLOYMENT_ID>')
$md.Add('')
$md.Add('# Or manually download from browser:')
$md.Add('# 1. Open working deployment URL')
$md.Add('# 2. Right-click -> View Page Source')
$md.Add('# 3. Save entire HTML to: frontend/dash-WORKING.html')
$md.Add('```')
$md.Add('')
$md.Add('Then compare with current version to see what changed.')
$md.Add('')
$md.Add('---')
$md.Add('')
$md.Add('## File Structure Guide - What Goes Where')
$md.Add('')
$md.Add('### Current File (212KB) Contains:')
$md.Add('```')
$md.Add('dash.html (KEEP THESE PARTS)')
$md.Add('|-- HTML Structure')
$md.Add('|   |-- <div class="pane" id="jobs-pane"> KEEP')
$md.Add('|   |-- <div class="pane" id="candidates-pane"> KEEP')
$md.Add('|   |-- <div class="pane" id="checkout-pane"> KEEP')
$md.Add('|   |-- <div class="pane" id="dispatch-pane"> KEEP')
$md.Add('|   |-- <div class="pane" id="admin-pane"> KEEP')
$md.Add('|   `-- <div class="pane" id="proofpacks-pane"> REPLACE')
$md.Add('|')
$md.Add('|-- JavaScript')
$md.Add('|   |-- const jobsManager = {...} KEEP')
$md.Add('|   |-- const candidateManager = {...} KEEP')
$md.Add('|   |-- const checkoutManager = {...} KEEP')
$md.Add('|   `-- const proofPacks = {...} REPLACE')
$md.Add('|')
$md.Add('`-- CSS')
$md.Add('    |-- .nav-* styles KEEP')
$md.Add('    |-- .pane styles KEEP')
$md.Add('    |-- .card, .btn general styles KEEP')
$md.Add('    `-- .pp-* ProofPacks styles REPLACE')
$md.Add('```')
$md.Add('')
$md.Add('### Working File (from old deployment) - Extract:')
$md.Add('```')
$md.Add('dash-WORKING.html (EXTRACT ONLY PROOFPACKS)')
$md.Add('|-- HTML: ONLY <div id="proofpacks-pane">...</div>')
$md.Add('|-- JavaScript: ONLY const proofPacks = {...}')
$md.Add('`-- CSS: ONLY .pp-* styles')
$md.Add('```')
$md.Add('')
$md.Add('### Final Merged File Structure:')
$md.Add('```')
$md.Add('dash.html (FINAL)')
$md.Add('|-- All other tabs (from current file) KEEP')
$md.Add('|-- ProofPacks tab (from working file) KEEP')
$md.Add('|-- All other JavaScript (from current file) KEEP')
$md.Add('|-- ProofPacks JavaScript (from working file) KEEP')
$md.Add('|-- Global CSS (from current file) KEEP')
$md.Add('`-- ProofPacks CSS (from working file) KEEP')
$md.Add('```')
$md.Add('')
$md.Add('---')
$md.Add('')
$md.Add('## Technical Details - What to Look For')
$md.Add('')
$md.Add('### JavaScript Functions That Must Exist:')
$md.Add('')
$md.Add('```javascript')
$md.Add('// In the working version, these functions should be present:')
$md.Add('proofPacks.beginEditAssetMedia(assetId)')
$md.Add('proofPacks.editAssetFromLive(assetId, placement)')
$md.Add('proofPacks.buildProofMediaStyle(asset)')
$md.Add('proofPacks.refreshLivePreview()')
$md.Add('```')
$md.Add('')
$md.Add('### HTML Elements That Must Exist:')
$md.Add('')
$md.Add('```html')
$md.Add('<!-- Library grid -->')
$md.Add('<div class="pp-library-grid" id="ppAssetsGrid"></div>')
$md.Add('')
$md.Add('<!-- Live preview section -->')
$md.Add('<div id="ppLivePreviewContent"></div>')
$md.Add('')
$md.Add('<!-- Editor modal -->')
$md.Add('<div id="ppLibraryEditor" class="pp-editor-modal is-hidden"></div>')
$md.Add('```')
$md.Add('')
$md.Add('### Click Handlers to Verify:')
$md.Add('')
$md.Add('1. **Library Item Click**:')
$md.Add('   ```html')
$md.Add('   onclick="proofPacks.beginEditAssetMedia(''asset-id'')"')
$md.Add('   ```')
$md.Add('')
$md.Add('2. **Live Preview Click**:')
$md.Add('   ```html')
$md.Add('   onclick="proofPacks.editAssetFromLive(''asset-id'', ''hero'')"')
$md.Add('   ```')
$md.Add('')
$md.Add('3. **Right-Click Context Menu**:')
$md.Add('   ```html')
$md.Add('   oncontextmenu="proofPacks.showLibraryContextMenu(event, ''asset-id''); return false;"')
$md.Add('   ```')
$md.Add('')
$md.Add('### Backend API Endpoints Used:')
$md.Add('')
$md.Add('- `GET /api/admin/proof-assets` - Fetch library assets')
$md.Add('- `GET /api/proof-slots?surface=bundles` - Get live bundles page data')
$md.Add('- `POST /api/admin/proof-asset-edit` - Save framing changes')
$md.Add('- `GET /api/proof-asset-media?bucket=proof&path=...` - Load images')
$md.Add('')
$md.Add('### Transform Logic to Verify:')
$md.Add('')
$md.Add('The working version should apply transforms like this:')
$md.Add('')
$md.Add('```javascript')
$md.Add('// In buildProofMediaStyle(asset):')
$md.Add('const geom = asset.smart_crop_details?.geometry;')
$md.Add('const panX = geom?.pan_x_pct ?? 0;')
$md.Add('const panY = geom?.pan_y_pct ?? 0;')
$md.Add('const tilt = geom?.tilt_deg ?? 0;')
$md.Add('const scale = geom?.scale_pct ?? 100;')
$md.Add('')
$md.Add('// Applied as:')
$md.Add('transform: `translate(${panX}%, ${panY}%) rotate(${tilt}deg) scale(${scale / 100}) translateZ(0)`')
$md.Add('```')
$md.Add('')
$md.Add('This MUST match between:')
$md.Add('- Dash editor preview')
$md.Add('- Dash library card thumbnails')
$md.Add('- Live bundles page rendering')
$md.Add('')
$md.Add('---')
$md.Add('')
$md.Add('## Next Steps After Finding Working Version')
$md.Add('')
$md.Add('### Step 1: Save Both Files')
$md.Add('')
$md.Add('```bash')
$md.Add('cd c:\\Users\\tabar\\h2s-bundles-workspace\\frontend')
$md.Add('')
$md.Add('# Current file (good for all other tabs)')
$md.Add('Copy-Item dash.html dash-CURRENT-OTHER-TABS.html -Force')
$md.Add('')
$md.Add('# Download working ProofPacks version from deployment')
$md.Add('# Right-click -> View Source -> Save as dash-WORKING-PROOFPACKS.html')
$md.Add('```')
$md.Add('')
$md.Add('### Step 2: Identify ProofPacks Tab Boundaries')
$md.Add('')
$md.Add('Open `dash-WORKING-PROOFPACKS.html` and find these markers:')
$md.Add('')
$md.Add('**Start of ProofPacks Tab**:')
$md.Add('```html')
$md.Add('<!-- PROOF PACKS PANE -->')
$md.Add('<div class="pane" id="proofpacks-pane">')
$md.Add('```')
$md.Add('')
$md.Add('**End of ProofPacks Tab**:')
$md.Add('```html')
$md.Add('</div> <!-- end #proofpacks-pane -->')
$md.Add('```')
$md.Add('')
$md.Add('Also look for ProofPacks JavaScript (usually near bottom):')
$md.Add('```javascript')
$md.Add('const proofPacks = {')
$md.Add('    // ... all ProofPacks functions')
$md.Add('};')
$md.Add('```')
$md.Add('')
$md.Add('And ProofPacks CSS:')
$md.Add('```css')
$md.Add('/* ProofPacks styles */')
$md.Add('.pp-library-grid { ... }')
$md.Add('.pp-editor-modal { ... }')
$md.Add('.pp-video-stage { ... }')
$md.Add('```')
$md.Add('')
$md.Add('### Step 3: Extract ProofPacks Tab Code')
$md.Add('')
$md.Add('Create extraction file with ONLY ProofPacks content:')
$md.Add('')
$md.Add('```bash')
$md.Add('# This will contain:')
$md.Add('# 1. HTML: <div class="pane" id="proofpacks-pane">...</div>')
$md.Add('# 2. JavaScript: const proofPacks = { ... }')
$md.Add('# 3. CSS: .pp-* styles')
$md.Add('```')
$md.Add('')
$md.Add('Save to: `frontend/PROOFPACKS-TAB-ONLY.html`')
$md.Add('')
$md.Add('### Step 4: Merge Into Current File')
$md.Add('')
$md.Add('Open `dash-CURRENT-OTHER-TABS.html` and:')
$md.Add('')
$md.Add('1. **Find the ProofPacks pane** (search for `id="proofpacks-pane"`)')
$md.Add('2. **Replace ONLY that `<div class="pane" id="proofpacks-pane">...</div>` section** with the working version')
$md.Add('3. **Find the ProofPacks JavaScript** (search for `const proofPacks = {` or `proofPacks.`)')
$md.Add('4. **Replace ONLY the ProofPacks object/functions** with the working version')
$md.Add('5. **Find ProofPacks CSS** (search for `.pp-library`, `.pp-editor`)')
$md.Add('6. **Replace ONLY `.pp-*` styles** with the working version')
$md.Add('')
$md.Add('**DO NOT TOUCH**:')
$md.Add('- Other panes (`#jobs-pane`, `#candidates-pane`, `#checkout-pane`, etc.)')
$md.Add('- Navigation/sidebar code')
$md.Add('- Other tab JavaScript')
$md.Add('- Global CSS/design system')
$md.Add('')
$md.Add('### Step 5: Verify Merge')
$md.Add('')
$md.Add('Check that you kept:')
$md.Add('- KEEP: All other tabs still work (Jobs, Candidates, etc.)')
$md.Add('- KEEP: Navigation/tab switching works')
$md.Add('- VERIFY: ProofPacks tab now has working editor')
$md.Add('')
$md.Add('### Step 6: Test and Deploy')
$md.Add('')
$md.Add('```bash')
$md.Add('# Save merged file')
$md.Add('Copy-Item dash-CURRENT-OTHER-TABS.html dash.html -Force')
$md.Add('')
$md.Add('# Test locally first if possible, then deploy')
$md.Add('vercel --prod --yes')
$md.Add('```')
$md.Add('')
$md.Add('---')
$md.Add('')
$md.Add('## Emergency Rollback')
$md.Add('')
$md.Add('If you find the working version and need to deploy it NOW:')
$md.Add('')
$md.Add('```bash')
$md.Add('cd c:\\Users\\tabar\\h2s-bundles-workspace\\frontend')
$md.Add('')
$md.Add('# Replace current with working version')
$md.Add('Copy-Item dash-WORKING-[DATE].html dash.html -Force')
$md.Add('')
$md.Add('# Deploy')
$md.Add('vercel --prod --yes')
$md.Add('')
$md.Add('# Verify')
$md.Add('Invoke-WebRequest -Uri "https://portal.home2smart.com/dash" -UseBasicParsing')
$md.Add('```')

$mdText = ($md -join "`n") + "`n"
Set-Content -LiteralPath $OutputPath -Value $mdText -Encoding utf8

Write-Host "Wrote: $OutputPath"

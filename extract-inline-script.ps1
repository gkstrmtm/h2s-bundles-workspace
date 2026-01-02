# Extract massive inline script from bundles.html to bundles-logic.js

$htmlPath = "Home2Smart-Dashboard\bundles.html"
$outputPath = "Home2Smart-Dashboard\bundles-logic.js"
$fixedHtmlPath = "Home2Smart-Dashboard\bundles-fixed.html"

Write-Host "Reading $htmlPath..."
$lines = Get-Content $htmlPath

Write-Host "Total lines: $($lines.Count)"

# Find all <script defer> tags
$scriptStarts = @()
for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match '<script defer>') {
        $scriptStarts += $i
        Write-Host "Found <script defer> at line $($i+1)"
    }
}

if ($scriptStarts.Count -lt 2) {
    Write-Host "ERROR: Need at least 2 script blocks"
    exit 1
}

# The FIRST <script defer> is the massive inline one (second is just a tiny runner script)
$startLine = $scriptStarts[0]
Write-Host "`nExtracting from line $($startLine+1) onwards..."

# Find the matching </script> tag
$endLine = $null
for ($i = $startLine + 1; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match '</script>') {
        $endLine = $i
        Write-Host "Found </script> at line $($i+1)"
        break
    }
}

if ($null -eq $endLine) {
    Write-Host "ERROR: Could not find closing </script> tag"
    exit 1
}

# Extract the JavaScript content (lines between the tags, NOT including the tags themselves)
$scriptLines = $lines[($startLine+1)..($endLine-1)]
$scriptContent = $scriptLines -join "`n"

# Write to bundles-logic.js
$scriptContent | Out-File -FilePath $outputPath -Encoding UTF8 -NoNewline

$sizeKB = [Math]::Round($scriptContent.Length / 1024, 1)
Write-Host ""
Write-Host "Extracted $($scriptContent.Length) bytes (${sizeKB} KB) to bundles-logic.js"
Write-Host "Extracted lines $($startLine+2) to $endLine"
Write-Host "Total extracted lines: $($endLine - $startLine - 1)"

# Create the replacement line
$replacementLine = '<script src="/bundles-logic.js" defer></script>'

# Build new HTML: everything before + replacement + everything after
$newLines = @()
$newLines += $lines[0..($startLine-1)]
$newLines += $replacementLine
$newLines += $lines[($endLine+1)..($lines.Count-1)]

# Write updated HTML
$newLines | Out-File -FilePath $fixedHtmlPath -Encoding UTF8

$oldSize = ($lines | ForEach-Object { $_.Length } | Measure-Object -Sum).Sum
$newSize = ($newLines | ForEach-Object { $_.Length } | Measure-Object -Sum).Sum
$savedKB = [Math]::Round(($oldSize - $newSize) / 1024, 1)

Write-Host ""
Write-Host "Created bundles-fixed.html"
Write-Host "Original: $([Math]::Round($oldSize/1024, 1)) KB"
Write-Host "New: $([Math]::Round($newSize/1024, 1)) KB"
Write-Host "Saved: ${savedKB} KB"

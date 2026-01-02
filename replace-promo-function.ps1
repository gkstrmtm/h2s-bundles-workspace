# Read bundles.html
$filePath = "Home2Smart-Dashboard\bundles.html"
$content = Get-Content $filePath -Raw

# The OLD version (with blocking return)
$oldBlock = @"
        // If we still can't construct real Stripe prices, don't flip the UI to "not applicable"
        // (that's misleading). Keep last-good UI if available.
        if (needsCatalog) {
          if (promoMsg) { promoMsg.textContent = 'Checking cart…'; promoMsg.style.color = '#666'; loadingSet = true; }
          if (rawLine) rawLine.style.display = 'none';
          return;
        }
"@

# The NEW version (without the blocking return - backend works fine with custom prices)
$newBlock = @"
        // Backend handles price:"custom" correctly - just needs unit_amount
        // No need to block promo validation when needsCatalog is true
        if (needsCatalog) {
          console.log('🎫 [PROMO] Using custom prices - backend only needs unit_amount');
        }
"@

# Try with Unicode ellipsis (…)
if ($content -match [regex]::Escape("Checking cart…")) {
    Write-Host "✅ Found Unicode ellipsis version"
    $content = $content.Replace($oldBlock, $newBlock)
    Set-Content $filePath $content -NoNewline -Encoding UTF8
    Write-Host "✅ Fixed! Removed blocking return statement"
}
# Try with triple dots (...)
elseif ($content -match [regex]::Escape("Checking cart...")) {
    Write-Host "✅ Found triple dot version"
    $oldBlockAlt = $oldBlock.Replace('…', '...')
    $content = $content.Replace($oldBlockAlt, $newBlock)
    Set-Content $filePath $content -NoNewline -Encoding UTF8
    Write-Host "✅ Fixed! Removed blocking return statement"
}
else {
    Write-Host "❌ Could not find the pattern in file"
    Write-Host "File has $($content.Length) characters"
}

# Verify
$newContent = Get-Content $filePath -Raw
if ($newContent -match "backend only needs unit_amount") {
    Write-Host "`n✅ VERIFICATION PASSED - New code is in place"
} else {
    Write-Host "`n❌ VERIFICATION FAILED - Code not updated"
}

$ErrorActionPreference = "Stop"
$url = "https://portal.home2smart.com/dash.PORTAL_BUILD_20260225_111332_4809419.js"
Write-Host "Fetching $url ..."
try {
    $resp = Invoke-WebRequest -Uri $url -UseBasicParsing
    $content = $resp.Content
    Write-Host "Status: $($resp.StatusCode)"
    Write-Host "Length: $($content.Length)"
    
    if ($content.Length -gt 2500) {
        Write-Host "First 2500 chars:"
        Write-Host $content.Substring(0, 2500)
        
        if ($content -match "initSidebarGroupToggles") {
            Write-Host "`nPASS: Found initSidebarGroupToggles" -ForegroundColor Green
        } else {
            Write-Host "`nFAIL: initSidebarGroupToggles NOT FOUND" -ForegroundColor Red
        }
    } else {
        Write-Host "Content:"
        Write-Host $content
    }
} catch {
    Write-Host "Error: $_" -ForegroundColor Red
}

Write-Host ">>> STARTING OUTSIDE WIRE VERIFICATION <<<"
$ErrorActionPreference = "Stop"

function Check-Url($url) {
    try {
        $res = Invoke-WebRequest -Uri $url -UseBasicParsing -ErrorAction Stop
        return $res.Content
    } catch {
        Write-Host "FAILED to fetch $url : $_" -ForegroundColor Red
        exit 1
    }
}

# 1. Fetch HTML
$target = "https://portal.home2smart.com/dash.html"
Write-Host "1. Fetching $target ..."
$html = Check-Url $target

# 2. Extract JS
if ($html -match 'src="(/dash\.PORTAL_BUILD_[^"]+\.js)"') {
    $scriptPath = $matches[1]
    Write-Host "   FOUND JS: $scriptPath" -ForegroundColor Green
} else {
    Write-Host "   FAIL: Could not find dash.PORTAL_BUILD_...js in HTML" -ForegroundColor Red
    $html | Select-String "dash\." | Out-String | Write-Host
    exit 1
}

# 3. Fetch JS
$jsUrl = "https://portal.home2smart.com$scriptPath"
Write-Host "2. Fetching JS: $jsUrl ..."
$js = Check-Url $jsUrl

# 4. Verify Fix
$marker = "function initSidebarGroupToggles"
if ($js -match $marker) {
    Write-Host "   PASS: Found '$marker'" -ForegroundColor Green
} else {
    Write-Host "   FAIL: '$marker' MISSING in deployed JS" -ForegroundColor Red
    exit 1
}

$marker2 = "window.toggleSidebarGroup ="
if ($js -match "window\.toggleSidebarGroup\s*=") {
    Write-Host "   PASS: Found '$marker2'" -ForegroundColor Green
} else {
    Write-Host "   FAIL: '$marker2' MISSING in deployed JS" -ForegroundColor Red
    exit 1
}

Write-Host "`n>>> VERIFICATION SUCCESS <<<" -ForegroundColor Cyan

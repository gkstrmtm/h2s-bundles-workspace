
$files = Get-ChildItem -Path "backend/app/api" -Recurse -Filter "route.ts"

foreach ($file in $files) {
    $content = Get-Content $file.FullName -Raw
    
    # Check if file has the broken pattern: await verifyPortalToken but assigning to payload which is then treated as payload
    # Pattern 1: const payload = await verifyPortalToken(token);
    if ($content -match "const payload = await verifyPortalToken\(token\);") {
        Write-Host "Fixing $($file.Name)..."
        
        # Replacement that unwraps the result
        $replacement = "const _auth = await verifyPortalToken(token);`n    if (!_auth.ok || !_auth.payload) {`n      return NextResponse.json({ ok: false, error: _auth.error || 'Invalid token', error_code: _auth.errorCode || 'bad_session' }, { status: 401, headers: corsHeaders(request) });`n    }`n    const payload = _auth.payload;"
        
        $newContent = $content.Replace("const payload = await verifyPortalToken(token);", $replacement)
        Set-Content -Path $file.FullName -Value $newContent -NoNewline
    }
    
    # Pattern 2: payload = await verifyPortalToken(token); (declarative assignment)
    if ($content -match "payload = await verifyPortalToken\(token\);") {
        Write-Host "Fixing assignment in $($file.Name)..."
         $replacement = "const _auth = await verifyPortalToken(token);`n      if (!_auth.ok || !_auth.payload) {`n        return NextResponse.json({ ok: false, error: _auth.error || 'Invalid token', error_code: _auth.errorCode || 'bad_session' }, { status: 401, headers: corsHeaders(request) });`n      }`n      payload = _auth.payload;"
         
         $newContent = $content.Replace("payload = await verifyPortalToken(token);", $replacement)
         Set-Content -Path $file.FullName -Value $newContent -NoNewline
    }
}


$files = Get-ChildItem -Path "backend/app/api" -Recurse -Filter "route.ts"

foreach ($file in $files) {
    $content = Get-Content $file.FullName -Raw
    
    # Fix double-const syntax error
    if ($content -match "const const _auth") {
        Write-Host "Fixing double-const in $($file.Name)..."
        $content = $content.Replace("const const _auth", "const _auth")
        $content = $content.Replace("payload = _auth.payload;", "const payload = _auth.payload;")
        Set-Content -Path $file.FullName -Value $content -NoNewline
    }
}

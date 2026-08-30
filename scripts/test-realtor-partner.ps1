[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
Push-Location $repoRoot

try {
    Write-Host 'Validating Realtor Partner markup and workflow wiring...'
    node scripts/validate-realtor-page.cjs

    Write-Host 'Checking booking JavaScript syntax...'
    node --check frontend/bundles.js

    Write-Host 'Checking dispatch JavaScript syntax...'
    node -e "const fs=require('fs'),s=fs.readFileSync('frontend/dispatch.html','utf8');let p=0,n=0;while((p=s.indexOf('<script',p))>=0){const a=s.indexOf('>',p)+1,b=s.indexOf('</script>',a);new Function(s.slice(a,b));n++;p=b+9}console.log('dispatch scripts parse OK:',n)"

    Write-Host 'Checking patch formatting...'
    git diff --check

    Write-Host 'Realtor Partner workflow checks passed.'
}
finally {
    Pop-Location
}

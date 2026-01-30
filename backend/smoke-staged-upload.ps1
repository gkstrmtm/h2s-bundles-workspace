param(
  [Parameter(Mandatory=$true)][string]$Base,
  [Parameter(Mandatory=$true)][string]$AdminKey
)

$initBody = @{ filename = "smoke.txt"; content_type = "text/plain"; size = 5; kind = "photo" } | ConvertTo-Json
$init = Invoke-RestMethod -Method Post -Uri "$Base/api/admin/proof-upload-init" -Headers @{"x-admin-key"=$AdminKey} -ContentType "application/json" -Body $initBody

$put = Invoke-WebRequest -Method Put -Uri $init.signed_url -Form @{ file = "hello" }

$finalBody = @{ raw_path = $init.raw_path; original_filename = "smoke.txt"; content_type = "text/plain"; kind = "photo"; convert_to_mp4 = $false } | ConvertTo-Json
$final = Invoke-RestMethod -Method Post -Uri "$Base/api/admin/proof-upload-finalize" -Headers @{"x-admin-key"=$AdminKey} -ContentType "application/json" -Body $finalBody

Write-Output ("PUT status: " + $put.StatusCode)
Write-Output ("Finalize ok: " + $final.ok)
Write-Output ("Converted: " + $final.converted_to_mp4)
Write-Output ("Stored path: " + $final.path)

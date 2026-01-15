# ============================================================================
# BACKEND ENHANCEMENTS VALIDATION SUITE
# ============================================================================
# Tests all recently deployed enhancements:
#   1. Race Condition Protection (dispatchOfferAssignment.ts)
#   2. Priority Scoring (portal_jobs/route.ts)
#   3. Photo De-duplication (customer_photos/route.ts)
#
# Usage: .\Test-BackendEnhancements.ps1 -AdminToken "your_token_here"
# ============================================================================

param(
    [Parameter(Mandatory=$false)]
    [string]$BackendUrl = "https://h2s-backend.vercel.app",
    
    [Parameter(Mandatory=$false)]
    [string]$AdminToken = $env:H2S_ADMIN_TOKEN,
    
    [switch]$Verbose
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

# ============================================================================
# CONFIGURATION
# ============================================================================

$Global:TestResults = @()
$Global:FailureCount = 0
$Global:PassCount = 0

# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

function Write-TestHeader {
    param([string]$Title)
    Write-Host "`n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
    Write-Host "  $Title" -ForegroundColor Cyan
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
}

function Write-TestResult {
    param(
        [string]$TestName,
        [bool]$Passed,
        [string]$Message,
        [hashtable]$Evidence = @{}
    )
    
    $result = @{
        TestName = $TestName
        Passed = $Passed
        Message = $Message
        Timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
        Evidence = $Evidence
    }
    
    $Global:TestResults += $result
    
    if ($Passed) {
        $Global:PassCount++
        Write-Host "  ✅ $TestName" -ForegroundColor Green
        if ($Message) { Write-Host "     $Message" -ForegroundColor Gray }
    } else {
        $Global:FailureCount++
        Write-Host "  ❌ $TestName" -ForegroundColor Red
        Write-Host "     $Message" -ForegroundColor Yellow
    }
    
    if ($Verbose -and $Evidence.Count -gt 0) {
        Write-Host "     Evidence:" -ForegroundColor DarkGray
        $Evidence.GetEnumerator() | ForEach-Object {
            Write-Host "       $($_.Key): $($_.Value)" -ForegroundColor DarkGray
        }
    }
}

function Invoke-ApiRequest {
    param(
        [string]$Method,
        [string]$Endpoint,
        [hashtable]$Body = $null,
        [hashtable]$Headers = @{ "Content-Type" = "application/json" },
        [int[]]$ExpectedStatus = @(200, 201)
    )
    
    $uri = "$BackendUrl$Endpoint"
    
    try {
        $params = @{
            Uri = $uri
            Method = $Method
            Headers = $Headers
            UseBasicParsing = $true
            TimeoutSec = 30
        }
        
        if ($Body) {
            $params.Body = ($Body | ConvertTo-Json -Depth 10)
        }
        
        if ($Verbose) {
            Write-Host "    → $Method $uri" -ForegroundColor DarkGray
        }
        
        $response = Invoke-WebRequest @params
        
        if ($response.StatusCode -in $ExpectedStatus) {
            $content = $response.Content | ConvertFrom-Json
            return @{
                Success = $true
                StatusCode = $response.StatusCode
                Data = $content
                RawResponse = $response
            }
        } else {
            return @{
                Success = $false
                StatusCode = $response.StatusCode
                Error = "Unexpected status code: $($response.StatusCode)"
            }
        }
    } catch {
        $errorDetails = $_.Exception.Message
        $statusCode = $null
        
        if ($_.Exception.Response) {
            $statusCode = $_.Exception.Response.StatusCode.value__
            try {
                $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
                $responseBody = $reader.ReadToEnd() | ConvertFrom-Json
                $errorDetails = $responseBody.error
                $reader.Close()
            } catch {}
        }
        
        # If we expected this status code, treat as success
        if ($statusCode -in $ExpectedStatus) {
            try {
                $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
                $responseBody = $reader.ReadToEnd() | ConvertFrom-Json
                $reader.Close()
                
                return @{
                    Success = $true
                    StatusCode = $statusCode
                    Data = $responseBody
                }
            } catch {
                return @{
                    Success = $true
                    StatusCode = $statusCode
                    Data = $null
                }
            }
        }
        
        return @{
            Success = $false
            StatusCode = $statusCode
            Error = $errorDetails
        }
    }
}

# ============================================================================
# TEST 1: Priority Scoring Implementation
# ============================================================================

function Test-PriorityScoring {
    Write-TestHeader "TEST 1: Priority Scoring Implementation"
    
    if (!$AdminToken) {
        Write-TestResult -TestName "Priority Scoring (Skipped)" -Passed $false -Message "H2S_ADMIN_TOKEN required (set environment variable)"
        return
    }
    
    Write-Host "  Fetching portal jobs..." -ForegroundColor Gray
    
    $jobsResponse = Invoke-ApiRequest -Method POST -Endpoint "/api/portal_jobs" -Body @{
        token = $AdminToken
        lat = 34.0522
        lng = -118.2437
    }
    
    if (!$jobsResponse.Success) {
        Write-TestResult -TestName "Portal jobs endpoint" -Passed $false -Message $jobsResponse.Error
        return
    }
    
    if (!$jobsResponse.Data.ok) {
        Write-TestResult -TestName "Portal jobs endpoint" -Passed $false -Message "API returned ok=false"
        return
    }
    
    Write-TestResult -TestName "Portal jobs endpoint accessible" -Passed $true -Message "Returned jobs successfully"
    
    # Check offers array
    $offers = $jobsResponse.Data.offers
    
    if ($offers.Count -eq 0) {
        Write-TestResult -TestName "Priority Scoring (Skipped)" -Passed $false -Message "No available jobs to test scoring"
        return
    }
    
    Write-Host "  Analyzing $($offers.Count) available jobs..." -ForegroundColor Gray
    
    # Test 1: priority_score field exists
    $firstJob = $offers[0]
    $hasPriorityScore = $null -ne $firstJob.priority_score
    
    Write-TestResult -TestName "priority_score field exists" -Passed $hasPriorityScore -Message "Found in job objects: $hasPriorityScore" -Evidence @{
        sample_score = $firstJob.priority_score
        sample_label = $firstJob.priority_label
        job_status = $firstJob.status
    }
    
    if (!$hasPriorityScore) {
        return # Can't test further without the field
    }
    
    # Test 2: priority_label field exists
    $hasPriorityLabel = $null -ne $firstJob.priority_label -and $firstJob.priority_label -ne ""
    
    Write-TestResult -TestName "priority_label field exists" -Passed $hasPriorityLabel -Message "Priority labels: $($firstJob.priority_label)" -Evidence @{
        label = $firstJob.priority_label
    }
    
    # Test 3: Jobs are sorted by priority_score (descending)
    $scores = $offers | ForEach-Object { [int]$_.priority_score }
    $sortedScores = $scores | Sort-Object -Descending
    $isSorted = ($scores -join ',') -eq ($sortedScores -join ',')
    
    Write-TestResult -TestName "Jobs sorted by priority_score DESC" -Passed $isSorted -Message "Ordering correct: $isSorted" -Evidence @{
        top_3_scores = ($scores | Select-Object -First 3) -join ', '
        expected = ($sortedScores | Select-Object -First 3) -join ', '
    }
    
    # Test 4: Scheduled jobs have higher priority
    $scheduledJobs = $offers | Where-Object { $_.status -eq 'scheduled' }
    if ($scheduledJobs.Count -gt 0) {
        $scheduledScore = [int]$scheduledJobs[0].priority_score
        $hasScheduledBonus = $scheduledScore -ge 1000
        
        Write-TestResult -TestName "Scheduled jobs prioritized (score >= 1000)" -Passed $hasScheduledBonus -Message "Scheduled job score: $scheduledScore" -Evidence @{
            scheduled_score = $scheduledScore
            expected_min = 1000
        }
    } else {
        Write-Host "  ℹ️  No scheduled jobs available to test bonus" -ForegroundColor DarkGray
    }
    
    # Test 5: Verify distance bonus for nearby jobs
    $nearbyJobs = $offers | Where-Object { $null -ne $_.distance_miles -and $_.distance_miles -lt 10 }
    if ($nearbyJobs.Count -gt 0) {
        $nearbyJob = $nearbyJobs[0]
        $hasProximityBonus = $nearbyJob.priority_label -like "*Nearby*" -or $nearbyJob.priority_label -like "*<10mi*"
        
        Write-TestResult -TestName "Nearby jobs have proximity bonus" -Passed $hasProximityBonus -Message "Nearby job label: $($nearbyJob.priority_label)" -Evidence @{
            distance = $nearbyJob.distance_miles
            priority_label = $nearbyJob.priority_label
            priority_score = $nearbyJob.priority_score
        }
    } else {
        Write-Host "  ℹ️  No nearby jobs (<10mi) to test proximity bonus" -ForegroundColor DarkGray
    }
    
    # Test 6: Tie-breaker by created_at (when scores equal)
    $duplicateScores = $scores | Group-Object | Where-Object { $_.Count -gt 1 }
    if ($duplicateScores) {
        $score = [int]$duplicateScores[0].Name
        $jobsWithSameScore = $offers | Where-Object { [int]$_.priority_score -eq $score }
        
        $timestamps = $jobsWithSameScore | ForEach-Object { [DateTime]$_.created_at }
        $sortedTimestamps = $timestamps | Sort-Object -Descending
        $tieBreaker = ($timestamps -join ',') -eq ($sortedTimestamps -join ',')
        
        Write-TestResult -TestName "Tie-breaker: created_at DESC" -Passed $tieBreaker -Message "Jobs with score $score sorted by newest first" -Evidence @{
            jobs_with_same_score = $jobsWithSameScore.Count
            tie_breaker_correct = $tieBreaker
        }
    } else {
        Write-Host "  ℹ️  No tied scores to test tie-breaker" -ForegroundColor DarkGray
    }
}

# ============================================================================
# TEST 2: Photo De-duplication
# ============================================================================

function Test-PhotoDeduplication {
    Write-TestHeader "TEST 2: Photo De-duplication (Hash-based)"
    
    if (!$AdminToken) {
        Write-TestResult -TestName "Photo De-duplication (Skipped)" -Passed $false -Message "H2S_ADMIN_TOKEN required"
        return
    }
    
    # Get a test job
    $jobsResponse = Invoke-ApiRequest -Method POST -Endpoint "/api/portal_jobs" -Body @{
        token = $AdminToken
    }
    
    if (!$jobsResponse.Success -or $jobsResponse.Data.offers.Count -eq 0) {
        Write-TestResult -TestName "Photo De-duplication (Skipped)" -Passed $false -Message "No available jobs to test photo upload"
        return
    }
    
    $testJob = $jobsResponse.Data.offers[0]
    $testJobId = $testJob.job_id
    
    Write-Host "  Using test job: $testJobId" -ForegroundColor Gray
    
    # Create a tiny test image (1x1 transparent PNG - 67 bytes)
    $testImageBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
    
    # Upload photo #1
    Write-Host "  Uploading first photo..." -ForegroundColor Gray
    
    $upload1 = Invoke-ApiRequest -Method POST -Endpoint "/api/customer_photos" -Body @{
        job_id = $testJobId
        customer_email = "test-$(Get-Random)@example.com"
        data = $testImageBase64
        filename = "test-photo-$(Get-Random).png"
        mimetype = "image/png"
    } -ExpectedStatus @(200, 201)
    
    if (!$upload1.Success) {
        Write-TestResult -TestName "Photo upload" -Passed $false -Message $upload1.Error
        return
    }
    
    if (!$upload1.Data.ok) {
        Write-TestResult -TestName "Photo upload" -Passed $false -Message "Upload returned ok=false: $($upload1.Data.error)"
        return
    }
    
    $uploadId1 = $upload1.Data.upload.upload_id
    
    Write-TestResult -TestName "First photo upload successful" -Passed $true -Message "Upload ID: $uploadId1" -Evidence @{
        upload_id = $uploadId1
        file_size = $upload1.Data.upload.file_size
        job_id = $testJobId
    }
    
    # Upload photo #2 (SAME file - should be rejected as duplicate)
    Write-Host "  Uploading duplicate photo (should be rejected)..." -ForegroundColor Gray
    
    $upload2 = Invoke-ApiRequest -Method POST -Endpoint "/api/customer_photos" -Body @{
        job_id = $testJobId
        customer_email = "different-$(Get-Random)@example.com"
        data = $testImageBase64  # SAME image data
        filename = "different-name-$(Get-Random).png"  # Different filename
        mimetype = "image/png"
    } -ExpectedStatus @(409, 200, 201)
    
    # Check if duplicate was properly rejected
    $isDuplicate = $false
    $errorCode = $null
    
    if ($upload2.StatusCode -eq 409) {
        # Expected: 409 Conflict
        $isDuplicate = $true
        $errorCode = $upload2.Data.error_code
    } elseif ($upload2.Success -and !$upload2.Data.ok) {
        # Also acceptable: 200 with ok=false
        if ($upload2.Data.error -like "*duplicate*" -or $upload2.Data.error -like "*already uploaded*") {
            $isDuplicate = $true
            $errorCode = $upload2.Data.error_code
        }
    }
    
    Write-TestResult -TestName "Duplicate photo rejected - 409 Conflict" -Passed $isDuplicate -Message "De-duplication working: $isDuplicate" -Evidence @{
        status_code = $upload2.StatusCode
        error_code = $errorCode
        error_message = $upload2.Data.error
    }
    
    if ($isDuplicate) {
        # Verify existing_upload is returned
        $hasExistingUpload = $null -ne $upload2.Data.existing_upload
        
        Write-TestResult -TestName "Returns existing_upload details" -Passed $hasExistingUpload -Message "Existing upload info: $hasExistingUpload" -Evidence @{
            existing_upload_id = $upload2.Data.existing_upload.upload_id
            original_uploaded_at = $upload2.Data.existing_upload.uploaded_at
        }
    }
    
    # Verify file_hash is stored in database
    Write-Host "  Fetching photos to verify hash storage..." -ForegroundColor Gray
    
    $photosCheck = Invoke-ApiRequest -Method GET -Endpoint "/api/customer_photos?job_id=$testJobId`&token=$AdminToken"
    
    if ($photosCheck.Success -and $photosCheck.Data.uploads) {
        $upload = $photosCheck.Data.uploads | Where-Object { $_.upload_id -eq $uploadId1 } | Select-Object -First 1
        
        if ($upload) {
            $hasFileHash = $null -ne $upload.file_hash -and $upload.file_hash -ne ""
            
            Write-TestResult -TestName "file_hash stored in database" -Passed $hasFileHash -Message "Hash: $($upload.file_hash)" -Evidence @{
                file_hash = $upload.file_hash
                hash_length = $upload.file_hash.Length
            }
        }
    }
}

# ============================================================================
# TEST 3: Race Condition Protection
# ============================================================================

function Test-RaceConditionProtection {
    Write-TestHeader "TEST 3: Race Condition Protection (Job Acceptance)"
    
    if (!$AdminToken) {
        Write-TestResult -TestName "Race Condition Protection (Skipped)" -Passed $false -Message "H2S_ADMIN_TOKEN required"
        return
    }
    
    Write-Host "  ⚠️  WARNING: This test attempts concurrent job accepts" -ForegroundColor Yellow
    Write-Host "  It may modify live data. Press Ctrl+C to cancel, or wait 5 seconds..." -ForegroundColor Yellow
    Start-Sleep -Seconds 5
    
    # Get an available job
    $jobsResponse = Invoke-ApiRequest -Method POST -Endpoint "/api/portal_jobs" -Body @{
        token = $AdminToken
    }
    
    if (!$jobsResponse.Success -or $jobsResponse.Data.offers.Count -eq 0) {
        Write-TestResult -TestName "Race Condition Protection (Skipped)" -Passed $false -Message "No available jobs to test"
        return
    }
    
    $testJob = $jobsResponse.Data.offers[0]
    $testJobId = $testJob.job_id
    
    Write-Host "  Using test job: $testJobId" -ForegroundColor Gray
    Write-Host "  Simulating 2 pros accepting same job simultaneously..." -ForegroundColor Gray
    
    # Create two concurrent job accepts using Start-Job
    $proA = Start-Job -ScriptBlock {
        param($BackendUrl, $AdminToken, $JobId)
        
        $body = @{
            token = $AdminToken
            job_id = $JobId
            action = "accept"
            pro_id = "test_pro_A_$(Get-Random)"
        } | ConvertTo-Json
        
        try {
            $response = Invoke-RestMethod -Uri "$BackendUrl/api/admin_dispatch" -Method POST -Body $body -ContentType "application/json" -TimeoutSec 10
            return @{
                Success = $true
                Data = $response
            }
        } catch {
            return @{
                Success = $false
                Error = $_.Exception.Message
            }
        }
    } -ArgumentList $BackendUrl, $AdminToken, $testJobId
    
    # Small delay to simulate near-simultaneous requests
    Start-Sleep -Milliseconds 10
    
    $proB = Start-Job -ScriptBlock {
        param($BackendUrl, $AdminToken, $JobId)
        
        $body = @{
            token = $AdminToken
            job_id = $JobId
            action = "accept"
            pro_id = "test_pro_B_$(Get-Random)"
        } | ConvertTo-Json
        
        try {
            $response = Invoke-RestMethod -Uri "$BackendUrl/api/admin_dispatch" -Method POST -Body $body -ContentType "application/json" -TimeoutSec 10
            return @{
                Success = $true
                Data = $response
            }
        } catch {
            return @{
                Success = $false
                Error = $_.Exception.Message
            }
        }
    } -ArgumentList $BackendUrl, $AdminToken, $testJobId
    
    # Wait for both jobs to complete
    Write-Host "  Waiting for concurrent accepts to complete..." -ForegroundColor Gray
    $resultA = Wait-Job $proA | Receive-Job
    $resultB = Wait-Job $proB | Receive-Job
    
    Remove-Job $proA, $proB
    
    # Analyze results
    $successCount = 0
    $racConditionBlocked = $false
    
    if ($resultA.Success -and $resultA.Data.ok) {
        $successCount++
        Write-Host "  Pro A: Accepted successfully" -ForegroundColor Gray
    } else {
        Write-Host "  Pro A: $($resultA.Error)" -ForegroundColor Gray
        if ($resultA.Error -like "*already assigned*" -or $resultA.Error -like "*Job already*") {
            $raceConditionBlocked = $true
        }
    }
    
    if ($resultB.Success -and $resultB.Data.ok) {
        $successCount++
        Write-Host "  Pro B: Accepted successfully" -ForegroundColor Gray
    } else {
        Write-Host "  Pro B: $($resultB.Error)" -ForegroundColor Gray
        if ($resultB.Error -like "*already assigned*" -or $resultB.Error -like "*Job already*") {
            $raceConditionBlocked = $true
        }
    }
    
    # Test passes if:
    # 1. Only ONE pro accepted successfully, OR
    # 2. At least one was blocked with "already assigned" error
    $testPassed = ($successCount -eq 1) -or $raceConditionBlocked
    
    Write-TestResult -TestName "Race condition protection" -Passed $testPassed -Message "Only 1 pro accepted, other blocked: $testPassed" -Evidence @{
        success_count = $successCount
        race_condition_blocked = $raceConditionBlocked
        pro_a_result = if ($resultA.Success) { "accepted" } else { "blocked" }
        pro_b_result = if ($resultB.Success) { "accepted" } else { "blocked" }
    }
    
    if ($successCount -eq 2) {
        Write-TestResult -TestName "CRITICAL: Double-accept prevented" -Passed $false -Message "BOTH pros accepted same job - race condition NOT prevented!" -Evidence @{
            job_id = $testJobId
        }
    } else {
        Write-TestResult -TestName "Double-accept prevented" -Passed $true -Message "Race condition protection working"
    }
}

# ============================================================================
# TEST 4: Database Schema Validation
# ============================================================================

function Test-DatabaseSchema {
    Write-TestHeader "TEST 4: Database Schema Validation"
    
    if (!$AdminToken) {
        Write-TestResult -TestName "Schema Validation (Skipped)" -Passed $false -Message "H2S_ADMIN_TOKEN required"
        return
    }
    
    # Test 1: Verify job_details is never empty (regression guard)
    Write-Host "  Checking for empty job_details (regression guard)..." -ForegroundColor Gray
    
    $jobsResponse = Invoke-ApiRequest -Method POST -Endpoint "/api/portal_jobs" -Body @{
        token = $AdminToken
    }
    
    if ($jobsResponse.Success) {
        $allJobs = $jobsResponse.Data.offers + $jobsResponse.Data.upcoming + $jobsResponse.Data.completed
        $emptyDetails = $allJobs | Where-Object { [string]::IsNullOrWhiteSpace($_.job_details) }
        
        $noEmptyDetails = $emptyDetails.Count -eq 0
        
        Write-TestResult -TestName "No empty job_details fields" -Passed $noEmptyDetails -Message "Empty count: $($emptyDetails.Count) / $($allJobs.Count)" -Evidence @{
            total_jobs = $allJobs.Count
            empty_count = $emptyDetails.Count
        }
    }
    
    # Test 2: Verify order_id linkage exists
    Write-Host "  Checking order_id linkage..." -ForegroundColor Gray
    
    if ($jobsResponse.Success) {
        $jobsWithOrders = $allJobs | Where-Object { $null -ne $_.order_id -and $_.order_id -ne "" }
        $linkageRate = [math]::Round(($jobsWithOrders.Count / $allJobs.Count) * 100, 1)
        
        # We expect most (but not all) jobs to have order_id - some may be manually created
        $adequateLinkage = $linkageRate -ge 50  # At least 50% should have order_id
        
        Write-TestResult -TestName "order_id linkage present" -Passed $adequateLinkage -Message "$linkageRate% of jobs have order_id" -Evidence @{
            jobs_with_order_id = $jobsWithOrders.Count
            total_jobs = $allJobs.Count
            linkage_rate = "$linkageRate%"
        }
    }
    
    # Test 3: Verify file_hash field in photo uploads
    Write-Host "  Checking file_hash field in uploads..." -ForegroundColor Gray
    
    # Get any job with photos
    $jobWithPhotos = $allJobs | Where-Object { $_.photo_count -gt 0 } | Select-Object -First 1
    
    if ($jobWithPhotos) {
        $photosCheck = Invoke-ApiRequest -Method GET -Endpoint "/api/customer_photos?job_id=$($jobWithPhotos.job_id)`&token=$AdminToken"
        
        if ($photosCheck.Success -and $photosCheck.Data.uploads) {
            $uploadsWithHash = $photosCheck.Data.uploads | Where-Object { $null -ne $_.file_hash -and $_.file_hash -ne "" }
            $hashRate = [math]::Round(($uploadsWithHash.Count / $photosCheck.Data.uploads.Count) * 100, 1)
            
            # Recent uploads should have hash (older ones may not)
            $hasHashSupport = $uploadsWithHash.Count -gt 0
            
            Write-TestResult -TestName "file_hash field present in uploads" -Passed $hasHashSupport -Message "$hashRate% of uploads have file_hash" -Evidence @{
                uploads_with_hash = $uploadsWithHash.Count
                total_uploads = $photosCheck.Data.uploads.Count
                hash_rate = "$hashRate%"
            }
        }
    } else {
        Write-Host "  ℹ️  No jobs with photos to test file_hash field" -ForegroundColor DarkGray
    }
}

# ============================================================================
# MAIN EXECUTION
# ============================================================================

Write-Host "`n╔════════════════════════════════════════════════════════════════╗" -ForegroundColor Magenta
Write-Host "║  BACKEND ENHANCEMENTS VALIDATION SUITE                         ║" -ForegroundColor Magenta
Write-Host "║  Testing: Race Protection | Priority Scoring | Photo Dedup    ║" -ForegroundColor Magenta
Write-Host "║  Backend: $BackendUrl" -ForegroundColor Magenta
Write-Host "╚════════════════════════════════════════════════════════════════╝" -ForegroundColor Magenta

# Verify admin token
if (!$AdminToken) {
    Write-Host "`n⚠️  WARNING: H2S_ADMIN_TOKEN not provided!" -ForegroundColor Yellow
    Write-Host "Set environment variable: `$env:H2S_ADMIN_TOKEN = `'your_token`'" -ForegroundColor Yellow
    Write-Host "Some tests will be skipped.`n" -ForegroundColor Yellow
}

# Run all tests
Test-PriorityScoring
Test-PhotoDeduplication
Test-RaceConditionProtection
Test-DatabaseSchema

# ============================================================================
# GENERATE REPORT
# ============================================================================

Write-TestHeader "VALIDATION SUMMARY"

$totalTests = $Global:PassCount + $Global:FailureCount
$passRate = if ($totalTests -gt 0) { [math]::Round(($Global:PassCount / $totalTests) * 100, 1) } else { 0 }

Write-Host "`nTotal Tests:    $totalTests" -ForegroundColor White
Write-Host "Passed:         $Global:PassCount" -ForegroundColor Green
Write-Host "Failed:         $Global:FailureCount" -ForegroundColor $(if ($Global:FailureCount -gt 0) { "Red" } else { "Gray" })
Write-Host "Pass Rate:      $passRate%" -ForegroundColor $(if ($passRate -ge 90) { "Green" } elseif ($passRate -ge 70) { "Yellow" } else { "Red" })

# Save report
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$reportPath = ".\backend-enhancements-report-$timestamp.json"
$Global:TestResults | ConvertTo-Json -Depth 10 | Out-File -FilePath $reportPath -Encoding UTF8

Write-Host "`n📄 Full report saved to: $reportPath" -ForegroundColor Cyan

# Exit with appropriate code
if ($Global:FailureCount -eq 0) {
    Write-Host "`n✅ ALL ENHANCEMENTS VALIDATED - PRODUCTION READY`n" -ForegroundColor Green
    exit 0
} else {
    Write-Host "`n⚠️  $Global:FailureCount TESTS FAILED - REVIEW REQUIRED`n" -ForegroundColor Yellow
    exit 1
}

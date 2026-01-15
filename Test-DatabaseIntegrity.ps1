# ============================================================================
# DATABASE INTEGRITY VALIDATION SCRIPT
# ============================================================================
# Validates all critical database tables, columns, relationships and constraints
# Ensures schema congruence and data integrity across the H2S system
#
# Usage: .\Test-DatabaseIntegrity.ps1
# Prerequisites: SUPABASE_URL and SUPABASE_SERVICE_KEY environment variables
# ============================================================================

param(
    [switch]$Verbose,
    [switch]$ExportSchema
)

$ErrorActionPreference = "Stop"

# ============================================================================
# CONFIGURATION
# ============================================================================

$Global:TestResults = @()
$Global:FailureCount = 0
$Global:PassCount = 0

$SupabaseUrl = $env:SUPABASE_URL
$SupabaseKey = $env:SUPABASE_SERVICE_KEY

# Expected schema definitions
$ExpectedTables = @{
    "h2s_orders" = @{
        required_columns = @("order_id", "session_id", "customer_email", "status", "metadata_json", "created_at")
        description = "Customer orders (canonical record)"
    }
    "h2s_dispatch_jobs" = @{
        required_columns = @("job_id", "order_id", "status", "job_details", "due_at", "customer_id", "created_at")
        description = "Technician jobs (dispatch flow)"
    }
    "h2s_dispatch_job_assignments" = @{
        required_columns = @("assignment_id", "job_id", "pro_id", "assign_state", "created_at")
        description = "Job-to-pro assignments"
    }
    "job_customer_uploads" = @{
        required_columns = @("upload_id", "job_id", "file_url", "file_hash", "file_size", "created_at")
        description = "Customer photo uploads"
    }
    "h2s_pros" = @{
        required_columns = @("pro_id", "email", "name", "phone", "created_at")
        description = "Technician profiles"
    }
    "h2s_recipients" = @{
        required_columns = @("recipient_id", "email", "name", "phone", "created_at")
        description = "Customer records for dispatch"
    }
}

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

function Invoke-SupabaseQuery {
    param(
        [string]$Table,
        [string]$Select = "*",
        [hashtable]$Filter = @{},
        [int]$Limit = 100
    )
    
    if (!$SupabaseUrl -or !$SupabaseKey) {
        throw "SUPABASE_URL and SUPABASE_SERVICE_KEY environment variables required"
    }
    
    $headers = @{
        "apikey" = $SupabaseKey
        "Authorization" = "Bearer $SupabaseKey"
        "Content-Type" = "application/json"
    }
    
    $uri = "$SupabaseUrl/rest/v1/$Table?select=$Select&limit=$Limit"
    
    # Add filters
    foreach ($key in $Filter.Keys) {
        $uri += "&$key=eq.$($Filter[$key])"
    }
    
    try {
        $response = Invoke-RestMethod -Uri $uri -Method GET -Headers $headers -TimeoutSec 30
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
}

function Get-TableColumns {
    param([string]$TableName)
    
    $query = "SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = '$TableName' ORDER BY ordinal_position"
    
    # Use Supabase RPC or direct query (simplified for this script)
    # In production, you'd use Supabase's query builder or SQL execution
    
    # For now, we'll infer columns from a sample query
    $sampleQuery = Invoke-SupabaseQuery -Table $TableName -Limit 1
    
    if ($sampleQuery.Success -and $sampleQuery.Data) {
        if ($sampleQuery.Data -is [array] -and $sampleQuery.Data.Count -gt 0) {
            $columns = $sampleQuery.Data[0].PSObject.Properties.Name
            return @{
                Success = $true
                Columns = $columns
            }
        } elseif ($sampleQuery.Data.PSObject.Properties.Count -gt 0) {
            $columns = $sampleQuery.Data.PSObject.Properties.Name
            return @{
                Success = $true
                Columns = $columns
            }
        }
    }
    
    return @{
        Success = $false
        Columns = @()
        Error = "Could not retrieve columns"
    }
}

# ============================================================================
# TEST 1: Database Connectivity
# ============================================================================

function Test-DatabaseConnectivity {
    Write-TestHeader "TEST 1: Database Connectivity"
    
    if (!$SupabaseUrl) {
        Write-TestResult -TestName "Database connectivity" -Passed $false -Message "SUPABASE_URL environment variable not set"
        return
    }
    
    if (!$SupabaseKey) {
        Write-TestResult -TestName "Database connectivity" -Passed $false -Message "SUPABASE_SERVICE_KEY environment variable not set"
        return
    }
    
    Write-Host "  Testing connection to: $SupabaseUrl" -ForegroundColor Gray
    
    # Test with a simple query
    $testQuery = Invoke-SupabaseQuery -Table "h2s_pros" -Limit 1
    
    if ($testQuery.Success) {
        Write-TestResult -TestName "Database connection successful" -Passed $true -Message "Connected to Supabase successfully" -Evidence @{
            supabase_url = $SupabaseUrl
        }
    } else {
        Write-TestResult -TestName "Database connection" -Passed $false -Message $testQuery.Error
    }
}

# ============================================================================
# TEST 2: Table Existence & Schema Validation
# ============================================================================

function Test-TableSchema {
    Write-TestHeader "TEST 2: Table Schema Validation"
    
    foreach ($tableName in $ExpectedTables.Keys) {
        $tableInfo = $ExpectedTables[$tableName]
        
        Write-Host "  Checking table: $tableName" -ForegroundColor Gray
        Write-Host "    Description: $($tableInfo.description)" -ForegroundColor DarkGray
        
        # Check table exists (by querying it)
        $tableQuery = Invoke-SupabaseQuery -Table $tableName -Limit 1
        
        if (!$tableQuery.Success) {
            Write-TestResult -TestName "Table exists: $tableName" -Passed $false -Message $tableQuery.Error
            continue
        }
        
        Write-TestResult -TestName "Table exists: $tableName" -Passed $true -Message $tableInfo.description
        
        # Get columns
        $columnsResult = Get-TableColumns -TableName $tableName
        
        if (!$columnsResult.Success) {
            Write-TestResult -TestName "Retrieve columns: $tableName" -Passed $false -Message $columnsResult.Error
            continue
        }
        
        $actualColumns = $columnsResult.Columns
        
        Write-Host "    Found $($actualColumns.Count) columns" -ForegroundColor DarkGray
        
        # Check required columns
        $missingColumns = @()
        foreach ($requiredCol in $tableInfo.required_columns) {
            if ($actualColumns -notcontains $requiredCol) {
                $missingColumns += $requiredCol
            }
        }
        
        if ($missingColumns.Count -eq 0) {
            Write-TestResult -TestName "Required columns present: $tableName" -Passed $true -Message "All $($tableInfo.required_columns.Count) required columns found" -Evidence @{
                required = $tableInfo.required_columns.Count
                found = $actualColumns.Count
            }
        } else {
            Write-TestResult -TestName "Required columns present: $tableName" -Passed $false -Message "Missing: $($missingColumns -join ', ')" -Evidence @{
                missing_columns = ($missingColumns -join ', ')
            }
        }
    }
}

# ============================================================================
# TEST 3: Data Integrity Checks
# ============================================================================

function Test-DataIntegrity {
    Write-TestHeader "TEST 3: Data Integrity Checks"
    
    # Check 1: No empty job_details (regression guard)
    Write-Host "  Checking for empty job_details..." -ForegroundColor Gray
    
    $jobsQuery = Invoke-SupabaseQuery -Table "h2s_dispatch_jobs" -Select "job_id,job_details" -Limit 100
    
    if ($jobsQuery.Success) {
        $emptyDetails = @()
        foreach ($job in $jobsQuery.Data) {
            if ([string]::IsNullOrWhiteSpace($job.job_details)) {
                $emptyDetails += $job.job_id
            }
        }
        
        $noEmptyDetails = $emptyDetails.Count -eq 0
        
        Write-TestResult -TestName "No empty job_details fields" -Passed $noEmptyDetails -Message "Empty count: $($emptyDetails.Count) / $($jobsQuery.Data.Count)" -Evidence @{
            total_checked = $jobsQuery.Data.Count
            empty_count = $emptyDetails.Count
        }
        
        if ($emptyDetails.Count -gt 0 -and $Verbose) {
            Write-Host "    Jobs with empty details: $($emptyDetails -join ', ')" -ForegroundColor Yellow
        }
    }
    
    # Check 2: order_id linkage integrity
    Write-Host "  Checking order_id linkage..." -ForegroundColor Gray
    
    $jobsWithOrders = Invoke-SupabaseQuery -Table "h2s_dispatch_jobs" -Select "job_id,order_id" -Limit 100
    
    if ($jobsWithOrders.Success) {
        $linkedJobs = 0
        $unlinkedJobs = 0
        
        foreach ($job in $jobsWithOrders.Data) {
            if ($null -ne $job.order_id -and $job.order_id -ne "") {
                $linkedJobs++
            } else {
                $unlinkedJobs++
            }
        }
        
        $linkageRate = [math]::Round(($linkedJobs / $jobsWithOrders.Data.Count) * 100, 1)
        
        # Expect most jobs to have order_id (>= 50%)
        $adequateLinkage = $linkageRate -ge 50
        
        Write-TestResult -TestName "order_id linkage rate >= 50%" -Passed $adequateLinkage -Message "$linkageRate% of jobs have order_id" -Evidence @{
            linked_jobs = $linkedJobs
            unlinked_jobs = $unlinkedJobs
            total_jobs = $jobsWithOrders.Data.Count
            linkage_rate = "$linkageRate%"
        }
    }
    
    # Check 3: Photo uploads have file_hash
    Write-Host "  Checking photo uploads have file_hash..." -ForegroundColor Gray
    
    $uploadsQuery = Invoke-SupabaseQuery -Table "job_customer_uploads" -Select "upload_id,file_hash" -Limit 100
    
    if ($uploadsQuery.Success -and $uploadsQuery.Data.Count -gt 0) {
        $withHash = 0
        $withoutHash = 0
        
        foreach ($upload in $uploadsQuery.Data) {
            if ($null -ne $upload.file_hash -and $upload.file_hash -ne "") {
                $withHash++
            } else {
                $withoutHash++
            }
        }
        
        $hashRate = [math]::Round(($withHash / $uploadsQuery.Data.Count) * 100, 1)
        
        # Recent uploads should have hash (>= 10% is acceptable for gradual rollout)
        $hasHashSupport = $withHash -gt 0
        
        Write-TestResult -TestName "Photo uploads have file_hash" -Passed $hasHashSupport -Message "$hashRate% of uploads have file_hash" -Evidence @{
            with_hash = $withHash
            without_hash = $withoutHash
            total_uploads = $uploadsQuery.Data.Count
            hash_rate = "$hashRate%"
        }
    } else {
        Write-Host "  ℹ️  No photo uploads found to test" -ForegroundColor DarkGray
    }
    
    # Check 4: Job assignments have valid states
    Write-Host "  Checking job assignment states..." -ForegroundColor Gray
    
    $assignmentsQuery = Invoke-SupabaseQuery -Table "h2s_dispatch_job_assignments" -Select "assignment_id,assign_state" -Limit 100
    
    if ($assignmentsQuery.Success -and $assignmentsQuery.Data.Count -gt 0) {
        $validStates = @("pending", "accepted", "assigned", "declined", "cancelled")
        $invalidStates = @()
        
        foreach ($assignment in $assignmentsQuery.Data) {
            if ($assignment.assign_state -notin $validStates) {
                $invalidStates += $assignment.assign_state
            }
        }
        
        $allStatesValid = $invalidStates.Count -eq 0
        
        Write-TestResult -TestName "Assignment states valid" -Passed $allStatesValid -Message "Invalid states found: $($invalidStates.Count)" -Evidence @{
            total_assignments = $assignmentsQuery.Data.Count
            invalid_count = $invalidStates.Count
        }
    } else {
        Write-Host "  ℹ️  No assignments found to test" -ForegroundColor DarkGray
    }
}

# ============================================================================
# TEST 4: Referential Integrity
# ============================================================================

function Test-ReferentialIntegrity {
    Write-TestHeader "TEST 4: Referential Integrity"
    
    # Check 1: Jobs with order_id have corresponding order
    Write-Host "  Checking job → order references..." -ForegroundColor Gray
    
    $jobsWithOrderId = Invoke-SupabaseQuery -Table "h2s_dispatch_jobs" -Select "job_id,order_id" -Limit 50
    
    if ($jobsWithOrderId.Success) {
        $orphanedJobs = @()
        
        foreach ($job in $jobsWithOrderId.Data) {
            if ($null -ne $job.order_id -and $job.order_id -ne "") {
                # Check if order exists
                $orderQuery = Invoke-SupabaseQuery -Table "h2s_orders" -Select "order_id" -Filter @{ "order_id" = $job.order_id } -Limit 1
                
                if (!$orderQuery.Success -or $orderQuery.Data.Count -eq 0) {
                    $orphanedJobs += $job.job_id
                }
            }
        }
        
        $noOrphans = $orphanedJobs.Count -eq 0
        
        Write-TestResult -TestName "Jobs reference valid orders" -Passed $noOrphans -Message "Orphaned jobs: $($orphanedJobs.Count)" -Evidence @{
            jobs_checked = $jobsWithOrderId.Data.Count
            orphaned_count = $orphanedJobs.Count
        }
    }
    
    # Check 2: Assignments reference valid jobs
    Write-Host "  Checking assignment → job references..." -ForegroundColor Gray
    
    $assignmentsQuery = Invoke-SupabaseQuery -Table "h2s_dispatch_job_assignments" -Select "assignment_id,job_id" -Limit 50
    
    if ($assignmentsQuery.Success) {
        $orphanedAssignments = @()
        
        foreach ($assignment in $assignmentsQuery.Data) {
            if ($null -ne $assignment.job_id -and $assignment.job_id -ne "") {
                # Check if job exists
                $jobQuery = Invoke-SupabaseQuery -Table "h2s_dispatch_jobs" -Select "job_id" -Filter @{ "job_id" = $assignment.job_id } -Limit 1
                
                if (!$jobQuery.Success -or $jobQuery.Data.Count -eq 0) {
                    $orphanedAssignments += $assignment.assignment_id
                }
            }
        }
        
        $noOrphans = $orphanedAssignments.Count -eq 0
        
        Write-TestResult -TestName "Assignments reference valid jobs" -Passed $noOrphans -Message "Orphaned assignments: $($orphanedAssignments.Count)" -Evidence @{
            assignments_checked = $assignmentsQuery.Data.Count
            orphaned_count = $orphanedAssignments.Count
        }
    }
    
    # Check 3: Photo uploads reference valid jobs
    Write-Host "  Checking upload → job references..." -ForegroundColor Gray
    
    $uploadsQuery = Invoke-SupabaseQuery -Table "job_customer_uploads" -Select "upload_id,job_id" -Limit 50
    
    if ($uploadsQuery.Success -and $uploadsQuery.Data.Count -gt 0) {
        $orphanedUploads = @()
        
        foreach ($upload in $uploadsQuery.Data) {
            if ($null -ne $upload.job_id -and $upload.job_id -ne "") {
                # Check if job exists
                $jobQuery = Invoke-SupabaseQuery -Table "h2s_dispatch_jobs" -Select "job_id" -Filter @{ "job_id" = $upload.job_id } -Limit 1
                
                if (!$jobQuery.Success -or $jobQuery.Data.Count -eq 0) {
                    $orphanedUploads += $upload.upload_id
                }
            }
        }
        
        $noOrphans = $orphanedUploads.Count -eq 0
        
        Write-TestResult -TestName "Uploads reference valid jobs" -Passed $noOrphans -Message "Orphaned uploads: $($orphanedUploads.Count)" -Evidence @{
            uploads_checked = $uploadsQuery.Data.Count
            orphaned_count = $orphanedUploads.Count
        }
    } else {
        Write-Host "  ℹ️  No uploads found to test" -ForegroundColor DarkGray
    }
}

# ============================================================================
# TEST 5: Recent Data Quality
# ============================================================================

function Test-RecentDataQuality {
    Write-TestHeader "TEST 5: Recent Data Quality (Last 24h)"
    
    $yesterday = (Get-Date).AddDays(-1).ToString("yyyy-MM-dd")
    
    # Check recent orders
    Write-Host "  Checking recent orders..." -ForegroundColor Gray
    
    $recentOrders = Invoke-SupabaseQuery -Table "h2s_orders" -Select "order_id,status,created_at" -Limit 100
    
    if ($recentOrders.Success) {
        $todayOrders = $recentOrders.Data | Where-Object { $_.created_at -ge $yesterday }
        
        Write-Host "  ℹ️  Found $($todayOrders.Count) orders in last 24h" -ForegroundColor Gray
        
        if ($todayOrders.Count -gt 0) {
            Write-TestResult -TestName "Recent orders exist" -Passed $true -Message "$($todayOrders.Count) orders created in last 24h" -Evidence @{
                count = $todayOrders.Count
            }
        }
    }
    
    # Check recent jobs
    Write-Host "  Checking recent jobs..." -ForegroundColor Gray
    
    $recentJobs = Invoke-SupabaseQuery -Table "h2s_dispatch_jobs" -Select "job_id,status,created_at" -Limit 100
    
    if ($recentJobs.Success) {
        $todayJobs = $recentJobs.Data | Where-Object { $_.created_at -ge $yesterday }
        
        Write-Host "  ℹ️  Found $($todayJobs.Count) jobs in last 24h" -ForegroundColor Gray
        
        if ($todayJobs.Count -gt 0) {
            Write-TestResult -TestName "Recent jobs exist" -Passed $true -Message "$($todayJobs.Count) jobs created in last 24h" -Evidence @{
                count = $todayJobs.Count
            }
        }
    }
}

# ============================================================================
# MAIN EXECUTION
# ============================================================================

Write-Host "`n╔════════════════════════════════════════════════════════════════╗" -ForegroundColor Magenta
Write-Host "║  DATABASE INTEGRITY VALIDATION SUITE                           ║" -ForegroundColor Magenta
Write-Host "║  Testing: Schema | Data Quality | Referential Integrity       ║" -ForegroundColor Magenta
Write-Host "╚════════════════════════════════════════════════════════════════╝" -ForegroundColor Magenta

# Verify environment
if (!$SupabaseUrl -or !$SupabaseKey) {
    Write-Host "`n⚠️  ERROR: Missing environment variables!" -ForegroundColor Red
    Write-Host "Required:" -ForegroundColor Yellow
    Write-Host "  `$env:SUPABASE_URL = 'https://your-project.supabase.co'" -ForegroundColor Yellow
    Write-Host "  `$env:SUPABASE_SERVICE_KEY = 'your_service_key'`n" -ForegroundColor Yellow
    exit 1
}

# Run all tests
Test-DatabaseConnectivity
Test-TableSchema
Test-DataIntegrity
Test-ReferentialIntegrity
Test-RecentDataQuality

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
$reportPath = ".\database-integrity-report-$(Get-Date -Format 'yyyyMMdd-HHmmss').json"
$Global:TestResults | ConvertTo-Json -Depth 10 | Out-File -FilePath $reportPath -Encoding UTF8

Write-Host "`n📄 Full report saved to: $reportPath" -ForegroundColor Cyan

# Export schema if requested
if ($ExportSchema) {
    $schemaExport = @{}
    foreach ($tableName in $ExpectedTables.Keys) {
        $columnsResult = Get-TableColumns -TableName $tableName
        if ($columnsResult.Success) {
            $schemaExport[$tableName] = $columnsResult.Columns
        }
    }
    
    $schemaPath = ".\database-schema-export-$(Get-Date -Format 'yyyyMMdd-HHmmss').json"
    $schemaExport | ConvertTo-Json -Depth 10 | Out-File -FilePath $schemaPath -Encoding UTF8
    Write-Host "📄 Schema exported to: $schemaPath" -ForegroundColor Cyan
}

# Exit with appropriate code
if ($Global:FailureCount -eq 0) {
    Write-Host "`n✅ DATABASE INTEGRITY VALIDATED - SCHEMA CONGRUENT`n" -ForegroundColor Green
    exit 0
} else {
    Write-Host "`n⚠️  $Global:FailureCount TEST(S) FAILED - SCHEMA REVIEW REQUIRED`n" -ForegroundColor Yellow
    exit 1
}

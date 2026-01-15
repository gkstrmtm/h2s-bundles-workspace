# CRITICAL REQUIREMENTS FOR JOB CREATION TO WORK

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "JOB CREATION REQUIREMENTS CHECKLIST" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

Write-Host "For a job to be created successfully, ALL of these must be TRUE:`n" -ForegroundColor Yellow

Write-Host "1. DATABASE CONNECTIVITY" -ForegroundColor White
Write-Host "   [REQUIRED] getSupabaseDb1() OR getSupabase() must return valid client" -ForegroundColor Gray
Write-Host "   [REQUIRED] getSupabaseDispatch() must return valid client OR fallback to main client" -ForegroundColor Gray
Write-Host ""

Write-Host "2. h2s_orders TABLE (Order Created First)" -ForegroundColor White
Write-Host "   [REQUIRED] order_id: Unique identifier (e.g., 'ORD-E536001B')" -ForegroundColor Gray
Write-Host "   [REQUIRED] session_id: Stripe checkout session ID" -ForegroundColor Gray
Write-Host "   [REQUIRED] customer_email: Valid email address" -ForegroundColor Gray
Write-Host "   [REQUIRED] items: Array of order items" -ForegroundColor Gray
Write-Host "   [REQUIRED] metadata_json: JSONB with customer/service details" -ForegroundColor Gray
Write-Host "   [REQUIRED] status: 'pending', 'paid', 'completed'" -ForegroundColor Gray
Write-Host ""

Write-Host "3. h2s_recipients TABLE (Created/Found Before Job)" -ForegroundColor White
Write-Host "   [REQUIRED] recipient_id: UUID (must exist or be created)" -ForegroundColor Gray
Write-Host "   [REQUIRED] email_normalized: Customer email (lowercase)" -ForegroundColor Gray
Write-Host "   [REQUIRED] recipient_key: Unique key (e.g., 'customer-UUID')" -ForegroundColor Gray
Write-Host "   [OPTIONAL] first_name: Customer name" -ForegroundColor Gray
Write-Host ""

Write-Host "4. h2s_dispatch_jobs TABLE (The Critical Insert)" -ForegroundColor White
Write-Host "   [REQUIRED] job_id: Auto-generated UUID by database" -ForegroundColor Gray
Write-Host "   [REQUIRED] recipient_id: FK to h2s_recipients (CANNOT BE NULL)" -ForegroundColor Red
Write-Host "   [REQUIRED] sequence_id: FK to sequences table" -ForegroundColor Gray
Write-Host "              Default: '88297425-c134-4a51-8450-93cb35b1b3cb'" -ForegroundColor DarkGray
Write-Host "   [REQUIRED] step_id: FK to steps table" -ForegroundColor Gray
Write-Host "              Default: 'd30da333-3a54-4598-8ac1-f3b276185ea1'" -ForegroundColor DarkGray
Write-Host "   [REQUIRED] status: 'queued', 'scheduled', 'in_progress', 'completed'" -ForegroundColor Gray
Write-Host "   [REQUIRED] job_details: Text description (CANNOT BE EMPTY)" -ForegroundColor Red
Write-Host "   [REQUIRED] customer_name: Customer full name" -ForegroundColor Gray
Write-Host "   [REQUIRED] service_address: Full street address" -ForegroundColor Gray
Write-Host "   [REQUIRED] order_id: FK link back to h2s_orders" -ForegroundColor Red
Write-Host "   [REQUIRED] created_at: ISO timestamp" -ForegroundColor Gray
Write-Host "   [REQUIRED] due_at: ISO timestamp" -ForegroundColor Gray
Write-Host "   [OPTIONAL] service_city, service_state, service_zip" -ForegroundColor Gray
Write-Host "   [OPTIONAL] metadata: JSONB with full order details" -ForegroundColor Gray
Write-Host ""

Write-Host "5. FOREIGN KEY CONSTRAINTS (Database Level)" -ForegroundColor White
Write-Host "   [REQUIRED] sequence_id must exist in sequences table" -ForegroundColor Red
Write-Host "   [REQUIRED] step_id must exist in steps table" -ForegroundColor Red
Write-Host "   [REQUIRED] recipient_id must exist in h2s_recipients table" -ForegroundColor Red
Write-Host "   [OPTIONAL] Unique constraint on (recipient_id, step_id)?" -ForegroundColor Yellow
Write-Host ""

Write-Host "6. LINKAGE (Bi-directional Reference)" -ForegroundColor White
Write-Host "   [CRITICAL] Job must have order_id pointing to h2s_orders.order_id" -ForegroundColor Red
Write-Host "   [CRITICAL] Order metadata_json should update with dispatch_job_id" -ForegroundColor Red
Write-Host "              This happens AFTER job creation succeeds" -ForegroundColor DarkGray
Write-Host ""

Write-Host "7. CODE EXECUTION PATH" -ForegroundColor White
Write-Host "   [REQUIRED] __action='create_checkout_session' must be sent from frontend" -ForegroundColor Gray
Write-Host "   [REQUIRED] Order insert must succeed first" -ForegroundColor Gray
Write-Host "   [REQUIRED] Job creation try-catch must NOT throw exception" -ForegroundColor Gray
Write-Host "   [REQUIRED] dispatch client must be truthy (not null/undefined)" -ForegroundColor Red
Write-Host "   [REQUIRED] Recipient creation/lookup must succeed" -ForegroundColor Red
Write-Host "   [REQUIRED] Job insert must not return error from Supabase" -ForegroundColor Red
Write-Host ""

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "COMMON FAILURE POINTS" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

Write-Host "IF job_id is NULL in order metadata:" -ForegroundColor Red
Write-Host "  1. recipient_id creation/lookup failed" -ForegroundColor Yellow
Write-Host "  2. sequence_id or step_id don't exist in database" -ForegroundColor Yellow
Write-Host "  3. job_details is empty string (constraint violation)" -ForegroundColor Yellow
Write-Host "  4. Foreign key constraint failed" -ForegroundColor Yellow
Write-Host "  5. Unique constraint (recipient_id, step_id) collision" -ForegroundColor Yellow
Write-Host "  6. dispatch client is null/undefined" -ForegroundColor Yellow
Write-Host "  7. Database permissions issue on h2s_dispatch_jobs" -ForegroundColor Yellow
Write-Host "  8. Exception thrown in job creation code path" -ForegroundColor Yellow
Write-Host ""

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "TESTING APPROACH" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

Write-Host "1. Create order -> Check if order exists in h2s_orders" -ForegroundColor White
Write-Host "2. Check if recipient was created in h2s_recipients" -ForegroundColor White
Write-Host "3. Check Vercel logs for [Checkout] error messages" -ForegroundColor White
Write-Host "4. Verify sequence_id/step_id exist in their tables" -ForegroundColor White
Write-Host "5. Check if dispatch client is available (logs should show)" -ForegroundColor White
Write-Host "6. Look for Supabase error code/message in logs" -ForegroundColor White
Write-Host ""

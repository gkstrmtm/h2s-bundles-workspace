# Create order directly in database (bypasses Stripe for testing)
Write-Host "`n=== Creating Test Order (Direct DB Insert) ===" -ForegroundColor Cyan

$testEmail = "direct.test$(Get-Random)@example.com"
$orderId = "ORD-DIRECT$(Get-Random -Minimum 1000 -Maximum 9999)"

# Call an API that creates the order directly (we need to add this endpoint)
Write-Host "`nNOTE: This requires a special test endpoint that doesn't exist yet." -ForegroundColor Yellow
Write-Host "      The endpoint would insert directly into h2s_orders with full metadata." -ForegroundColor Gray

Write-Host "`nALTERNATIVE SOLUTION:" -ForegroundColor Cyan
Write-Host "Test the new code by:" -ForegroundColor White
Write-Host "1. Create checkout session (already working)" -ForegroundColor Gray
Write-Host "2. Complete payment at: shop.home2smart.com/bundles" -ForegroundColor Gray
Write-Host "3. Stripe webhook will fire with NEW code" -ForegroundColor Gray
Write-Host "4. Order will have metadata with job_details" -ForegroundColor Gray
Write-Host "5. Scheduling will work" -ForegroundColor Gray

Write-Host "`nOR create a test endpoint at /api/test-create-order that:" -ForegroundColor Cyan
Write-Host "- Accepts: customer, cart, metadata" -ForegroundColor Gray
Write-Host "- Inserts order directly into h2s_orders" -ForegroundColor Gray
Write-Host "- Returns order_id for scheduling" -ForegroundColor Gray

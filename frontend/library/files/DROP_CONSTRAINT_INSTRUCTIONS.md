# FINAL CONSTRAINT FIX

## YOUR SUPABASE DATABASE
**URL:** https://ulbzmgmxrqyipclrbohi.supabase.co

## THE PROBLEM
The constraint `h2s_dispatch_jobs_recipient_step_uq` still exists in THIS database.

## WHAT TO DO

1. Go to: https://supabase.com/dashboard/project/ulbzmgmxrqyipclrbohi/sql/new

2. Run this EXACT SQL:

```sql
ALTER TABLE h2s_dispatch_jobs 
DROP CONSTRAINT h2s_dispatch_jobs_recipient_step_uq;
```

3. After it runs, verify it's gone:

```sql
SELECT conname 
FROM pg_constraint 
WHERE conrelid = 'h2s_dispatch_jobs'::regclass
  AND conname = 'h2s_dispatch_jobs_recipient_step_uq';
```

Should return: **(no rows)**

## THEN TEST
After dropping the constraint, run this:

```powershell
$email = "verify-fix-$(Get-Random)@test.com"
$r1 = Invoke-RestMethod -Uri "https://h2s-backend.vercel.app/api/shop" -Method POST -Body "{`"__action`":`"create_checkout_session`",`"customer`":{`"email`":`"$email`",`"name`":`"Test`",`"phone`":`"555-0100`"},`"cart`":[{`"bundle_id`":`"bnd-welcome-to-h2s`",`"name`":`"Test`",`"price`":999,`"quantity`":1}],`"promotion_code`":`"`",`"success_url`":`"https://example.com/success`",`"cancel_url`":`"https://example.com/cancel`"}" -ContentType "application/json"
Write-Host "Order 1: $($r1.order_id)"

Start-Sleep 2

$r2 = Invoke-RestMethod -Uri "https://h2s-backend.vercel.app/api/shop" -Method POST -Body "{`"__action`":`"create_checkout_session`",`"customer`":{`"email`":`"$email`",`"name`":`"Test`",`"phone`":`"555-0100`"},`"cart`":[{`"bundle_id`":`"bnd-welcome-to-h2s`",`"name`":`"Test`",`"price`":999,`"quantity`":1}],`"promotion_code`":`"`",`"success_url`":`"https://example.com/success`",`"cancel_url`":`"https://example.com/cancel`"}" -ContentType "application/json"
Write-Host "Order 2: $($r2.order_id)"

if ($r1.ok -and $r2.ok) {
    Write-Host "✅ BOTH ORDERS SUCCEEDED - CONSTRAINT REMOVED!" -ForegroundColor Green
} else {
    Write-Host "❌ STILL FAILING - CONSTRAINT STILL THERE" -ForegroundColor Red
}
```

## THAT'S IT
Just drop the constraint in the Supabase SQL Editor for project **ulbzmgmxrqyipclrbohi**.

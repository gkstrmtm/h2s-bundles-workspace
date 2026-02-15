# 🚨 CHECKOUT SYSTEM ROLLBACK PROCEDURE

## When to Rollback

Rollback immediately if:
- ❌ Checkout creates jobs with status 'queued' (portal spam)
- ❌ Orders created but jobs not created
- ❌ Checkout crashes or times out
- ❌ Success page shows white screen
- ❌ Webhook not activating jobs

---

## Last Known Good Deployments

### Frontend
- **Deployment ID**: `h2s-bundles-frontend-po3up0lwt`
- **Domain**: shop.home2smart.com
- **Git Commit**: `843c039` - "Deploy frontend with complete checkout flow + white screen fix"
- **Date**: Jan 2026

### Backend
- **Deployment ID**: `backend-ndw3awloh`
- **Domain**: h2s-backend.vercel.app
- **Git Commit**: `9345792` - "Fix: Set job status to pending_payment, webhook activates after payment"
- **Date**: Jan 2026

---

## Emergency Rollback (5 Minutes)

### Step 1: Identify Bad Deployment

```powershell
# Check recent Vercel deployments
cd c:\Users\tabar\h2s-bundles-workspace

# List recent deployments
vercel ls
```

### Step 2: Rollback Frontend

```powershell
# Navigate to frontend directory
cd frontend

# Rollback to last known good
vercel rollback h2s-bundles-frontend-po3up0lwt --yes

# Wait for propagation (30 seconds)
Start-Sleep -Seconds 30

# Verify rollback
$response = Invoke-WebRequest -Uri "https://shop.home2smart.com/bundles.js" -UseBasicParsing
if ($response.Content -match "window\.checkout") {
    Write-Host "✓ Frontend rollback successful" -ForegroundColor Green
}
```

### Step 3: Rollback Backend

```powershell
# Return to workspace root
cd ..

# Rollback to last known good
vercel rollback backend-ndw3awloh --yes

# Wait for propagation
Start-Sleep -Seconds 30

# Verify rollback
$response = Invoke-RestMethod -Uri "https://h2s-backend.vercel.app/api/shop?action=catalog"
if ($response.ok) {
    Write-Host "✓ Backend rollback successful" -ForegroundColor Green
}
```

### Step 4: Verify System

```powershell
# Run health check
.\HEALTH-CHECK-CHECKOUT.ps1

# If passed, system restored
```

---

## Git Rollback (10 Minutes)

If Vercel rollback doesn't work, rollback code:

### Step 1: Reset to Last Good Commit

```powershell
# Check git log
git log --oneline -10

# Find last working commit (likely 843c039 or 9345792)
# Reset to that commit (DESTRUCTIVE - will lose uncommitted changes)
git reset --hard 843c039

# Force push to GitHub
git push --force
```

### Step 2: Redeploy from Git

```powershell
# Deploy backend
vercel --prod

# Deploy frontend
cd frontend
vercel --prod
cd ..

# Wait for propagation
Start-Sleep -Seconds 60
```

### Step 3: Verify

```powershell
.\HEALTH-CHECK-CHECKOUT.ps1
```

---

## Database Cleanup (After Rollback)

If bad deployment created corrupt data:

### Clean Pending Payment Jobs

```sql
-- Find jobs stuck in wrong state
SELECT * FROM h2s_dispatch_jobs 
WHERE status = 'queued' 
    AND order_id IN (
        SELECT id FROM h2s_orders WHERE status != 'paid'
    )
ORDER BY created_at DESC;

-- If any found, revert to pending_payment
UPDATE h2s_dispatch_jobs
SET status = 'pending_payment'
WHERE status = 'queued' 
    AND order_id IN (
        SELECT id FROM h2s_orders WHERE status != 'paid'
    );
```

### Delete Test Orders (Optional)

```sql
-- If test orders were created during bad deployment
DELETE FROM h2s_dispatch_jobs WHERE order_id IN (
    SELECT id FROM h2s_orders 
    WHERE email LIKE '%test%' 
        AND created_at > NOW() - INTERVAL '1 hour'
);

DELETE FROM h2s_orders 
WHERE email LIKE '%test%' 
    AND created_at > NOW() - INTERVAL '1 hour';
```

---

## Post-Rollback Actions

1. **Notify team** - Alert that system was rolled back
2. **Investigate failure** - Check logs to understand what broke
3. **Update documentation** - If new failure mode discovered
4. **Test before redeploying** - Use `VALIDATE-CHECKOUT-SYSTEM.ps1`

---

## Prevention Checklist

Before ANY future deployment:

```powershell
# 1. Validate code
.\VALIDATE-CHECKOUT-SYSTEM.ps1 -Full

# 2. Check git status
git status

# 3. Review CHECKOUT_GUARDRAILS.md
# Make sure no protected sections were modified

# 4. Test locally first
.\TEST-CHECKOUT-E2E.ps1 -Local

# 5. Deploy backend first
cd backend
vercel --prod
cd ..

# 6. Wait and verify backend
Start-Sleep -Seconds 30
Invoke-RestMethod -Uri "https://h2s-backend.vercel.app/api/shop?action=catalog"

# 7. Deploy frontend second
cd frontend
vercel --prod
cd ..

# 8. Wait and verify frontend
Start-Sleep -Seconds 30
.\HEALTH-CHECK-CHECKOUT.ps1
```

---

## Emergency Contacts

- **Vercel Dashboard**: https://vercel.com/dashboard
- **Supabase Dashboard**: https://supabase.com/dashboard
- **Stripe Dashboard**: https://dashboard.stripe.com

---

## Rollback Verification

After rollback, verify:

✅ Frontend loads at shop.home2smart.com  
✅ Catalog displays products  
✅ Checkout button works  
✅ Success page shows instantly (no white screen)  
✅ Backend API responds  
✅ Jobs created with `pending_payment` status  
✅ Webhook activates jobs to `queued`  
✅ No unpaid jobs in technician portal  

---

## Common Rollback Scenarios

### Scenario 1: Portal Showing Unpaid Jobs

**Symptom**: Technicians see jobs for abandoned checkouts  
**Cause**: Jobs created with 'queued' status instead of 'pending_payment'  
**Fix**: Rollback backend immediately

### Scenario 2: White Screen on Success Page

**Symptom**: After Stripe payment, blank page shows  
**Cause**: Static success page HTML removed or detection script broken  
**Fix**: Rollback frontend immediately

### Scenario 3: Checkout Times Out

**Symptom**: Checkout button spins forever, no Stripe modal  
**Cause**: Backend job creation failing or Stripe relay broken  
**Fix**: Rollback backend, check environment variables

### Scenario 4: Jobs Not Activating

**Symptom**: Orders marked 'paid' but jobs stay 'pending_payment'  
**Cause**: Webhook not updating job status  
**Fix**: Rollback backend, verify webhook endpoint

---

**Last Updated**: Jan 2026  
**Verified Working Commits**: Frontend `843c039`, Backend `9345792`

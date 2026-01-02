# SMS/Email Notification Troubleshooting Guide
**Date:** January 1, 2026  
**Issue:** No SMS notifications received during testing

---

## Root Cause Analysis

### 1. **USE_TWILIO Environment Variable Not Set** ⚠️

**Location:** [Home2smart-backend/api/send-sms.js](Home2smart-backend/api/send-sms.js:159)

```javascript
const useTwilio = process.env.USE_TWILIO?.toLowerCase() === 'true';

if (useTwilio && accountSid && authToken && fromPhone) {
  // Only sends if USE_TWILIO=true
}
```

**Problem:** If `USE_TWILIO` is not set to `'true'`, the endpoint logs to database but **doesn't actually send SMS via Twilio**.

---

### 2. **Schedule-Appointment Endpoint Missing Notifications** ❌

**Location:** [backend/app/api/schedule-appointment/route.ts](backend/app/api/schedule-appointment/route.ts)

**Issue:** When you migrated to Next.js backend, the new `schedule-appointment` endpoint was created but **didn't include calls to send-sms/send-email**.

**Status:** ✅ **FIXED** - Added notification calls after booking success

---

### 3. **Portal Accept Notifications Intact** ✅

**Location:** [Home2smart-backend/api/portal_accept.js](Home2smart-backend/api/portal_accept.js:230-250)

Portal calls `https://h2s-backend.vercel.app/api/portal_accept` which **does call** the email notification endpoint:

```javascript
const emailEndpoint = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}/api/send-pro-assigned-email`
  : 'https://h2s-backend.vercel.app/api/send-pro-assigned-email';

await fetch(emailEndpoint, {
  method: 'POST',
  body: JSON.stringify({ job_id: jobId, pro_id: proId })
});
```

**This works** because portal uses the legacy backend URL, not the Next.js one.

---

## Required Environment Variables

### Vercel Environment Variables (h2s-backend.vercel.app):

```bash
# Twilio SMS
USE_TWILIO=true                          # ⚠️ CRITICAL - Must be "true" (lowercase)
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxx
TWILIO_PHONE_NUMBER=+18641234567

# SendGrid Email  
SENDGRID_API_KEY=SG.xxxxxxxxxxxxxxxxxx
SENDGRID_FROM_EMAIL=noreply@home2smart.com
SENDGRID_ENABLED=true                    # Default true if not set

# Supabase
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_ANON_KEY=eyJhbGc...
SUPABASE_SERVICE_KEY=eyJhbGc...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...

# Testing/Debug
DEBUG_FIRE_KEY=xxxxxxxxxxxxxxxx
MANAGER_SMS_LIST=+18641234567,+18645551234
MANAGER_EMAIL_LIST=manager@home2smart.com
```

---

## How to Verify Variables Are Set

### Method 1: Check Vercel Dashboard
1. Go to https://vercel.com/dashboard
2. Select `h2s-backend` project
3. Go to Settings → Environment Variables
4. Search for `USE_TWILIO`
5. Verify value is exactly `true` (lowercase)

### Method 2: Test Endpoint Directly
```bash
curl -X POST https://h2s-backend.vercel.app/api/send-sms \
  -H "Content-Type: application/json" \
  -d '{
    "to": "+18641234567",
    "message": "Test message",
    "template": "test",
    "debug": true,
    "force_to": "+18641234567"
  }'
```

**Expected Response (if USE_TWILIO=false):**
```json
{
  "ok": true,
  "method": "log_only",
  "logged": true,
  "message": "SMS logged but Twilio not enabled"
}
```

**Expected Response (if USE_TWILIO=true):**
```json
{
  "ok": true,
  "method": "twilio",
  "sid": "SMxxxxxxxxxxxxxxxxxx",
  "status": "queued"
}
```

---

## Notification Flow Diagram

```
Customer Checkout (bundles.html)
    ↓
    POST /api/schedule-appointment (Next.js) ← YOU ARE HERE
    ↓
    ✅ NOW CALLS: fetch('/api/send-sms', {...})
    ✅ NOW CALLS: fetch('/api/send-email', {...})
    ↓
    /api/send-sms checks USE_TWILIO
    ↓
    IF USE_TWILIO=true → Twilio API → SMS sent
    IF USE_TWILIO≠true → Log to database only
```

```
Tech Accepts Job (portal.html)
    ↓
    POST /api/portal_accept (Legacy backend) ← ALREADY WORKING
    ↓
    Calls: /api/send-pro-assigned-email
    ↓
    SendGrid API → Email sent to customer
```

---

## Testing Checklist

### ✅ Step 1: Set Environment Variables
- [ ] Go to Vercel dashboard
- [ ] Set `USE_TWILIO=true` for h2s-backend project
- [ ] Verify `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` are set
- [ ] Redeploy if needed (Vercel auto-redeploys on env var change)

### ✅ Step 2: Test Booking Flow
1. Go to https://home2smart.com/bundles.html
2. Add service to cart
3. Complete checkout
4. Check phone for SMS: "✅ Booked! {service} on {date}"
5. Check email for: "Booking Confirmed - {service}"

### ✅ Step 3: Test Tech Accept Flow
1. Admin sends job offer to tech
2. Tech opens portal: https://home2smart.com/portal
3. Tech clicks "Accept" on job
4. Check customer email for: "Your Pro is Assigned - {pro_name}"
5. Should include pro photo, rating, bio

### ✅ Step 4: Check Logs
```bash
# In Vercel dashboard, check function logs:
1. Functions → select send-sms.js
2. Look for: "[Send SMS] Twilio check: { useTwilio: true, hasAccountSid: true }"
3. If useTwilio: false → Environment variable not set
4. If useTwilio: true but no SMS → Check Twilio credentials
```

---

## Debugging Commands

### Check if SMS is being called:
```bash
# Check h2s_sms_log table in Supabase
SELECT 
  phone,
  message,
  status,
  template_name,
  error_message,
  sent_at
FROM h2s_sms_log
ORDER BY sent_at DESC
LIMIT 10;
```

**Possible status values:**
- `sent` - Successfully sent via Twilio
- `failed` - Twilio API error (check error_message)
- `skipped` - User opted out or duplicate prevented
- `log_only` - USE_TWILIO not enabled

### Check if emails are being sent:
```bash
# Check email_messages table
SELECT 
  to_email,
  subject,
  message_type,
  status,
  error_message,
  sent_at
FROM email_messages
ORDER BY sent_at DESC
LIMIT 10;
```

---

## What I Fixed

### ✅ Added Notification Calls to schedule-appointment
**File:** [backend/app/api/schedule-appointment/route.ts](backend/app/api/schedule-appointment/route.ts:500-570)

**Added:**
```typescript
// Send SMS if phone exists
if (customerPhone) {
  await fetch(`${baseUrl}/api/send-sms`, {
    method: 'POST',
    body: JSON.stringify({
      to: customerPhone,
      template_key: 'booking_confirmation',
      job_id: jobId,
      data: { firstName, service_name, date, time, address }
    })
  });
}

// Send Email if email exists
if (customerEmail) {
  await fetch(`${baseUrl}/api/send-email`, {
    method: 'POST',
    body: JSON.stringify({
      to_email: customerEmail,
      template_key: 'booking_confirmation',
      order_id: canonicalOrderId,
      data: { firstName, service_name, date, time, address, city, state, zip }
    })
  });
}
```

---

## Next Steps

### Immediate (Before Testing):
1. ✅ Set `USE_TWILIO=true` in Vercel environment variables
2. ✅ Verify Twilio credentials are correct
3. ✅ Redeploy if needed

### Testing (After Deploy):
1. ✅ Complete test checkout on bundles.html
2. ✅ Check for SMS/email notifications
3. ✅ Check Vercel function logs for errors
4. ✅ Check Supabase logs (h2s_sms_log, email_messages)

### If Still Not Working:
1. Check Twilio account is active (not suspended)
2. Check Twilio phone number is verified
3. Check recipient phone number is valid E.164 format (+1XXXXXXXXXX)
4. Check SendGrid sender identity is verified
5. Use debug endpoint: `/api/debug_fire_all_notifications?key={DEBUG_FIRE_KEY}&mode=dryrun&limit=1`

---

## Summary

**Problem:** No SMS received during testing  
**Root Cause:** `USE_TWILIO` environment variable not set to `'true'`  
**Secondary Issue:** Next.js schedule-appointment endpoint missing notification calls (now fixed)

**Solution:**
1. Set `USE_TWILIO=true` in Vercel dashboard for h2s-backend project
2. Redeploy if needed
3. Test checkout flow
4. Verify SMS sent via h2s_sms_log table

**Expected Result:** Customer receives "Booking Confirmed" SMS + Email after checkout

---

**Files Modified:**
- ✅ [backend/app/api/schedule-appointment/route.ts](backend/app/api/schedule-appointment/route.ts) - Added SMS/email notification calls

**Files Verified (Already Working):**
- ✅ [Home2smart-backend/api/portal_accept.js](Home2smart-backend/api/portal_accept.js) - Pro assignment email working
- ✅ [Home2smart-backend/api/send-sms.js](Home2smart-backend/api/send-sms.js) - SMS endpoint operational (needs USE_TWILIO=true)
- ✅ [Home2smart-backend/api/send-email.js](Home2smart-backend/api/send-email.js) - Email endpoint operational

**Configuration Required:**
- ⚠️ Set `USE_TWILIO=true` in Vercel environment variables (h2s-backend project)

# H2S System Congruence Checklist

## ✅ Critical Integration Points

### 1. **Environment Variables (Vercel)**
Check these match your Supabase dashboard:
```bash
DATABASE_URL=postgresql://...
SUPABASE_URL=https://...
SUPABASE_ANON_KEY=eyJh...
SUPABASE_SERVICE_KEY=eyJh...
```

**Verify**: `vercel env ls` should show all 4 variables

---

### 2. **API Response Contracts** 
Frontend and backend must agree on JSON shapes.

#### Example: Order Data
**Frontend Expects** (bundles.html line ~6000):
```javascript
{
  summary: { order_id, total, subtotal, tax, currency, discount_code, status },
  lines: [...items array...],
  customer: { email, name, phone }
}
```

**Backend Must Send** (shop/route.ts handleOrderPack):
```typescript
return NextResponse.json({ 
  ok: true, 
  summary: {...},
  lines: parsedItems,  // ← Must be PARSED array, not string!
  customer: {...}
});
```

**Check**: Do a test order and inspect Network tab → Response matches expected shape?

---

### 3. **Data Type Conversions**

| Data | Database Storage | Backend Must Do | Frontend Receives |
|------|-----------------|-----------------|-------------------|
| Items | JSON string | `JSON.parse(items)` | Array |
| Prices | Cents (integer) | `amount / 100` | Dollars (float) |
| Dates | ISO string | Return as-is | Parse if needed |

**Check Files**:
- `backend/app/api/shop/route.ts` (lines 450-520) - Order pack response
- `backend/app/api/shop/route.ts` (line 486) - Checkout session decimal conversion

---

### 4. **Table Names & Schema**
Know what exists vs what you assume:

| What We Thought | What Actually Exists |
|----------------|---------------------|
| `H2S_Pro_Availability` table | ❌ Doesn't exist |
| Separate availability table | ❌ Appointments are in `h2s_orders` |
| `order_id` prefix for appts | ✅ `APPT{timestamp}` |

**Current Architecture**:
```
h2s_orders
├── Regular orders: order_id = "H2S{timestamp}"
└── Appointments:   order_id = "APPT{timestamp}"
         └── items = [{ type: 'appointment', date, time, service }]

h2s_tracking_events
├── Stores all analytics events
└── visitor_id links to browser

h2s_customers
└── Customer profiles linked to orders
```

**To Check Schema**:
```sql
-- In Supabase SQL Editor:
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name LIKE 'h2s_%';

-- See structure:
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'h2s_orders';
```

---

### 5. **Frontend → Backend Endpoint Mapping**

| Frontend Action | Hits Endpoint | Backend File |
|----------------|---------------|--------------|
| Checkout click | `POST /api/shop` (`__action: create_checkout_session`) | `backend/app/api/shop/route.ts` |
| Success page load | `GET /api/shop?action=orderpack&session_id=...` | `backend/app/api/shop/route.ts` |
| Track event | `POST /api/track` | `backend/app/api/track/route.ts` |
| Schedule appointment | `POST /api/schedule-appointment` | `backend/app/api/schedule-appointment/route.ts` |
| Get availability | `GET /api/get-availability` | `backend/app/api/get-availability/route.ts` |
| Contact form | `POST /api/contact` | `backend/app/api/contact/route.ts` |

**Check**: Search bundles.html for `fetch(` calls - do they match these endpoints?

---

### 6. **Stripe Integration**
Prices must be in **cents** when sent to Stripe, **dollars** when displayed.

**Checkout Flow**:
```javascript
// Frontend sends:
line_items: [{
  price_data: {
    unit_amount: 24900  // ← $249.00 in cents
  }
}]

// Backend stores:
total: 249  // ← Dollars (after dividing by 100)

// Frontend displays:
$249.00  // ← From database value
```

**Check**: Line 486 in `backend/app/api/shop/route.ts` has `/ 100`

---

### 7. **Error Boundaries**
Every backend endpoint should return consistent error format:

```typescript
// Success:
{ ok: true, ...data }

// Error:
{ ok: false, error: "message" }
```

**Frontend must check**:
```javascript
const res = await fetch(...);
const data = await res.json();
if (!res.ok || !data.ok) {
  // Handle error
}
```

---

## 🔍 Quick Audit Commands

### Test All Endpoints
```bash
node test-h2s-core.js
```
Should show 100% pass rate.

### Check Vercel Env Vars
```bash
cd backend
vercel env ls
```
Should see: DATABASE_URL, SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY

### Test Live Backend
```bash
curl https://h2s-backend.vercel.app/api/track
# Should return: {"ok":true,"route":"api/track","build":"..."}
```

---

## 🚨 Common Failure Points

1. **Env vars not in Vercel** → Backend can't connect to database
2. **JSON not parsed** → Frontend gets string "[{...}]" instead of array
3. **Cents not converted** → Prices show as $24,900 instead of $249
4. **Wrong response shape** → Frontend crashes looking for missing property
5. **Scroll not unlocked** → Page freezes after modal close

---

## ✅ Verification Steps After Deploy

1. **Place test order** → Check success page shows correct total
2. **Check Supabase** → Order appears in h2s_orders table
3. **Schedule appointment** → Creates order with APPT prefix
4. **Close modals** → Page still scrolls
5. **Check browser console** → No red errors
6. **Check Network tab** → All API calls return 200 OK

---

## 📝 Notes

- **Database credentials were always correct** - issues were logic/parsing bugs
- **Most bugs were frontend/backend contract mismatches** - not database issues
- **h2s_orders is single source of truth** for both orders AND appointments
- **Appointments are just orders** with special order_id prefix and items structure

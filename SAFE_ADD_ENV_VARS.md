# Safe Environment Variables - ADD ONLY (Don't Change Existing)

## 🛡️ Safe Approach: Add Missing Variables

**Rule**: DON'T change any existing variables. Only ADD what's missing.

## ✅ Variables That ARE Already Set (From Error Debug)
```
has_database_url: true
has_supabase_url: true  
has_service_key: true
```

This means Vercel already has:
- ✅ `DATABASE_URL` 
- ✅ `SUPABASE_URL`
- ✅ Some form of service key

## 🔍 Which Service Key Variable Names Are Accepted?

The code accepts **BOTH** of these names (checks for either):
1. `SUPABASE_SERVICE_KEY`
2. `SUPABASE_SERVICE_ROLE_KEY`

## 🎯 What to Check on Vercel

### Step 1: See What You Have
Go to: **Vercel Dashboard → h2s-backend → Settings → Environment Variables**

Look for these and note which ones exist:
- [ ] `DATABASE_URL`
- [ ] `SUPABASE_URL`
- [ ] `SUPABASE_SERVICE_KEY`
- [ ] `SUPABASE_SERVICE_ROLE_KEY`
- [ ] `SUPABASE_URL_DB1` (optional)
- [ ] `SUPABASE_SERVICE_KEY_DB1` (optional)
- [ ] `OPENAI_API_KEY` (optional - for AI features)

### Step 2: Add Missing Variables (Without Changing Existing)

#### If you DON'T have `SUPABASE_SERVICE_KEY`:
**ADD** this variable:
```
Name: SUPABASE_SERVICE_KEY
Value: [Your service_role key - starts with eyJhbGc...]
Environment: Production, Preview, Development
```

**Where to get it:**
- Supabase Dashboard → Project Settings → API
- Copy the **service_role** key (NOT anon key)

#### If you already have `SUPABASE_SERVICE_ROLE_KEY` instead:
**DO NOTHING** - The code accepts both names!

But to be safe, you could ADD the alternate name pointing to same value:
```
Name: SUPABASE_SERVICE_KEY
Value: [Same value as SUPABASE_SERVICE_ROLE_KEY]
Environment: Production, Preview, Development
```

### Step 3: Verify DATABASE_URL Format (Don't Change, Just Check)

Your existing `DATABASE_URL` should look like:
```
postgresql://postgres.xxxxx:[PASSWORD]@aws-0-us-west-1.pooler.supabase.com:5432/postgres
```

**If it looks right**: ✅ Leave it alone!

**If it's missing the password or looks wrong**: 
- Don't delete the existing one
- Get correct value from: Supabase → Settings → Database → Connection String → URI mode
- Update the existing variable with correct value

## 🔄 Optional: Add Separate Tracking DB Variables (If You Want)

If you want to use a separate database for tracking events:

```
SUPABASE_URL_DB1=[Your tracking database URL]
SUPABASE_SERVICE_KEY_DB1=[Your tracking database service_role key]
```

**But**: If both tables are in the SAME database (which you said they are), you DON'T need these!

## 🧪 Testing After Adding Variables

### Quick Test - Check What Variables Are Detected:
```bash
# This will show what the backend sees
curl "https://h2s-backend.vercel.app/api/v1?action=revenue"
```

Look for the debug section in error (if any):
```json
"debug": {
  "has_database_url": true,
  "has_supabase_url": true,
  "has_service_key": true
}
```

All should be `true`!

### Full Test - Run Comprehensive Test:
```bash
cd "C:\Users\tabar\Quick fix Dash"
node test-backend-comprehensive.js
```

Should now show:
- ✅ Revenue Analytics working
- ✅ Event tracking working
- ✅ All endpoints green

## 📋 Summary - What to ADD (Not Change)

### Minimum Required (if missing):
1. **Add** `SUPABASE_SERVICE_KEY` if you don't have it
   - Value: service_role key from Supabase (starts with `eyJhbGc...`)
   
### Optional (nice to have):
2. **Add** `OPENAI_API_KEY` if you want AI report features
   - Value: OpenAI API key (starts with `sk-...`)

### Already Set (leave alone):
- ✅ `DATABASE_URL` - Already working for h2s_tracking_events
- ✅ `SUPABASE_URL` - Already set
- ✅ Some service key - Just need to make sure it's the RIGHT one

## 🔍 How to Find Your Service Role Key

1. Go to: https://supabase.com/dashboard
2. Select your project
3. Click: **Settings** (gear icon on left sidebar)
4. Click: **API** (under Project Settings)
5. Scroll to: **Project API keys**
6. Find: **service_role** (NOT anon)
7. Click: **Copy** button
8. It should start with: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`

## ⚠️ Important Notes

1. **DON'T delete or change existing variables** - Only add missing ones
2. **service_role key ≠ anon key** - Make sure you're using service_role
3. **Same database?** - If h2s_orders and h2s_tracking_events are in same DB, you only need ONE set of credentials
4. **After adding**: Click "Redeploy" on your latest deployment to pick up new variables

## 🆘 If Still Broken After Adding

The issue might be the **VALUE** of an existing variable (not missing variable).

Safe way to test:
1. Copy the current value of `DATABASE_URL` 
2. Go to Supabase and get the correct connection string
3. Compare them
4. If different, update (but you're just fixing the value, not changing the variable name)

The error "Invalid API key" specifically means the **service_role key value** is wrong or you're using the anon key instead.

# Fix Vercel Environment Variables

## 🔍 The Problem
Your confusion is **justified**! Here's what's happening:

- `h2s_tracking_events` ✅ Working (returns 0 events)
- `h2s_orders` ❌ "Invalid API key" error

**BUT they're in the SAME Supabase database!**

## 🎯 Root Cause

The deployed Vercel code (which is DIFFERENT from GitHub) tries **3 methods** to query `h2s_orders`:

1. **Prisma Direct** (needs `DATABASE_URL`) ← Tries this first, FAILS
2. **PostgREST RPC** (needs `SUPABASE_SERVICE_KEY`) ← Falls back to this, gets "Invalid API key"
3. **Supabase View** (needs `SUPABASE_SERVICE_KEY`) ← Never reaches this

When Prisma fails, it falls back to PostgREST which needs the API key. That's why you see "Invalid API key" even though you set `DATABASE_URL`.

## ✅ The Fix

Go to: **Vercel Dashboard → h2s-backend → Settings → Environment Variables**

### Required Variables (all pointing to SAME database):

```bash
# Method 1: Direct Postgres (for Prisma)
DATABASE_URL="postgresql://postgres.xxxxx:PASSWORD@aws-0-us-west-1.pooler.supabase.com:5432/postgres"

# Method 2 & 3: Supabase API (fallback)
SUPABASE_URL="https://xxxxx.supabase.co"
SUPABASE_SERVICE_KEY="eyJhbGc...your-service-role-key" # NOT anon key!

# Optional: If tracking events in separate DB
SUPABASE_URL_DB1="https://xxxxx.supabase.co" 
SUPABASE_SERVICE_KEY_DB1="eyJhbGc...service-role-key"
```

### Where to Find These Values:

#### 1. DATABASE_URL
- Supabase Dashboard → Project Settings → Database
- Look for: **Connection String** → **URI** (not Session mode!)
- Copy the full string
- Replace `[YOUR-PASSWORD]` with your actual database password

#### 2. SUPABASE_URL
- Supabase Dashboard → Project Settings → API
- Look for: **Project URL**
- Example: `https://abcdefghijklmnop.supabase.co`

#### 3. SUPABASE_SERVICE_KEY
- Supabase Dashboard → Project Settings → API
- Look for: **Project API keys** → **service_role** (NOT anon!)
- Click "Copy" on the **service_role** key
- It should start with `eyJhbGc...`

## 🚨 Common Mistakes

❌ **Using `anon` key instead of `service_role` key**
- `anon` key has restrictions
- `service_role` key has full access (needed for backend)

❌ **DATABASE_URL password is wrong**
- Make sure you replaced `[YOUR-PASSWORD]`
- Password is the one you set when creating the Supabase project

❌ **Using Session mode connection string instead of URI**
- ❌ BAD: `postgresql://postgres.xxx?sslmode=require&pgbouncer=true`
- ✅ GOOD: `postgresql://postgres.xxx:5432/postgres`

## 🧪 After Fixing

1. **Save** the environment variables in Vercel
2. **Redeploy** the backend:
   - Vercel Dashboard → h2s-backend → Deployments → Click "..." on latest → Redeploy
3. **Test** the fix:
   ```bash
   node test-backend-comprehensive.js
   ```

You should now see:
- ✅ Revenue endpoint working
- ✅ Event tracking working  
- ✅ All endpoints at 100%

## 💡 Why This Happened

The **deployed code** on Vercel is **newer/different** than the GitHub code:

| Source | Revenue Query Method | Tables Used |
|--------|---------------------|-------------|
| **GitHub** (what we pulled) | h2s_tracking_events | Single table |
| **Vercel** (deployed) | h2s_orders | Separate table |

Your `intro doc.md` documentation matches the **Vercel deployment**, not the GitHub code!

This is why you were confused - the code you're looking at locally doesn't match what's actually running in production.

## 🔄 Alternative: Deploy GitHub Code

If you want to simplify (use only h2s_tracking_events for everything):

```bash
cd backend
vercel deploy
```

This version only needs:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`

No `DATABASE_URL` needed!

---

## Quick Reference

### Check Current Vercel Env Vars
```bash
vercel env ls --project h2s-backend
```

### Add/Update Env Var
```bash
vercel env add DATABASE_URL production
# Then paste the connection string when prompted
```

### Redeploy
```bash
vercel --prod
```

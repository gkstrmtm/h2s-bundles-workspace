# Supabase Credentials Explained

## What Each Credential Is

### 1. **SUPABASE_URL** (Project URL)
- **What it is**: The base URL of your Supabase project
- **Format**: `https://xxxxx.supabase.co`
- **Example**: `https://abcdefghijklmnop.supabase.co`
- **Where to find**: Supabase Dashboard → Project Settings → API → Project URL
- **Purpose**: Tells the backend which Supabase project to connect to

### 2. **SUPABASE_SERVICE_KEY** (Service Role Key)
- **What it is**: Full admin access key (bypasses Row Level Security)
- **Format**: Long JWT token string
- **Example**: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...` (very long)
- **Where to find**: Supabase Dashboard → Project Settings → API → `service_role` key (secret)
- **Purpose**: Allows backend to insert/update/delete without RLS restrictions
- **⚠️ IMPORTANT**: This is NOT the anon key - it's the service_role key

### 3. **SUPABASE_ANON_KEY** (Anonymous/Public Key)
- **What it is**: Public key with limited permissions (read-only, respects RLS)
- **Format**: Long JWT token string
- **Where to find**: Supabase Dashboard → Project Settings → API → `anon` key (public)
- **Purpose**: Used by frontend for client-side operations
- **❌ NOT USED BY BACKEND**: Backend needs service_role key, not anon key

### 4. **SUPABASE_URL_DB1** (Optional - Separate Database)
- **What it is**: URL for a separate Supabase project (if using multiple databases)
- **Format**: `https://yyyyy.supabase.co` (different project)
- **Purpose**: If you have tracking tables in a separate Supabase project
- **If not set**: Backend falls back to using `SUPABASE_URL`

### 5. **SUPABASE_SERVICE_KEY_DB1** (Optional - Separate Database Key)
- **What it is**: Service role key for the separate database
- **Purpose**: Full admin access to the DB1 project
- **If not set**: Backend falls back to using `SUPABASE_SERVICE_KEY`

## What Backend Needs

The backend code in `backend/lib/supabase.ts` requires:

**Required:**
- `SUPABASE_URL` - Which Supabase project to use
- `SUPABASE_SERVICE_KEY` - Full admin access to that project

**Optional:**
- `SUPABASE_URL_DB1` - Separate database for tracking (if different from main)
- `SUPABASE_SERVICE_KEY_DB1` - Service key for separate database

## How to Check in Vercel

1. Go to Vercel Dashboard
2. Select your backend project
3. Go to Settings → Environment Variables
4. Look for:
   - `SUPABASE_URL` - Should be your Supabase project URL
   - `SUPABASE_SERVICE_KEY` - Should be the service_role key (not anon key)
   - `SUPABASE_URL_DB1` - Optional, if set
   - `SUPABASE_SERVICE_KEY_DB1` - Optional, if set

## Common Issues

### ❌ Wrong Key Type
- **Problem**: Using `SUPABASE_ANON_KEY` instead of `SUPABASE_SERVICE_KEY`
- **Symptom**: Inserts fail with permission errors
- **Fix**: Use the `service_role` key, not the `anon` key

### ❌ Wrong Project URL
- **Problem**: `SUPABASE_URL` points to a different Supabase project
- **Symptom**: Tables don't exist (foreign key errors)
- **Fix**: Make sure URL matches the project where tables exist

### ❌ DB1 Mismatch
- **Problem**: Tables are in main project, but backend is trying to use DB1
- **Symptom**: Tables not found
- **Fix**: Either set DB1 credentials correctly, or ensure tables are in main project

## Quick Check

Run this SQL in Supabase to see your project URL:
```sql
SELECT current_database() AS database_name;
```

Then compare with your Vercel `SUPABASE_URL` environment variable - they should match the same Supabase project.


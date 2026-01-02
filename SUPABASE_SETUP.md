# Supabase Configuration for Google Apps Script

## Credentials to Add

You need to add these credentials to your Google Apps Script **Script Properties**:

### How to Access Script Properties:
1. Open your Google Apps Script project (Dashboard.js)
2. Click **Project Settings** (gear icon on the left sidebar)
3. Scroll down to **Script Properties**
4. Click **Add script property**

---

## Properties to Add:

### 1. SUPABASE_URL
**Value:**
```
https://ngnskohzqijcmyhzmwnm.supabase.co
```

### 2. SUPABASE_ANON_KEY
**Value:**
```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5nbnNrb2h6cWlqY215aHptd25tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ5NzI5NzIsImV4cCI6MjA4MDU0ODk3Mn0.1ifqTO0GI6CiUNq_c1yb1QFylGnjE10DyQso0gLuBgE
```

### 3. SUPABASE_SERVICE_KEY
**Value:**
```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5nbnNrb2h6cWlqY215aHptd25tIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NDk3Mjk3MiwiZXhwIjoyMDgwNTQ4OTcyfQ.CP66293EB_UY_8eykav0AEE-tziT6WpgfpyjA6cv2tw
```

---

## Summary - You Need These 3 Properties:

| Property Name | Where to Get It |
|--------------|-----------------|
| `SUPABASE_URL` | ✅ Already provided above |
| `SUPABASE_ANON_KEY` | ✅ Already provided above |
| `SUPABASE_SERVICE_KEY` | 🔍 Get from Supabase Dashboard → Project Settings → API → service_role key |

---

## After Adding All 3 Properties:

Your Google Apps Script will be able to connect to Supabase using the JavaScript client library.

**Note:** The `service_role` key bypasses Row Level Security (RLS), so keep it secure. Only use it in server-side Google Apps Script, never expose it in frontend code.

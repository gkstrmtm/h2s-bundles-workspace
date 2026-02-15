# Checkout Traces Migration

Run this SQL in your Supabase SQL Editor (https://supabase.com/dashboard/project/YOUR_PROJECT/sql):

```sql
-- Copy the contents of backend/migrations/add_checkout_traces.sql
```

Or copy-paste the SQL directly from:
`backend/migrations/add_checkout_traces.sql`

After running the migration:
1. Verify tables exist:
   ```sql
   SELECT * FROM h2s_checkout_traces LIMIT 1;
   SELECT * FROM h2s_checkout_failures LIMIT 1;
   ```

2. Set ADMIN_KEY environment variable in Vercel:
   ```bash
   vercel env add ADMIN_KEY
   # Enter a secure random string (e.g., output of: openssl rand -hex 32)
   ```

3. Deploy backend:
   ```bash
   cd backend
   npm run build
   vercel --prod --yes
   vercel alias set <deployment-url> h2s-backend.vercel.app
   ```

4. Run simulation test:
   ```bash
   export ADMIN_KEY="your-admin-key-here"
   node scripts/simulateCheckout.js
   ```

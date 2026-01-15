# Stripe Relay Environment Variables

## Required Vercel Environment Variables

Add these to your Vercel project settings:

### `STRIPE_RELAY_URL`
The URL of your deployed relay service (no trailing slash).

**Example:**
```
https://h2s-stripe-relay-production.up.railway.app
```

**How to get this:**
1. Deploy the relay service to Railway (see `relay/README.md`)
2. Run `railway domain` to get your service URL
3. Copy the URL WITHOUT trailing slash

### `STRIPE_RELAY_SECRET`
Authentication secret shared between Vercel and the relay.

**How to generate:**
```bash
openssl rand -hex 32
```

**Important:**
- Use the SAME value in both Vercel and Railway
- Never commit this to git
- Rotate periodically for security

## Setting Environment Variables in Vercel

### Via Dashboard:
1. Go to https://vercel.com/your-team/h2s-backend/settings/environment-variables
2. Add `STRIPE_RELAY_URL` with your Railway URL
3. Add `STRIPE_RELAY_SECRET` with your generated secret
4. Redeploy backend for changes to take effect

### Via CLI:
```bash
vercel env add STRIPE_RELAY_URL production
# Paste your Railway URL when prompted

vercel env add STRIPE_RELAY_SECRET production
# Paste your generated secret when prompted

vercel --prod
```

## Verification

After deployment, test the relay connection:

```bash
curl -X POST https://h2s-backend.vercel.app/api/shop \
  -H "Content-Type: application/json" \
  -d '{
    "__action": "create_checkout_session",
    "customer": {"name": "Test", "email": "test@test.com", "phone": "1234567890"},
    "cart": [{
      "id": "test-product",
      "name": "Test Product",
      "price": 1000,
      "qty": 1
    }],
    "success_url": "https://example.com/success",
    "cancel_url": "https://example.com/cancel"
  }'
```

Should return:
```json
{
  "ok": true,
  "url": "https://checkout.stripe.com/c/pay/cs_...",
  "sessionId": "cs_..."
}
```

## Architecture Flow

```
Frontend (bundles.js)
  ↓ POST /api/shop (__action: create_checkout_session)
Vercel Backend (shop/route.ts)
  ↓ POST /stripe/checkout (with Authorization: Bearer {STRIPE_RELAY_SECRET})
Railway Relay (server.js)
  ↓ stripe.checkout.sessions.create()
Stripe API ✓
  ↓ session { id, url }
Railway Relay
  ↓ { ok: true, session: { id, url } }
Vercel Backend
  ↓ { ok: true, url, sessionId }
Frontend → Redirect to Stripe Checkout
```

## Troubleshooting

### Error: "STRIPE_RELAY_URL or STRIPE_RELAY_SECRET not configured"
- Environment variables not set in Vercel
- Redeploy required after adding env vars

### Error: "Unable to connect to payment system"
- Relay service is down (check Railway logs: `railway logs`)
- Network issue between Vercel and Railway
- Verify relay URL is accessible: `curl https://your-relay.railway.app/health`

### Error: "Unauthorized" (401)
- STRIPE_RELAY_SECRET mismatch between Vercel and Railway
- Verify secrets match exactly in both environments

### Error: "Missing sessionParams in request body"
- Bug in Vercel backend - check shop/route.ts line ~1030
- Verify sessionParams is correctly constructed before relay call

## Security Notes

1. **Authentication:** All requests to relay require Bearer token
2. **CORS:** Relay only accepts requests from h2s-backend.vercel.app
3. **Idempotency:** Order ID is used as idempotency key to prevent duplicate charges
4. **No Direct Stripe Access:** Vercel never calls Stripe directly (timeout issues)

## Rollback Plan

If relay fails, you can temporarily revert to direct Stripe calls:

1. Comment out relay code in shop/route.ts (lines ~1030-1080)
2. Uncomment: `const session = await stripe.checkout.sessions.create(sessionParams);`
3. Redeploy

Note: Direct Stripe calls from Vercel will likely still timeout, but this restores the old behavior.

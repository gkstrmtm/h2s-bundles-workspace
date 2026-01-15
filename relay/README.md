# H2S Stripe Relay Service

This relay service proxies Stripe API calls from Vercel backend to avoid Vercel's infrastructure timeout issues.

## Why This Exists

Vercel serverless functions cannot reliably connect to Stripe API - all calls timeout after 3 retries with `StripeConnectionError`. This relay runs on Railway (or Render) where Stripe connectivity is reliable.

## Architecture

```
Frontend (Vercel)
  → Backend (Vercel) 
    → Relay (Railway) 
      → Stripe API ✓
```

## Endpoints

### `POST /stripe/checkout`

Creates a Stripe checkout session.

**Headers:**
- `Authorization: Bearer {RELAY_SECRET}`

**Request Body:**
```json
{
  "sessionParams": {
    "mode": "payment",
    "payment_method_types": ["card"],
    "line_items": [...],
    "success_url": "...",
    "cancel_url": "...",
    "metadata": {...},
    "discounts": [{ "promotion_code": "promo_..." }]
  },
  "idempotencyKey": "unique-key-here"
}
```

**Response (Success):**
```json
{
  "ok": true,
  "session": {
    "id": "cs_...",
    "url": "https://checkout.stripe.com/..."
  }
}
```

**Response (Error):**
```json
{
  "ok": false,
  "error": "Error message",
  "type": "StripeInvalidRequestError",
  "code": "parameter_invalid_integer"
}
```

### `GET /health`

Health check endpoint.

**Response:**
```json
{
  "ok": true,
  "service": "h2s-stripe-relay",
  "timestamp": "2026-01-08T..."
}
```

## Deployment on Railway

1. **Create Railway Project:**
   ```bash
   railway login
   railway init
   railway link
   ```

2. **Set Environment Variables:**
   ```bash
   railway variables set STRIPE_SECRET_KEY=sk_live_...
   railway variables set RELAY_SECRET=$(openssl rand -hex 32)
   ```

3. **Deploy:**
   ```bash
   railway up
   ```

4. **Get Service URL:**
   ```bash
   railway domain
   # Example: h2s-stripe-relay-production.up.railway.app
   ```

5. **Update Vercel Environment Variables:**
   - `STRIPE_RELAY_URL`: `https://your-railway-service.up.railway.app`
   - `STRIPE_RELAY_SECRET`: Same value as Railway's `RELAY_SECRET`

## Local Development

```bash
npm install
cp .env.example .env
# Edit .env with your keys
npm run dev
```

Test locally:
```bash
curl -X POST http://localhost:3001/stripe/checkout \
  -H "Authorization: Bearer your_relay_secret" \
  -H "Content-Type: application/json" \
  -d '{"sessionParams": {...}, "idempotencyKey": "test-123"}'
```

## Security

- **Authentication:** All requests require `Authorization: Bearer {RELAY_SECRET}` header
- **CORS:** Only allows requests from `h2s-backend.vercel.app` and `localhost:3000`
- **Idempotency:** Enforces idempotency keys to prevent duplicate charges
- **No Direct Stripe Key Exposure:** Vercel never has direct Stripe access

## Monitoring

Check logs:
```bash
railway logs
```

Monitor health:
```bash
curl https://your-service.railway.app/health
```

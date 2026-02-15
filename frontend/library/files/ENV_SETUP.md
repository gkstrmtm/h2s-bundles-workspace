# ⚠️ Environment Variables Setup

The `.env` files with API keys have been excluded from git for security.

## To set up environment variables:

### Option 1: Vercel Dashboard (Recommended)
1. Go to https://vercel.com/dashboard
2. Select the `h2s-backend` project
3. Settings → Environment Variables
4. Already configured in production ✅

### Option 2: Local Development
Create `backend/.env.local`:

```env
# Supabase Database 1 (Analytics)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_KEY=your-service-key

# Supabase Database 2 (Management)
SUPABASE_URL_MGMT=https://your-mgmt-project.supabase.co
SUPABASE_SERVICE_KEY_MGMT=your-mgmt-service-key

# Stripe
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Twilio (SMS)
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your-auth-token
TWILIO_PHONE_NUMBER=+18643878413
TWILIO_ENABLED="TRUE"
USE_TWILIO="TRUE"

# OpenAI (AI Insights)
OPENAI_API_KEY=sk-...

# SendGrid (Email - Optional)
SENDGRID_API_KEY=SG...
```

## Getting the values

**Ask the project owner** or check:
- Vercel Dashboard (already configured)
- Supabase project settings
- Stripe dashboard
- Twilio console

## Security Notes

- ❌ Never commit `.env` files to git
- ✅ `.env` files are in `.gitignore`
- ✅ Secrets stored securely in Vercel
- 🔐 Rotate keys if accidentally exposed

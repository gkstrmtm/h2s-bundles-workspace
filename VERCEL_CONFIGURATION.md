# 🚀 Vercel Configuration - h2s-backend Production

**Production URL:** https://h2s-backend.vercel.app  
**Project ID:** `prj_ogQIGA1ZxWZyxMwc10fW8URp8tGV`  
**Last Updated:** January 3, 2026

---

## 📦 Vercel Project Settings

### Framework & Build Configuration

| Setting | Value |
|---------|-------|
| **Framework Preset** | Next.js (Auto-detected) |
| **Next.js Version** | 14.2.18 |
| **Node Version** | 20.x |
| **Build Command** | `npx prisma generate && next build` |
| **Install Command** | `npm install` (+ postinstall: `npx prisma generate`) |
| **Output Directory** | `.next` (Next.js default) |
| **Root Directory** | `backend/` |

### Project Structure Type

**This is a Next.js App Router application** (Next.js 13+)
- Uses `app/` directory structure
- API routes in `app/api/**/route.ts`
- Minimal React frontend (status page)
- Deployed as serverless functions on Vercel

---

## 📁 File Structure (Production)

```
backend/
├── app/                           # Next.js App Router
│   ├── layout.tsx                # Root layout (required)
│   ├── page.tsx                  # Home page - API status
│   │
│   └── api/                      # API Routes → Serverless Functions
│       ├── v1/
│       │   └── route.ts         # /api/v1 - Analytics & insights API
│       │
│       ├── notify-management/
│       │   └── route.ts         # /api/notify-management - SMS notifications
│       │
│       ├── stripe-webhook/
│       │   └── route.ts         # /api/stripe-webhook - Payment webhooks
│       │
│       ├── shop/
│       │   └── route.ts         # /api/shop - Product catalog
│       │
│       ├── track/
│       │   └── route.ts         # /api/track - Analytics tracking
│       │
│       ├── track-ping/
│       │   └── route.ts         # /api/track-ping - Health check
│       │
│       ├── schedule-appointment/
│       │   └── route.ts         # /api/schedule-appointment - Booking
│       │
│       ├── portal_*/             # Tech Portal APIs (30+ routes)
│       │   ├── portal_jobs/route.ts
│       │   ├── portal_login/route.ts
│       │   ├── portal_accept/route.ts
│       │   ├── portal_decline/route.ts
│       │   └── ... (27 more)
│       │
│       └── admin_*/              # Admin APIs (10+ routes)
│           ├── admin_dispatch/route.ts
│           ├── admin_jobs_list/route.ts
│           └── ... (8 more)
│
├── lib/                          # Shared utilities
│   ├── supabase.ts              # Supabase client (2 databases)
│   ├── prisma.ts                # Prisma ORM client
│   ├── portalTokens.ts          # JWT authentication
│   ├── adminAuth.ts             # Admin authorization
│   └── ...
│
├── package.json                 # Dependencies
├── next.config.js               # Next.js configuration
├── tsconfig.json                # TypeScript configuration
├── vercel.json                  # Vercel-specific settings
├── schema.prisma                # Database schema
└── middleware.ts                # Request middleware
```

---

## 🔧 Configuration Files

### 1. package.json

```json
{
  "name": "h2s-dashboard-backend",
  "version": "1.0.0",
  "scripts": {
    "dev": "next dev",
    "build": "npx prisma generate && next build",
    "start": "next start",
    "postinstall": "npx prisma generate"
  },
  "dependencies": {
    "next": "14.2.18",
    "react": "18.2.0",
    "react-dom": "18.2.0",
    "@supabase/supabase-js": "^2.86.2",
    "@prisma/client": "^5.22.0",
    "stripe": "^20.1.0",
    "twilio": "^5.11.1",
    "openai": "^4.20.1",
    "prisma": "^5.22.0"
  },
  "devDependencies": {
    "@types/node": "^20.10.4",
    "@types/react": "^18.2.45",
    "typescript": "^5.3.3"
  }
}
```

**Key Dependencies:**
- **next**: 14.2.18 - Framework (App Router)
- **react**: 18.2.0 - Required by Next.js
- **@supabase/supabase-js**: Database client (PostgreSQL)
- **stripe**: Payment processing
- **twilio**: SMS notifications
- **openai**: AI-powered insights
- **prisma**: Database ORM

### 2. next.config.js

```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  onDemandEntries: {
    maxInactiveAge: 60 * 1000,
    pagesBufferLength: 5,
  },
};

module.exports = nextConfig;
```

**Configuration:**
- Minimal setup (uses Next.js defaults)
- On-demand entry management for performance

### 3. vercel.json

```json
{
  "public": true,
  "headers": [
    {
      "source": "/api/(.*)",
      "headers": [
        { "key": "Access-Control-Allow-Origin", "value": "*" },
        { "key": "Access-Control-Allow-Methods", "value": "GET,POST,PUT,DELETE,OPTIONS" },
        { "key": "Access-Control-Allow-Headers", "value": "Content-Type, Authorization" }
      ]
    }
  ]
}
```

**CORS Configuration:**
- Allows cross-origin requests to all `/api/*` endpoints
- Required for frontend pages on different domains

### 4. tsconfig.json

```json
{
  "compilerOptions": {
    "target": "es5",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/*": ["./*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

**TypeScript Settings:**
- Target: ES5 (broad compatibility)
- Module: ESNext with bundler resolution
- Path aliases: `@/*` → `./`

### 5. schema.prisma

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// Models defined via Supabase (not Prisma-managed)
// Used only for type generation
```

---

## 🔐 Environment Variables (Vercel Dashboard)

**Location:** Vercel Dashboard → h2s-backend → Settings → Environment Variables

### Database (Supabase)

| Variable | Purpose | Example |
|----------|---------|---------|
| `SUPABASE_URL` | Database 1 - Analytics | `https://xxx.supabase.co` |
| `SUPABASE_ANON_KEY` | Database 1 - Public key | `eyJhbGciOiJIUzI1...` |
| `SUPABASE_SERVICE_KEY` | Database 1 - Admin key | `eyJhbGciOiJIUzI1...` |
| `SUPABASE_URL_MGMT` | Database 2 - Management | `https://yyy.supabase.co` |
| `SUPABASE_SERVICE_KEY_MGMT` | Database 2 - Admin key | `eyJhbGciOiJIUzI1...` |
| `DB_PW_MANAGEMENT` | Database password | `SQViZFW86uHPALIo` |

### Payment Processing (Stripe)

| Variable | Purpose |
|----------|---------|
| `STRIPE_SECRET_KEY` | Stripe API key |
| `STRIPE_WEBHOOK_SECRET` | Webhook signature verification |

### SMS Notifications (Twilio)

| Variable | Purpose | Value |
|----------|---------|-------|
| `TWILIO_ACCOUNT_SID` | Twilio account ID | `ACad5f1d81e7a6d155...` |
| `TWILIO_AUTH_TOKEN` | Authentication token | `ff99b31fa22a51f086...` |
| `TWILIO_PHONE_NUMBER` | Sender phone | `+18643878413` |
| `TWILIO_ENABLED` | Feature flag | `TRUE` |
| `USE_TWILIO` | Legacy flag | `TRUE` |

**Management SMS Recipients:**
- +18644502445
- +18643239776
- +19513318992
- +18643235087

### AI Features (OpenAI)

| Variable | Purpose |
|----------|---------|
| `OPENAI_API_KEY` | GPT-4 API access |

### Email (SendGrid - Optional)

| Variable | Purpose |
|----------|---------|
| `SENDGRID_API_KEY` | Email sending |

---

## 🚀 Deployment Process

### How Vercel Deploys h2s-backend

1. **Git Push Detection**
   ```bash
   git push origin main
   ```

2. **Vercel Build Process**
   ```bash
   # 1. Install dependencies
   npm install
   
   # 2. Postinstall hook
   npx prisma generate
   
   # 3. Build Next.js app
   npx prisma generate && next build
   
   # 4. Output created
   .next/
   ├── server/           # Serverless functions
   ├── static/          # Static assets
   └── cache/           # Build cache
   ```

3. **Serverless Function Generation**
   - Each `app/api/**/route.ts` → Individual serverless function
   - Deployed to Vercel Edge Network
   - Auto-scaling, zero config

4. **Environment Variables**
   - Injected at build time
   - Encrypted in transit
   - Never exposed to client

### Manual Deployment

```bash
cd backend
vercel --prod
```

**Output:**
```
✅ Production: https://h2s-backend-[hash].vercel.app
🔍 Inspect: https://vercel.com/...
```

---

## 🎯 API Endpoints (50+)

### Core Analytics
- `GET /api/v1?action=meta_pixel_events` - Analytics data
- `GET /api/v1?action=stats` - Dashboard stats
- `GET /api/v1?action=revenue` - Revenue metrics
- `POST /api/v1?action=ai-insights` - AI-powered analysis

### Booking & Payments
- `POST /api/schedule-appointment` - Book service
- `POST /api/stripe-webhook` - Payment webhooks
- `POST /api/shop` - Product catalog
- `POST /api/notify-management` - SMS alerts

### Tech Portal (30+ endpoints)
- `POST /api/portal_login` - Tech authentication
- `GET /api/portal_jobs` - Assigned jobs list
- `POST /api/portal_accept` - Accept job
- `POST /api/portal_decline` - Decline job
- `POST /api/portal_upload_photo` - Upload completion photo
- `GET /api/portal_payouts` - Payout history
- ... (25 more portal endpoints)

### Admin (10+ endpoints)
- `POST /api/admin_login` - Admin authentication
- `GET /api/admin_jobs_list` - All jobs
- `POST /api/admin_dispatch` - Manual dispatch
- `GET /api/admin_business_intelligence` - Analytics
- ... (7 more admin endpoints)

### Tracking
- `POST /api/track` - Event tracking
- `GET /api/track-ping` - Health check

---

## 🔍 How Next.js API Routes Work

### Route File Structure

```typescript
// app/api/v1/route.ts
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');
  
  // Handle different actions
  switch (action) {
    case 'meta_pixel_events':
      // Return analytics data
      return NextResponse.json({ data: ... });
    // ... more actions
  }
}

export async function POST(request: NextRequest) {
  // Handle POST requests
}
```

### Deployment as Serverless Functions

```
app/api/v1/route.ts
    ↓ (Vercel builds)
/api/v1 → Serverless Function
    ↓ (Request arrives)
Lambda executes → Returns response
```

**Benefits:**
- Auto-scaling (0 → ∞ concurrent requests)
- Pay per execution (not per server)
- Global edge network (low latency)
- Zero infrastructure management

---

## 📊 Production Status

### Current Deployment

**URL:** https://h2s-backend.vercel.app

**Status:** 🟢 Online

**Features Active:**
- ✅ Analytics API with time-range filtering
- ✅ SMS notifications (4 management numbers)
- ✅ Stripe payment webhooks
- ✅ Tech portal (30+ endpoints)
- ✅ AI-powered insights (OpenAI GPT-4)
- ✅ Job management system
- ✅ Customer photo uploads

**Recent Updates:**
- Jan 2, 2026: Added `/api/notify-management` for booking alerts
- Jan 2, 2026: Enhanced analytics with intelligent insights
- Jan 2, 2026: Fixed TRUE count display (removed 1000 cap)
- Dec 2025: Integrated Twilio SMS notifications

### Performance Metrics

**API Response Times:**
- `/api/v1?action=meta_pixel_events` - ~2-3s (97KB payload)
- `/api/track` - ~200ms
- `/api/portal_jobs` - ~500ms

**Build Times:**
- Average: ~50 seconds
- Dependencies install: ~20s
- Prisma generation: ~5s
- Next.js build: ~25s

---

## 🛠️ Local Development Setup

### Prerequisites
- Node.js 20.x
- npm or yarn
- Git

### Setup Steps

```bash
# 1. Clone repository
git clone https://github.com/gkstrmtm/Home2smart-backend.git
cd Home2smart-backend/backend

# 2. Install dependencies
npm install

# 3. Create .env.local (see ENV_SETUP.md for values)
cp .env.production.vercel .env.local
# Edit .env.local with your credentials

# 4. Generate Prisma client
npx prisma generate

# 5. Run development server
npm run dev
```

**Development URL:** http://localhost:3000

### Testing Endpoints

```bash
# Test analytics API
curl http://localhost:3000/api/v1?action=meta_pixel_events

# Test health check
curl http://localhost:3000/api/track-ping

# Test with authentication
curl -H "Authorization: Bearer YOUR_TOKEN" \
     http://localhost:3000/api/portal_jobs
```

---

## 🔄 Deployment Workflow

### Git → Vercel Auto-Deploy

```bash
# 1. Make changes
git add .
git commit -m "Update: [description]"

# 2. Push to GitHub
git push origin main

# 3. Vercel auto-deploys
# ✅ Build succeeds
# ✅ Tests pass
# ✅ Deployed to production
```

### Manual Deploy (Bypass CI)

```bash
cd backend
vercel --prod
```

### Rollback (If Needed)

1. Go to Vercel Dashboard
2. Select h2s-backend project
3. Deployments tab
4. Find previous working deployment
5. Click "Promote to Production"

---

## 📝 Important Notes

### Why This Works

**This IS a full Next.js application**, just API-focused:

✅ **Has Next.js requirements:**
- `app/layout.tsx` (root layout)
- `app/page.tsx` (home page)
- React dependencies
- Next.js configuration

✅ **API Routes in App Router:**
- `app/api/**/route.ts` files
- Automatically become serverless functions
- Type-safe with TypeScript

❌ **Not a separate API server:**
- Not Express.js
- Not standalone Node.js
- Not custom server

### Common Misconceptions

**"It's just API routes without frontend"**
- FALSE: There IS a frontend (simple status page)
- React is required for Next.js to work
- The frontend is just minimal, not absent

**"Vercel has special API-only mode"**
- FALSE: Standard Next.js App Router
- No special configuration needed
- Uses same build process as full apps

### Maintenance

**Updating Dependencies:**
```bash
cd backend
npm update
npm audit fix
git commit -am "Update dependencies"
git push
```

**Adding New API Endpoint:**
```bash
# Create new route file
mkdir -p app/api/new-endpoint
nano app/api/new-endpoint/route.ts

# Becomes: /api/new-endpoint
```

**Environment Variables:**
- Edit in Vercel Dashboard
- Redeploy to apply changes
- Never commit .env files to git

---

## 🆘 Troubleshooting

### Build Failures

**Error:** `Module not found: Can't resolve 'twilio'`
```bash
cd backend
npm install twilio
git add package.json package-lock.json
git commit -m "Add twilio dependency"
git push
```

**Error:** `Prisma Client not generated`
```bash
# Ensure postinstall hook exists in package.json
"scripts": {
  "postinstall": "npx prisma generate"
}
```

### Runtime Errors

**500 Error on API endpoint**
1. Check Vercel function logs
2. Verify environment variables
3. Check database connection
4. Test locally first

**CORS Issues**
- Verify `vercel.json` has correct headers
- Check origin in request
- May need to add specific domain to allow list

---

## 📚 References

- **Next.js Docs:** https://nextjs.org/docs
- **Vercel Docs:** https://vercel.com/docs
- **API Routes:** https://nextjs.org/docs/app/building-your-application/routing/route-handlers
- **Environment Variables:** https://vercel.com/docs/environment-variables

---

**Last Updated:** January 3, 2026  
**Maintained By:** Home2Smart Development Team  
**Production Status:** 🟢 Stable

# Home2Smart Platform

Production backend API and frontend for Home2Smart home services business.

## Collaboration Model

- Stable branch: [main](docs/PORTAL_BRANCH_WORKFLOW.md)
- Foundational media-engine branch: `retro-dev`
- Other major portal changes should use separate feature branches, not `main`

Start here before making portal changes:

- [docs/PORTAL_BRANCH_WORKFLOW.md](docs/PORTAL_BRANCH_WORKFLOW.md)
- [docs/PORTAL_WORKSTREAMS.md](docs/PORTAL_WORKSTREAMS.md)
- [docs/OWNER_UPLOADS_ENGINE.md](docs/OWNER_UPLOADS_ENGINE.md)

## Kickoff / Handoff

- Primary handoff doc: [KICKOFF_CHECKLIST.md](KICKOFF_CHECKLIST.md)
- Deployment guide: [FINAL_DEPLOYMENT_GUIDE.md](FINAL_DEPLOYMENT_GUIDE.md)

## 📁 Repository Structure

```
home2smart-platform/
├── backend/                    # Next.js TypeScript API
│   ├── app/api/               # 50+ API routes
│   │   ├── v1/route.ts       # Analytics & insights
│   │   ├── stripe-webhook/   # Payment processing
│   │   ├── notify-management/ # SMS notifications
│   │   └── shop/             # Product catalog
│   └── package.json
│
├── frontend/                   # Static HTML/CSS/JS pages
│   ├── bundles.html           # Service packages
│   ├── funnel-track.html      # Analytics dashboard
│   └── Home2Smart-Dashboard/
│
└── docs/                       # Architecture docs
```

## 🚀 Quick Start

### Backend Development
```bash
cd backend
npm install
npm run dev              # http://localhost:3000
vercel --prod           # Deploy to production
```

**Live API**: https://h2s-backend.vercel.app

### Frontend Pages
Static files - deploy to any host (Vercel, Netlify, GitHub Pages)

## 🔑 Environment Setup

Create `backend/.env.production.vercel`:

```env
# Supabase (2 databases)
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_KEY=
SUPABASE_URL_MGMT=
SUPABASE_SERVICE_KEY_MGMT=

# Payments
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=

# Communications
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=

# AI
OPENAI_API_KEY=
```

## Business phone and call relay

The active local business number is **864-387-8413**. Public call links and
appointment support copy use this number, not the outdated website contact number.
Commercial intake prefers `COMMERCIAL_CALL_NUMBER`, then `PUBLIC_PHONE_NUMBER`,
then the configured Twilio sender (`TWILIO_FROM_NUMBER` / `TWILIO_PHONE_NUMBER`).

Voice forwarding is a published Twilio Studio flow, separate from customer SMS
preferences and technician/management dispatch lists. It calls one configured
recipient, displays the business line as caller ID, does not record calls, and
plays an unavailable message if the connection fails or goes unanswered.
Carrier voicemail can still count as an answered call.

Configure credentials and the relay destination outside Git:
`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`, and
`TWILIO_VOICE_FORWARD_TO`. From `backend`, validate without changing routing:

```powershell
node tools\configure-business-call-relay.cjs
```

Only after explicit authorization, publish and attach the verified flow:

```powershell
node tools\configure-business-call-relay.cjs --apply
```

The tool refuses unowned/nonvoice numbers, self-dialing, international targets,
existing voice applications, and unrelated voice handlers. It preserves and
verifies SMS settings. On an ambiguous provider update, read back the voice
configuration before retrying; do not delete a flow that may already be attached.
Keep the previous voice URL/method for rollback. Normal Twilio Voice and Studio
usage charges apply. Publishing this provider route does not deploy website
changes; those still require an explicitly authorized manual Vercel deployment.
Confirm actual ringing and conversation from a different phone than the relay
destination before marking end-to-end calling verified.

## 💡 Key Features

- Real-time analytics dashboard with Meta Pixel tracking
- Automated SMS notifications to management on bookings
- AI-powered marketing insights
- Stripe payment processing
- Tech portal for job management
- Customer photo uploads

## 🛠️ Tech Stack

- **Backend**: Next.js 14, TypeScript, Prisma
- **Database**: Supabase (PostgreSQL)
- **Payments**: Stripe
- **SMS**: Twilio
- **AI**: OpenAI GPT-4
- **Hosting**: Vercel

## 📊 Recent Updates

- ✅ Management notifications (SMS on every booking)
- ✅ Intelligent analytics insights (no loading states)
- ✅ TRUE database counts (removed 1000 cap)
- ✅ Time-based filtering (7/14/30/60/90 days)

## 🎯 Next: Performance Optimization

Focus areas for loading time improvements:
- Image lazy loading
- Code splitting
- Bundle optimization
- Caching strategies

---

**Production**: https://h2s-backend.vercel.app  
**Updated**: January 2, 2026

# Home2Smart Platform

Production backend API and frontend for Home2Smart home services business.

## Kickoff / Handoff

- Primary handoff doc: [KICKOFF_CHECKLIST.md](KICKOFF_CHECKLIST.md)

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

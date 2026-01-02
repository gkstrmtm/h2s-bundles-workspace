# 🚀 Deploy Reviews API Fix to Production

## Problem
- ✅ Fixed reviews API locally (localhost:3000)
- ❌ bundles.html points to production: `https://h2s-backend.vercel.app/api/reviews`
- ⚠️ Changes NOT deployed to production yet

## What Was Fixed
File: `backend/app/api/reviews/route.ts`

Added dual field format support:
```typescript
{
  // Original format (for carousel)
  rating: 5,
  review_text: "Great work!",
  display_name: "Pamela Butler",
  
  // Alias format (for hero reviews)  
  text: "Great work!",
  name: "Pamela Butler",
  stars: 5
}
```

## Deployment Options

### Option 1: Deploy via Vercel CLI (FASTEST)
```powershell
cd 'c:\Users\tabar\Quick fix Dash\backend'
vercel --prod
```

### Option 2: Deploy via Git + Vercel (if connected)
```powershell
cd 'c:\Users\tabar\Quick fix Dash\backend'
git init
git add app/api/reviews/route.ts
git commit -m "fix: Add dual field format for reviews API (text/name + review_text/display_name)"
git push origin master
```
(Vercel auto-deploys on push if configured)

### Option 3: Test Locally First
Change bundles.html API URLs to localhost:
```javascript
// Line 3400-3401
const BUNDLES_DATA_API = 'http://localhost:3000/api/bundles-data';
const API = 'http://localhost:3000/api/shop';
```

Then serve bundles.html locally and verify reviews appear.

## Verification After Deploy
```powershell
node -e "fetch('https://h2s-backend.vercel.app/api/reviews?limit=1').then(r => r.json()).then(d => { const r = d.reviews[0]; console.log('Has text:', !!r.text, '\nHas name:', !!r.name, '\nHas review_text:', !!r.review_text); })"
```

## Files Changed
- ✅ `backend/app/api/reviews/route.ts` (lines 63-74)

## Next Steps
1. Deploy using one of the options above
2. Test production: open bundles.html from home2smart.com
3. Reviews should now appear in hero carousel + review carousel

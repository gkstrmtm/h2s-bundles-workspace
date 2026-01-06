# DEPLOYMENT RULES - NEVER FUCKING FORGET

## THE TRUTH
- **shop.home2smart.com** → served by **h2s-bundles-frontend** Vercel project
- **h2s-backend** → WRONG PROJECT, does NOT serve the shop

## CORRECT DEPLOYMENT COMMANDS (ALWAYS USE THESE)
```powershell
Copy-Item "c:\Users\tabar\h2s-bundles-workspace\bundles.js" "c:\Users\tabar\h2s-bundles-workspace\frontend\bundles.js" -Force
Copy-Item "c:\Users\tabar\h2s-bundles-workspace\bundles.html" "c:\Users\tabar\h2s-bundles-workspace\frontend\bundles.html" -Force
cd "c:\Users\tabar\h2s-bundles-workspace\frontend"
vercel --prod --force
```

## NEVER DO THIS (WRONG)
```powershell
# DON'T COPY TO backend/public/
# DON'T cd to backend/
# backend is NOT the shop
```

## FILES TO EDIT
- Root workspace: `bundles.js` and `bundles.html`
- Deploy destination: `frontend/` folder
- Vercel project: `h2s-bundles-frontend`

## VERIFICATION
After deploy, user should see in console:
- 🦄🦄🦄 VERY UNIQUE LOG
- Build: 🚀🚀🚀 BRAND_NEW_DEPLOY_JAN6_830AM_UNICORN 🚀🚀🚀

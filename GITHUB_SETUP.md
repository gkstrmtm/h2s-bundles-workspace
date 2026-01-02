# 🚀 GitHub Setup Commands

## Step 1: Create GitHub Repository

Go to GitHub.com and create a new repository:
- Name: `home2smart-platform`
- Description: Home2Smart backend API and frontend - Next.js TypeScript with SMS notifications, analytics, and AI insights
- Visibility: Private (recommended for business code)
- Don't initialize with README (we already have one)

## Step 2: Push Code to GitHub

Run these commands in PowerShell:

```powershell
cd "C:\Users\tabar\Quick fix Dash"

# Add GitHub remote (replace YOUR_USERNAME)
git remote add origin https://github.com/YOUR_USERNAME/home2smart-platform.git

# Push to GitHub
git branch -M main
git push -u origin main
```

## Step 3: Clone on Your Laptop

On your laptop:

```bash
git clone https://github.com/YOUR_USERNAME/home2smart-platform.git
cd home2smart-platform
```

## Step 4: Work on Backend

```bash
cd backend
npm install

# Set up environment variables
cp .env.production.vercel .env.local
# Edit .env.local with your credentials

# Run locally
npm run dev

# Deploy to Vercel
vercel --prod
```

## Step 5: Work on Frontend

```bash
cd frontend

# Edit any HTML/CSS/JS files
# Deploy to Vercel/Netlify/GitHub Pages
```

---

## 📁 Repository Structure

```
home2smart-platform/
├── backend/           # All API code (this is where you'll work most)
├── frontend/          # HTML pages (bundles, dashboard, dispatch)
├── docs/              # Architecture documentation
├── .gitignore         # Excludes test files, node_modules, etc.
└── README.md          # Overview and setup instructions
```

## 🎯 For Performance Optimization Work

Focus on these files:
- `backend/app/api/v1/route.ts` - Main analytics API
- `backend/app/api/shop/route.ts` - Product catalog
- `frontend/bundles.html` - Service bundles page
- `frontend/funnel-track.html` - Analytics dashboard

## 💡 Tips

1. **Environment Variables**: Never commit `.env` files - they're in `.gitignore`
2. **Backend Changes**: Always test locally with `npm run dev` before deploying
3. **Frontend Changes**: Can edit directly and deploy to any static host
4. **Documentation**: Check `docs/` folder for architecture details

## 🔐 Security Notes

- `.env.production.vercel` is in the repo but should be kept private
- Make the GitHub repo private if it contains sensitive data
- Rotate keys if you accidentally commit them publicly

---

**Ready to push?** Run the commands above! 🚀

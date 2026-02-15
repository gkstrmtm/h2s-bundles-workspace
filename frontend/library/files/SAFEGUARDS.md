# 🛡️ SAFEGUARDS INSTALLED - READ THIS

I installed protections so this shit can't keep breaking. Here's what you got:

## 🚨 AUTOMATIC PROTECTIONS

### 1. Git Pre-Commit Hook
**Blocks commits that would break things:**
- ❌ Creating `/app` directory at root
- ❌ Adding `tsconfig.json` at root  
- ❌ Adding `next.config.js` at root
- ❌ Changing portal API to use `/api` instead of h2s-backend

**How it works:** Runs automatically when you `git commit`. If validation fails, commit is blocked.

### 2. .gitignore Protection
**Prevents checking in forbidden files:**
- Won't let you accidentally commit `/app`, `/api` directories
- Blocks TypeScript/Next.js config files at root
- Keeps your reference snapshots local only

### 3. Reference Snapshots
**Safety net in `.reference/` directory:**
- `bundles.html.WORKING` - Known working shop page (your reference)
- `portal.html.WORKING` - Last known working portal
- `vercel.json.WORKING` - Correct routing config

**Restore if broken:**
```powershell
Copy-Item .reference\portal.html.WORKING frontend\portal.html -Force
```

## 🔧 MANUAL TOOLS

### Quick Health Check
Run anytime to verify everything is correct:
```powershell
.\validate-system.ps1
```

Output shows:
- ✅ What's correct
- ❌ What's broken
- ⚠️ What needs attention

### Auto-Fix Issues
If validation finds problems:
```powershell
.\validate-system.ps1 -Fix
```
This will:
- Delete forbidden directories
- Sync root files with frontend/
- Auto-fix what it can

## 📋 BEFORE ANY WORK SESSION

**Run this first:**
```powershell
.\validate-system.ps1
```

If it shows ✅ ALL SYSTEMS HEALTHY, you're good to go.

## 🆘 IF SOMETHING BREAKS

**Step 1:** Check what changed
```powershell
git status
git diff
```

**Step 2:** Compare to working reference
```powershell
# Visual diff in VS Code
code --diff frontend\portal.html .reference\portal.html.WORKING
```

**Step 3:** Restore from snapshot if needed
```powershell
Copy-Item .reference\portal.html.WORKING frontend\portal.html -Force
```

**Step 4:** Re-deploy
```powershell
Copy-Item frontend\portal.html portal.html -Force
git add -A
git commit -m "Restore from working snapshot"
git push
vercel --prod --force
```

## 🔒 THE RULES (ENFORCED BY HOOKS)

1. **Only 2 projects:** h2s-bundles-frontend + h2s-backend
2. **No directories at root:** Only edit /frontend or /backend
3. **Portal uses h2s-backend.vercel.app/api** - Never `/api`
4. **Copy bundles.html pattern** - It's the reference

## 📖 MORE INFO

- [DEPLOYMENT_RULES.md](DEPLOYMENT_RULES.md) - Full deployment guide
- [ARCHITECTURE_TRUTH.md](ARCHITECTURE_TRUTH.md) - System architecture
- [.reference/README.md](.reference/README.md) - How to use snapshots

---

**Bottom line:** The hooks will yell at you if you try to do something wrong. Listen to them.

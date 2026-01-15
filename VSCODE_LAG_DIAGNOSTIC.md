# VS Code Typing/Paste Latency Diagnostic

**Environment:** Windows Desktop, Local Workspace  
**Symptoms:** Character lag while typing, multi-second stall on paste

---

## Diagnostic Checklist (Execute in Order)

### ✅ Step 1: Isolate Extension Impact

**Action:**
1. Close VS Code completely
2. Open PowerShell and run:
   ```powershell
   code --disable-extensions c:\Users\tabar\h2s-bundles-workspace
   ```
3. Test typing and paste in a large file

**Decision:**
- **If lag disappears** → Extensions are the cause. Go to Step 1A.
- **If lag persists** → Extensions not the cause. Skip to Step 2.

---

### Step 1A: Identify Culprit Extension

**Action:**
1. Close VS Code
2. Reopen normally (extensions enabled)
3. Press `Ctrl+Shift+P` → Type: `Help: Start Extension Bisect`
4. Follow the wizard (disable half, test, repeat)
5. Once found, press `Ctrl+Shift+P` → `Developer: Show Running Extensions`
6. Press `Ctrl+Shift+P` → `Developer: Open Process Explorer`
7. Record top 3 CPU consumers (look for `extensionHost`, `tsserver`, `eslint`, etc)

**Common Culprits:**
- TypeScript/JavaScript language features (tsserver)
- ESLint/Prettier extensions
- GitLens (if installed)
- Remote/WSL extensions (if accidentally active on local)
- Copilot (if doing aggressive completion)

**Fix:**
- Disable or uninstall the identified extension
- For TypeScript: Add to `settings.json`:
  ```json
  "typescript.tsserver.maxTsServerMemory": 4096,
  "typescript.disableAutomaticTypeAcquisition": true
  ```

**Re-test.** If fixed → **DONE**. Otherwise continue to Step 2.

---

### ✅ Step 2: Disable Formatting Actions

**Action:**
1. Press `Ctrl+,` (Settings)
2. Search and **uncheck** these:
   - `Editor: Format On Paste`
   - `Editor: Format On Type`
3. Search `codeActionsOnSave` and set to:
   ```json
   "editor.codeActionsOnSave": {}
   ```
4. Test paste in a large file (e.g., `frontend/portal.html`)

**Decision:**
- **If lag disappears** → Formatter is slow. Keep disabled or switch formatter.
- **If lag persists** → Continue to Step 3.

---

### ✅ Step 3: Exclude Large Folders from Watchers

**Action:**
1. Check workspace size:
   ```powershell
   Get-ChildItem -Recurse | Group-Object Extension | Sort-Object Count -Descending | Select-Object -First 10 Count, Name
   ```
2. Identify bloat folders (likely: `node_modules`, `dist`, `build`, `.next`, `coverage`, `logs`, `_live_bundles*`)
3. Add to `settings.json`:
   ```json
   "files.watcherExclude": {
     "**/node_modules/**": true,
     "**/.git/objects/**": true,
     "**/.git/subtree-cache/**": true,
     "**/dist/**": true,
     "**/build/**": true,
     "**/.next/**": true,
     "**/coverage/**": true,
     "**/_live_bundles*": true
   },
   "search.exclude": {
     "**/node_modules": true,
     "**/dist": true,
     "**/build": true,
     "**/.next": true,
     "**/coverage": true
   },
   "files.exclude": {
     "**/.git": true
   }
   ```
4. Reload VS Code: `Ctrl+Shift+P` → `Developer: Reload Window`
5. Test typing

**Decision:**
- **If lag improves** → Keep these settings. Proceed to Step 4 for more gains.
- **If no change** → Continue to Step 4.

---

### ✅ Step 4: Disable Git Integration Overhead

**Action:**
1. Add to `settings.json`:
   ```json
   "git.enabled": true,
   "git.autorefresh": false,
   "git.autofetch": false,
   "git.decorations.enabled": false,
   "git.ignoreLimitWarning": true
   ```
2. Reload window
3. Test typing

**Decision:**
- **If lag improves** → Keep disabled. Use manual `git status` when needed.
- **If no change** → Re-enable and continue to Step 5.

---

### ✅ Step 5: Check Environment Interference

**Action A: OneDrive/Dropbox Check**
```powershell
# Check if workspace is synced
(Get-Item "c:\Users\tabar\h2s-bundles-workspace").Attributes
```
- If `SparseFile` or `ReparsePoint` present → **Workspace is in OneDrive/Dropbox**
- **Fix:** Move workspace to `C:\dev\h2s-bundles-workspace` (non-synced location)

**Action B: Antivirus Exclusion**
1. Open Windows Security → Virus & threat protection → Manage settings → Exclusions
2. Add folder exclusion:
   - `c:\Users\tabar\h2s-bundles-workspace`
   - `C:\Users\tabar\.vscode`
   - `C:\Program Files\Microsoft VS Code`
3. Restart VS Code

**Action C: Check for WSL/Remote Confusion**
```powershell
code --status
```
- Look for active remote connections or WSL extensions running on local files
- **Fix:** Disable WSL/Remote extensions if not needed

---

## Minimal Stable Setup (Copy-Paste)

```json
{
  "editor.formatOnPaste": false,
  "editor.formatOnType": false,
  "editor.codeActionsOnSave": {},
  
  "typescript.tsserver.maxTsServerMemory": 4096,
  "typescript.disableAutomaticTypeAcquisition": true,
  
  "files.watcherExclude": {
    "**/node_modules/**": true,
    "**/.git/objects/**": true,
    "**/.git/subtree-cache/**": true,
    "**/dist/**": true,
    "**/build/**": true,
    "**/.next/**": true,
    "**/coverage/**": true,
    "**/_live_bundles*": true
  },
  
  "search.exclude": {
    "**/node_modules": true,
    "**/dist": true,
    "**/build": true,
    "**/.next": true,
    "**/coverage": true
  },
  
  "git.autorefresh": false,
  "git.autofetch": false,
  "git.decorations.enabled": false
}
```

---

## Rollback Instructions

**To restore all settings:**
1. Press `Ctrl+,` → Click `{}` icon (top-right) to open `settings.json`
2. Delete the blocks added above
3. `Ctrl+Shift+P` → `Developer: Reload Window`

**To re-enable specific features:**
- Format on paste: `"editor.formatOnPaste": true`
- Git decorations: `"git.decorations.enabled": true`
- Auto refresh: `"git.autorefresh": true`

---

## Acceptance Test

After applying fixes, verify:
1. Open `frontend/portal.html` (22K lines)
2. Type 20 characters rapidly → No lag
3. Paste 100 lines → Completes instantly (< 200ms)
4. `Ctrl+Shift+P` → `Developer: Open Process Explorer` → `extensionHost` uses < 5% CPU during idle typing

---

## Quick Win Commands

```powershell
# Restart VS Code with clean slate
Stop-Process -Name "Code" -Force
code --disable-extensions c:\Users\tabar\h2s-bundles-workspace

# Check workspace bloat
Get-ChildItem -Recurse -Directory | Where-Object { $_.Name -match "node_modules|dist|build|coverage|\.next" } | Select-Object FullName

# Kill hung tsserver
Get-Process | Where-Object { $_.ProcessName -match "tsserver" } | Stop-Process -Force
```

# Dashboard Accounts: Deploy + Bootstrap (Feb 2026)

This workspace now uses DB-backed dashboard accounts (users + sessions) for the Hiring Dashboard.

## What changed
- Login is **username/email + PIN** (not local profiles).
- Admin actions require an authenticated **ADMIN** dashboard session (or a configured break-glass token).
- A one-time **bootstrap** flow exists to create the first admin safely.

## 1) Required Vercel env vars (backend project)
These must be set on the **backend** Vercel project (h2s-backend).

### Database (MGMT)
- `SUPABASE_URL_MGMT`
- `SUPABASE_SERVICE_KEY_MGMT` (or `SUPABASE_SERVICE_ROLE_KEY_MGMT`)

### First-admin bootstrap (pick one)
Preferred (one-time bootstrap):
- `H2S_DASHBOARD_BOOTSTRAP_SECRET` (long random string)

Optional break-glass (shared secret):
- `H2S_ADMIN_TOKEN`

Notes:
- You can unset/rotate `H2S_DASHBOARD_BOOTSTRAP_SECRET` after the first admin exists.
- Without **either** bootstrap secret or admin token, you can’t create the first ADMIN user.

## 2) Apply migration (MGMT DB)
Run the accounts schema migration on the MGMT database:

```powershell
cd backend
node apply_migration_rpc.js 007_create_dashboard_accounts.sql --mgmt
```

This creates:
- `Dashboard_Users`
- `Dashboard_Sessions`

## 3) Deploy backend
From workspace root:

```powershell
./deploy-backend-and-verify.ps1
```

This script now:
- best-effort checks Vercel env vars
- applies the MGMT migration (unless `-SkipMigrations`)
- builds + deploys backend + runs the existing smoke verification

## 4) Create first admin (one-time)
Open the dashboard with bootstrap UI:

- `https://portal.home2smart.com/dash?bootstrap=1`

Fill:
- Bootstrap secret (matches `H2S_DASHBOARD_BOOTSTRAP_SECRET`)
- Display name
- Username (optional; will be normalized to uppercase)
- PIN (optional; blank will auto-generate)

After creation:
- Sign in normally with username/email + PIN.
- Use **Admin → Accounts** to create VA logins.

## 5) Ongoing account ops
- Create user: Admin → Accounts → Create (PIN can be blank; system generates temp PIN).
- Reset PIN: Admin → Accounts → Reset PIN (returns temp PIN).
- Change own PIN: top bar → Change PIN.

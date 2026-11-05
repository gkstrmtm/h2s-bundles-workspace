# Technician portal packaging

The reviewed repository-root `portal.html` is authoritative, not either
`frontend/portal.html` or `backend/public/portal.html`.

From `backend`, `npm run build` runs `package:portal` before the existing Prisma
generation and Next build. `vercel-build` still delegates to `build`. The packager
resolves sources relative to its own location, not the current directory:

| Canonical input | Generated backend static file |
| --- | --- |
| `portal.html` | `backend/public/portal.html` |
| `frontend/field-workflow.css` | `backend/public/frontend/field-workflow.css` |
| `frontend/field-installation.js` | `backend/public/frontend/field-installation.js` |

These are the two local stylesheet/script dependencies actually referenced by the
enrollment integration. The installation script is a standalone browser IIFE
exposing `H2SFieldInstallation`; it imports no other modules. The stylesheet has
no imports or URL assets. No sales/management bundles are needed.

Committed `frontend/vercel.json` sends portal-domain `/portal`, `/portal/(.*)`,
`/portal.html`, **and its catchall** to
`https://h2s-backend.vercel.app/portal.html`. Consequently both `./frontend/...`
and `/frontend/...` on that domain return HTML, not assets. Only the two generated
asset references are changed to
`https://h2s-backend.vercel.app/frontend/field-workflow.css` and
`https://h2s-backend.vercel.app/frontend/field-installation.js`. This also works
for nested portal entry paths. Inputs and all other portal bytes (legacy features,
external CDN references, API calls and existing service-worker registration) are
preserved. Existing unrelated public files are not removed.

Focused offline validation, from `backend`:

```powershell
npm run test:portal-packaging
```

Tests create unique isolated output directories inside the checkout and remove
them afterward; they never package into the real `backend/public`. An explicit
isolated output can also be supplied with
`node tools\package-portal.cjs --output <isolated-directory>`.

**Run the full backend build only in an isolated snapshot for this readiness
task.** The real output mirrors/configuration are dirty. Default packaging/build
intentionally writes generated public files and must not run against this
worktree. These tests establish packaging/routing compatibility with the
committed configuration, not production deployment, API activation, or readiness
of any dirty routing changes.

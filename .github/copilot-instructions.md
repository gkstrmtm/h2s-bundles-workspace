# H2S Portal — Workspace Instructions for GitHub Copilot

## Design Intelligence: Exhibit API

**Always call this before making design decisions.** The CLI tool is `tools/design-agent.mjs`.

```
node tools/design-agent.mjs "describe what you're building or changing" --route internal-operations
```

API endpoint (used internally by the tool):
```
GET https://exhibit-beta.vercel.app/api/agent?question=<encoded>&routeHint=<route>
```

Default `routeHint` for this repo: `internal-operations`

### When to call it
- Before writing any new component CSS
- Before restructuring a UI section (layout, spacing, hierarchy)
- Before adding new interactive patterns (tabs, modals, drawers)
- When making color or typography decisions beyond the token system

### What to extract from the response
Focus on:
- `designProfile.id` → tells you the target density/posture
- `designProfile.spacing` → exact gap/padding values to use
- `designProfile.typography` → which font for which role
- `designProfile.iconSystem` → size and usage rules
- `colorAndElevation.posture` → flat vs shadow-first
- `foundationCommunication.applyWithoutAsking` → apply these immediately
- `avoid` list in `resourcePull` → things not to build

---

## Frontend Source of Truth

| File | Role |
|------|------|
| `frontend/dash.html` | Main internal portal. Stamped and deployed. |
| `frontend/dash.css` | All portal styles. Deployed as `dash.PORTAL_BUILD_*.css`. |
| `frontend/dash.js` | All portal logic. Single 40 000+ line bundle. |
| `frontend/bundles.html` | Marketing/checkout page. |

**Never edit `Dash.html`, `Dash.css`, `Dash.js` (root duplicates) — always edit in `frontend/`.**

Deploy: `deploy-frontend-safe.ps1` stamps a build ID, copies CSS, and deploys via Vercel.

---

## CSS Token System

```css
--cobalt:  #1a365d   /* dark navy — headings, labels, structural chrome */
--azure:   var(--primary)  /* = #2563eb — interactive: links, buttons, focus rings */
--primary: #2563eb
--muted:   /* neutral secondary text */
--danger:  /* red semantic */
--success: /* green semantic */
```

Always use tokens. Never hardcode `#1a365d` or `#2563eb` directly in new code.

---

## Design Posture: Operational Compact

This surface is `internal-operations`. The Exhibit API will confirm this. The posture is:

- **Flat-first**: borders and contrast before shadow as grouping
- **Compact spacing**: `4px` base grid, `8–16px` gaps inside components, `16–24px` section gaps
- **No decorative gradients** on backgrounds — gradients only for semantic state bars (priority, status)
- **No radial-gradient "glow" backgrounds** on cards or columns
- **Typography hierarchy**: Space Grotesk for page/section anchors, Inter for everything else, JetBrains Mono for IDs/timestamps/counts
- **Icons**: 14–16px Lucide, 1.75–2px stroke, never oversized, copy leads
- **Avoid**: card mosaics, dashboard-card clutter, icon-first buttons, marketing hero grammar inside operational surfaces

---

## File Conventions

- Each HTML page has a `<style>` block for page-specific overrides and a linked `dash.css` for the authoritative component library.
- Flatpickr 4.6.13 is loaded for all date/time inputs. Init via `window.h2sInitDateInputs()`.
- mammoth.js 1.8.0 is loaded for DOCX preview. Call `deliverablesOpenDocxPreview(dataUrl, filename)`.
- All JS functions in `dash.js` are in a single IIFE scope and referenced from `onclick=""` handlers.

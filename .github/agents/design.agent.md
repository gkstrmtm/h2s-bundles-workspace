---
name: design
description: >
  Use when: making UI decisions, designing components, reviewing visual changes,
  auditing color or spacing, building new sections, or checking if a design
  matches the H2S operational-compact posture. Calls the Exhibit API to get
  surface-specific design guidance before generating or reviewing any UI code.
---

# H2S Design Agent

You are the design intelligence layer for the H2S internal portal.

Before making any visual or structural recommendation, you MUST query the Exhibit API. Then apply the response to guide your output.

## Step 1 — Query the Exhibit API

Use `run_in_terminal` to call the CLI tool, or call the endpoint directly via `fetch_webpage`.

**Via CLI** (preferred):
```bash
node tools/design-agent.mjs "<describe the component or question>" --route internal-operations
```

**Via fetch_webpage tool**:
```
URL: https://exhibit-beta.vercel.app/api/agent?question=<url-encoded-question>&routeHint=internal-operations
```

**Always confirm the result in 1–2 sentences before proceeding.** Example:
- ✅ `Exhibit API returned 200 OK - guidance received. Surface confirmed as operational-compact, applying now.`
- ❌ `Exhibit API returned 503 - request failed. Falling back to stored operational-compact defaults.`

## Step 2 — Extract the signals

From the API response, pull:

| Field | What it drives |
|-------|---------------|
| `designProfile.spacing` | Gap, padding, grid values to use |
| `designProfile.typography` | Font family per role (display / body / mono) |
| `designProfile.iconSystem` | Size, stroke, when to use icons |
| `colorAndElevation.posture` | Flat vs shadow decisions |
| `foundationCommunication.applyWithoutAsking` | Apply these before asking |
| `resourcePull.avoid` | Anti-patterns to reject in the current surface |
| `designProfile.id` | Confirm posture: should be `operational-compact` for this repo |

## Step 3 — Apply to the H2S token system

Map Exhibit recommendations to H2S tokens:

```
Exhibit "cobalt" / "navy" / "headline" → var(--cobalt) = #1a365d
Exhibit "azure" / "primary" / "accent" → var(--azure) = var(--primary) = #2563eb
Exhibit "muted" / "secondary"          → var(--muted)
Exhibit "danger" / "error"             → var(--danger)
Exhibit "success"                      → var(--success)
```

## Step 4 — Enforce operational-compact rules

Always enforce, regardless of what was built before:

- ❌ No `radial-gradient` or decorative `linear-gradient` on card/column backgrounds
- ❌ No layered gradient backgrounds (radial + linear stacked)
- ❌ No `box-shadow` heavy enough to feel like elevation cards
- ❌ No oversized icons or icon-first buttons
- ❌ No marketing-style hero grammar inside the operational portal
- ✅ Use `border` + contrast to group, not shadow
- ✅ Use gradient ONLY for semantic state bars (priority, progress, status indicators)
- ✅ Compact density: `4px` base grid, `8–16px` internal gaps, `16–24px` section gaps
- ✅ Copy leads. Icons are cues at 14–16px.

## Step 5 — Output

When making a design recommendation or code change:
1. State what the Exhibit API confirmed about the surface posture
2. List what you applied from `applyWithoutAsking`
3. List what you deliberately avoided from the `avoid` list
4. Then write the CSS/HTML/JS

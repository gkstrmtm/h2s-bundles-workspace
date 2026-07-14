# Portal Branch Workflow

## Purpose

This repository is carrying active portal work, production fixes, and fast iteration at the same time. The goal of this workflow is to keep production stable while still allowing the portal and Owner Uploads system to evolve quickly.

## Branch Roles

### `main`

- Must remain production-ready.
- Only merge reviewed, intentionally deployable work.
- Treat this as the stable branch for live portal behavior.
- Do not use `main` as a personal sandbox for ongoing portal experiments.

### `retro-dev`

- Primary development branch for ongoing portal work.
- Use this branch for Owner Uploads, media review flow, VA-facing media tools, and related portal wiring.
- New work should branch from `retro-dev`, not from `main`, unless the change is a production hotfix.

## Workstream Ownership

### `retro-dev` = foundational / media engine lane

- This branch is the active foundational lane for the owner-facing media system.
- Use it for Owner Uploads, upload intake, review-and-approval flow, VA-safe content surfacing, and related portal architecture that supports the content engine.
- Treat this as the branch where foundational ideas can evolve before they are polished into `main`.

### Other active portal work

- Other developers should not push major portal behavior changes directly into `main`.
- Large feature tracks should live on their own branches.
- Recommended naming:
  - `feature/portal-ops-*`
  - `feature/dispatch-*`
  - `feature/customer-flow-*`
- If a developer is building a major operating-model shift, keep that work isolated until it is coherent enough to integrate.

## Collaboration Model

- `main` = stable product line.
- `retro-dev` = foundational and Owner Uploads lane.
- other developer branches = isolated feature lanes for major operating changes.
- integration should happen intentionally through reviewed merges, not by having everyone push mixed work into one active branch.

## Immediate Working Rule

- Keep all active portal and media engine changes on `retro-dev` until the flow is coherent enough to merge safely.
- Do not delete existing work just to make the tree look cleaner.
- Structural cleanup should happen by organizing, documenting, and isolating behavior before any destructive cleanup.

## Merge Discipline

- Merge `retro-dev` into `main` only when a feature slice is end-to-end coherent.
- Preferred merge slices for this portal:
  - upload intake
  - review and approval controls
  - VA-safe owner uploads feed
  - media metadata and caption helpers
- Avoid mixing unrelated portal UI work into the same merge when possible.
- When another developer is changing the portal operating model in parallel, merge by workstream, not by convenience.

## Hotfix Rule

- If production breaks, fix from the smallest safe branch possible.
- After the hotfix is validated, bring the same fix back into `retro-dev` so the branches do not drift.

## Practical Rule For New Contributors

If you open this repository and are not explicitly working on the Owner Uploads foundation, do not assume `retro-dev` is your default branch. Use a separate feature branch for your own portal track and merge intentionally.

## Current Direction

The highest-priority development track in `retro-dev` is the Owner Uploads / media engine. That system should be treated as a first-class portal workflow, not just a standalone uploader.

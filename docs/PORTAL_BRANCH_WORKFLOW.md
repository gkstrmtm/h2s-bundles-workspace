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
- Use this branch for Owner Uploads, lightweight media review flow, VA-facing media tools, and related portal wiring.
- New work should branch from `retro-dev`, not from `main`, unless the change is a production hotfix.

## Workstream Ownership

### `retro-dev` = foundational / media engine lane

- This branch is the active lane for the current owner-facing media workflow.
- Use it for Owner Uploads, manual upload intake, lightweight review-and-approval flow, VA-safe content surfacing, and related portal architecture.
- Do not assume Owner Uploads is already the full technician proof system.
- Treat this as the branch where the current content workflow can evolve cleanly before it is polished into `main`.

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
  - owner/admin upload intake
  - review and approval controls
  - VA-safe owner uploads feed
  - media metadata and caption helpers
- Build future technician job-media slices separately instead of forcing them into the current Owner Uploads surface too early.
- Avoid mixing unrelated portal UI work into the same merge when possible.
- When another developer is changing the portal operating model in parallel, merge by workstream, not by convenience.

## Hotfix Rule

- If production breaks, fix from the smallest safe branch possible.
- After the hotfix is validated, bring the same fix back into `retro-dev` so the branches do not drift.

## Practical Rule For New Contributors

If you open this repository and are not explicitly working on the Owner Uploads foundation, do not assume `retro-dev` is your default branch. Use a separate feature branch for your own portal track and merge intentionally.

## Current Direction

The highest-priority development track in `retro-dev` is the current Owner Uploads workflow: a simple manual content pool that supports review, approval, and VA social usage now.

The more structured Technician Job Media system should be treated as a separate later build that can eventually feed approved content into Owner Uploads.

# Portal Workstreams

## Why this exists

Portal development is happening in parallel across different product ideas. This document makes those lanes explicit so contributors do not accidentally blend unrelated changes together.

## Current Workstreams

### 1. Foundational media engine

Primary branch: `retro-dev`

Purpose:

- build the Owner Uploads / media engine
- stabilize upload intake
- attach media to real jobs or sessions
- add review and approval flow
- expose a VA-safe approved media feed

This lane is about long-term content infrastructure, not just a standalone uploader.

### 2. Portal operating-model changes

Primary branch style:

- `feature/portal-ops-*`
- `feature/dispatch-*`

Purpose:

- major UX or operating-flow changes inside the portal
- changes that make the portal behave more like an active dispatch or marketplace system
- operational workflows that may be substantial on their own and should not be mixed into the media-engine lane prematurely

This is the right lane for large product-shape changes that affect how the portal behaves day to day.

### 3. Stable production line

Primary branch: `main`

Purpose:

- stable deployable branch
- reviewed merges only
- production fixes and coherent feature slices

## Integration Rule

The portal becomes polished as one system later, but development does not need to happen in one branch first.

The rule is:

- build workstreams separately
- keep each lane conceptually clean
- merge only when a slice is understandable and stable enough to review

## Decision Test

Before making a change, ask:

1. Is this a stable production fix?
2. Is this foundational Owner Uploads/media-engine work?
3. Is this a separate portal operating-model feature?

The answer should determine the branch lane before code is changed.

## Current Priority

Right now the highest-leverage foundational lane is:

`Upload -> Review -> Approve -> Owner Uploads -> Social post`

That work should remain legible and protected from unrelated portal drift.

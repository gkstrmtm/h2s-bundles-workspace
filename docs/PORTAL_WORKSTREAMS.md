# Portal Workstreams

## Why this exists

Portal development is happening in parallel across different product ideas. This document makes those lanes explicit so contributors do not accidentally blend unrelated changes together.

## Current Workstreams

### 1. Owner Uploads content lane

Primary branch: `retro-dev`

Purpose:

- keep Owner Uploads as a simple manual content source
- stabilize owner/admin upload intake
- add lightweight review and approval flow
- expose a VA-safe approved media feed for social content
- avoid overfitting this surface to future technician-proof requirements

This lane is about making the current content workflow useful now, without prematurely collapsing it into the technician job-media system.

### 2. Future technician job-media system

Primary branch: later scoped feature work off `retro-dev` or a dedicated branch when started

Purpose:

- tie uploads to exact job IDs
- capture technician, service type, city, and completion-date context
- use media as job proof first
- review proof media before any downstream social use
- route approved technician media into Owner Uploads later when appropriate
- preserve a path to a future technician-facing iOS and Android app

This is a more structured, higher-volume system and should stay conceptually separate from the current Owner Uploads surface.

This lane should be designed so the same job-completion workflow can eventually be submitted from a mobile app, not just from a browser.

### 3. Portal operating-model changes

Primary branch style:

- `feature/portal-ops-*`
- `feature/dispatch-*`

Purpose:

- major UX or operating-flow changes inside the portal
- changes that make the portal behave more like an active dispatch or marketplace system
- operational workflows that may be substantial on their own and should not be mixed into the media-engine lane prematurely

This is the right lane for large product-shape changes that affect how the portal behaves day to day.

### 4. Stable production line

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
2. Is this current Owner Uploads content-lane work?
3. Is this future technician job-media work?
4. Is this a separate portal operating-model feature?

If the answer is technician job-media work, decisions should also be checked against the future mobile-app flow in `docs/TECHNICIAN_APP_ROADMAP.md`.

The answer should determine the branch lane before code is changed.

## Current Priority

Right now the highest-leverage active lane is:

`Upload -> Review -> Approve -> Owner Uploads -> Social post`

That work should remain legible, light, and protected from unrelated portal drift or premature technician-proof complexity.

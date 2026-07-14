# Owner Uploads Engine

## Goal

Turn completed technician jobs into a durable media pipeline that can feed social proof, content creation, advertising, training, and future educational assets.

This is not just a file upload tool. It is a proof-of-work content system.

## Core Flow

1. Technician completes job.
2. Technician uploads job photos or videos.
3. Media is attached to the relevant job or upload session.
4. Owner or admin reviews the media.
5. Approved media becomes available in Owner Uploads.
6. VA uses approved media for social posting and content production.

## First Release Scope

The first clean version should optimize for this path only:

`Upload -> Review -> Approve -> Owner Uploads -> Social post`

That means the first version does **not** need to solve every future content use case before it is useful.

## Operating Principles

### 1. Real job proof first

- Media should come from completed real jobs.
- The system should favor authenticity and context over polished asset production.

### 2. VA-safe output

- The VA-facing feed should only expose approved, usable content.
- Do not expose sensitive customer data in Owner Uploads.
- The feed should be useful without opening operational risk.

### 3. Enough context to use the media

Approved items should eventually include lightweight context such as:

- service type
- city or area
- upload date
- technician or source context when useful
- simple suggested caption or framing note

### 4. Separate intake from publication

- Uploading media does not automatically make it VA-ready.
- Review and approval is the boundary between raw operational media and reusable brand content.

## System Layers

### Intake Layer

Purpose: capture technician and owner media reliably.

Current related surfaces:

- `frontend/owner-media.html`
- `frontend/owner-media.css`
- `frontend/owner-media.js`
- `backend/app/api/owner-media/session/route.ts`
- `backend/app/api/owner-media/uploads/route.ts`
- `backend/app/api/admin/proof-upload/route.ts`

### Review Layer

Purpose: let owner/admin decide what is usable.

Needed behavior:

- inspect recent uploads
- reject unusable or sensitive uploads
- approve usable uploads
- keep review state lightweight and operationally clear

### Owner Uploads Feed

Purpose: provide a simple approved-media surface for VA content work.

Feed requirements:

- approved recent media only
- no sensitive customer information
- enough metadata to make content decisions quickly
- simple, low-friction browsing rather than operational clutter

## Data Boundary

There are three conceptual states for media:

1. raw upload
2. reviewed and approved
3. VA-usable owner uploads feed

The portal should make those boundaries explicit in code and route design, even if the UI remains simple.

## Near-Term Build Priorities

1. Stabilize upload intake and attachment to a job or upload session.
2. Add review and approval state in a controlled backend model.
3. Expose only approved items inside Owner Uploads.
4. Add lightweight metadata for social usefulness.

## Longer-Term Expansion

Once the first clean pipeline works, this can expand into:

- before and after media
- technician POV footage
- install walkthrough clips
- training clips
- social media assets
- paid ad creative
- educational content with voiceover or spokesperson commentary

## Repository Intent

All future Owner Uploads work should be evaluated against this question:

Does this make the proof-of-work content engine clearer, safer, and more usable?

If not, it is probably incidental portal complexity and should not be prioritized ahead of the core pipeline.

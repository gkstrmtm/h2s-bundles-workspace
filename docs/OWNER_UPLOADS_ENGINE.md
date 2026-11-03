# Owner Uploads Engine

## Goal

Keep the current Owner Uploads area useful right now as a simple, owner-controlled content pool for VA social workflow, without prematurely turning it into the full technician proof system.

Owner Uploads and Technician Job Media are related, but they should not be treated as the same system.

## Current Separation

### Owner Uploads

Current role:

- manual upload area
- used for social content
- owner/admin controlled
- VA pulls from approved assets
- simple and flexible for now
- should preserve both upload time and original media time when available

This is the current content source. It does not need job-proof precision yet.

### Technician Job Media

Future role:

- tied to a specific job ID
- uploaded during the job flow
- attached to technician, service type, city, and completion date
- used as job proof first
- reviewed before becoming social content
- routed and stored more strictly
- designed so the same proof workflow can later be submitted from a technician mobile app on iOS and Android

This is the later, higher-volume operational system and should be built as its own structured workflow.

## Relationship Between The Systems

- Technician uploads feed job proof.
- Owner Uploads feeds social content.
- Approved technician media can later feed into Owner Uploads.
- That relationship should be additive, not a reason to collapse both systems into one model right now.

## Current Core Flow

The current clean path should optimize for this only:

`Upload -> Review -> Approve -> Owner Uploads -> Social post`

For now, that can be owner/admin-led media, not a full technician-proof pipeline.

## Operating Principles

### 1. Do not overbuild Owner Uploads

- Do not force exact job routing into the current Owner Uploads surface.
- Do not make the VA content pool carry all future technician-proof requirements.
- Keep the current system operationally simple.

### 2. Keep Owner Uploads VA-safe

- The VA-facing feed should expose approved, usable content only.
- Do not expose sensitive customer information.
- Keep the browsing experience low-friction and content-oriented.

### 3. Keep review as the boundary

- Uploading media does not automatically make it VA-ready.
- Review and approval separate raw uploads from reusable brand content.

### 4. Preserve a future bridge

- Technician-approved media should be able to flow into Owner Uploads later.
- That future bridge should not distort the simpler current model.

### 5. Keep upload time and original media time separate

- `created_at` answers when the system received the upload.
- `captured_at_original` answers when the media was originally created or captured when that information is available.
- The library should be able to answer both "uploaded this week" and "captured this week" without pretending they mean the same thing.

## Current System Layers

Implementation detail for portal wiring: see `docs/OWNER_UPLOADS_LIBRARY_WIRING.md` for the current metadata and API contract that separates admin review from media-team-safe library exposure.

### Owner Upload Intake

Purpose: capture owner/admin media reliably for the current content pool.

Current related surfaces:

- `frontend/owner-media.html`
- `frontend/owner-media.css`
- `frontend/owner-media.js`
- `backend/app/api/owner-media/session/route.ts`
- `backend/app/api/owner-media/uploads/route.ts`
- `backend/app/api/admin/proof-upload/route.ts`

### Review Layer

Purpose: let owner/admin decide what is usable for content.

Needed behavior:

- inspect recent uploads
- reject unusable or sensitive uploads
- approve usable uploads
- keep review state lightweight and clear

### Owner Uploads Feed

Purpose: provide a simple approved-media surface for VA content work.

Feed requirements:

- approved recent media only
- no sensitive customer information
- enough lightweight context to make content decisions quickly
- simple browsing instead of operational clutter
- preserve enough date context to organize by upload date or original capture date later

## Future Technician Job Media Layer

This is a separate later build, not a requirement for the current Owner Uploads surface.

Long-term mobile direction: see `docs/TECHNICIAN_APP_ROADMAP.md`.

Technician Job Media should eventually include:

- job-linked uploads
- technician attribution
- service type
- city or area
- completion date
- proof-first review flow
- downstream approval into social-content surfaces when appropriate

## Near-Term Build Priorities

1. Keep Owner Uploads stable as a manual content source.
2. Add lightweight review and approval behavior.
3. Expose only approved items inside the VA-facing Owner Uploads feed.
4. Add lightweight content metadata only where it helps social usage.

## Longer-Term Expansion

After the current Owner Uploads workflow is working cleanly, build the more precise Technician Job Media system separately and then connect approved technician media into Owner Uploads as a downstream source.

## Repository Intent

All near-term Owner Uploads work should be evaluated against this question:

Does this keep the current VA content workflow useful now without overfitting it to the later technician-proof system?

If not, it is probably pushing the current surface too far ahead of its role.

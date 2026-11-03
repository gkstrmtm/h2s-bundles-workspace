# Technician App Roadmap

## Purpose

This roadmap defines the long-term direction for a technician-facing Home2Smart app on iOS and Android.

This is not a side idea and not just an upload utility.

The technician app should eventually be a job-completion app where media capture is part of the assigned-job workflow.

## Core Product Concept

The technician flow should eventually be:

1. Technician logs in.
2. Technician sees assigned jobs.
3. Technician opens a specific job.
4. Technician completes the work.
5. Technician captures required photos or videos inside that job.
6. Media attaches to the job record.
7. Job is submitted as completed.
8. Owner or admin reviews the job media.
9. Approved media can later feed into Owner Uploads and social-content workflows.

The important product rule is:

Technicians should not be casually uploading random media into a loose folder.

The media flow should behave more like delivery proof or completion proof tied to a specific job.

## Relationship To Current Portal Work

Current priority remains the portal foundation.

That means:

- the web portal can keep being built first
- Owner Uploads can remain the current manual content pool
- the future technician system should be designed so it can later support mobile app submission without rebuilding the workflow from scratch

## System Separation

### Owner Uploads

Current role:

- owner/admin controlled
- manual content pool
- used for VA and social-content work
- simple, flexible, downstream content surface

### Technician Job Media

Future role:

- tied to exact job IDs
- submitted during job completion flow
- captures technician, service type, city, completion date, and proof context
- reviewed before any downstream social use
- becomes a structured source that can feed approved assets into Owner Uploads later

## Architecture Rules To Preserve Now

The portal should be built in ways that keep the future mobile app feasible.

### 1. Make jobs the canonical unit

- technician media should attach to a job, not just a loose upload bucket
- job status and media submission should share the same workflow boundary
- completion should eventually be a structured event, not just a file transfer

### 2. Keep review and publication server-side

- approval, rejection, QA hold, and media-team visibility should be enforced by backend rules
- web and mobile clients should both rely on the same server-side decisions

### 3. Keep Owner Uploads downstream

- Owner Uploads should remain the social/content surface
- Technician Job Media should remain the proof and accountability surface
- approved technician media can feed downstream into Owner Uploads later

### 4. Avoid web-only assumptions

- do not design the future technician workflow around browser-only behavior
- keep API contracts transport-neutral so web, iOS, and Android clients can use them
- keep authentication, media registration, review state, and completion state in backend contracts

### 5. Preserve policy metadata

- customer media opt-in
- usage rights status
- QA hold
- review state
- user role permissions

Those rules must survive across web and mobile clients.

## Mobile-Ready Workflow Requirements

The future technician app should support:

- technician login
- assigned-jobs list
- single-job detail view
- required checklist or completion steps
- in-job camera and gallery capture
- upload progress and retry handling
- proof submission tied to the job
- completion confirmation
- owner/admin review downstream

## Mobile-Ready Platform Requirements

The future release plan should assume:

- iOS app via Apple App Store
- Android app via Google Play Store

### Apple App Store planning

- Apple Developer Program account required
- current cost target: `$99` per membership year
- app review must pass Apple requirements around safety, performance, business, design, and legal compliance

### Google Play planning

- Google Play Console developer account required
- current cost target: `$25` one-time registration fee
- app review must pass Google Play requirements around safety, privacy, content, and trust

## Release Readiness Checklist

The app roadmap should eventually include:

- clear app name
- company or developer account setup
- app icon
- splash screen
- login system
- privacy policy
- terms of service
- data safety disclosures
- camera and photo permissions
- media upload permissions
- user role permissions
- technician account flow
- admin review flow
- test accounts for app reviewers
- basic support contact
- stable production build

## Suggested Build Sequence

### Phase 1. Portal foundation

- stabilize current portal structure
- keep Owner Uploads useful now
- establish clean review and media policy boundaries

### Phase 2. Technician workflow on the web

- define assigned-job flow
- define job detail and completion steps
- define job-linked media capture requirements
- define owner/admin review path for proof media

### Phase 3. Mobile-ready backend contracts

- ensure job APIs are clean and role-aware
- ensure upload and media registration contracts are job-linked
- ensure review, QA hold, and publication rules are server-side
- ensure auth patterns can support app sessions securely

### Phase 4. Mobile app implementation

- build technician-facing iOS and Android app experience
- support camera capture, upload retry, and submission confirmation
- run internal testing and reviewer-account preparation

### Phase 5. Store readiness and launch

- privacy and policy review
- app store assets
- test accounts
- support contact
- production approval flow

## Long-Term Outcome

If the workflow is built correctly, the technician app becomes the front door for:

- job proof
- technician accountability
- customer trust assets
- training content
- social proof
- paid ad creative
- a durable content engine built from completed work

## Repository Intent

When making technician-workflow decisions, ask:

Would this still make sense if the technician were completing the same job inside an App Store-approved mobile app instead of a browser?

If not, the workflow is probably too web-specific and should be reconsidered.
# AI PROJECT MAP & TRUTH SOURCE

> **CRITICAL INSTRUCTION FOR AI AGENTS**: READ THIS FILE FIRST.

This project suffers from file duplication artifacts. This map defines the **SINGLE SOURCE OF TRUTH (SSOT)** for key components. You must ONLY edit the SSOT files. Editing other files will result in overwritten work.

## ? WEB PORTAL
**Concept**: The main Pro Portal UI (HTML/JS)
**Features**: Job Details, Profile, Payouts, Schedule
**? SSOT FILE**: `frontend/portal.html`
**? READ-ONLY ARTIFACTS** (Do Not Edit):
- `portal.html` (Automated Copy)
- `backend/public/portal.html` (Automated Copy)
- `deployed-portal.html` (Historical artifact, ignore)

## ? SHOP / BUNDLES
**Concept**: The Shopping Cart / Bundles Page
**? SSOT FILE**: `frontend/bundles.html`
**? READ-ONLY ARTIFACTS**:
- `bundles.html` (Automated Copy)
- `backend/public/bundles.html` (Automated Copy)

## ? DEPLOYMENT
**Concept**: Logic to deploy the site
**? SCRIPT**: `deploy-and-verify.ps1`
**Rule**: This script handles the copying of SSOT files to Artifact locations.

## ? HOW TO EDIT
1. Open `frontend/portal.html`.
2. Make changes.
3. Run `.\deploy-and-verify.ps1` (or `git add/commit/push` which triggers Vercel).
4. **NEVER** edit `portal.html` directly.

## ? DEBUGGING
- **Logs**: Look for `[JOB_MODAL_DEBUG]` in browser console to verify specific rendering logic.

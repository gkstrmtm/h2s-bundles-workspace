# Offer Brief Deliverable Spec (Expectation + Acceptance Checklist)

Date: 2026-02-27

This document defines what a **Brief Offer Deliverable** must contain, how it should be generated/exported, and the exact acceptance criteria to confirm it is a **complete “full offer”** (not a partial snapshot).

---

## 1) Definition (what “Offer Brief Deliverable” means)

An **Offer Brief Deliverable** is a single, self-contained artifact that:

- Represents the offer in its **full, elevated state** (not “draft-only UI fields”).
- Is **portable** (can be reviewed without the dashboard).
- Contains the **offer-specific copy** required to launch creative and align ops.
- Can be produced as:
  - **Preview (modal)** for fast review, and
  - **PDF export** for distribution.

The deliverable must include:

- **Offer Description** (human-readable core narrative)
- **TOF/BOF ad modules** (offer-specific hooks + primary text)
- The core “economics + mechanics + messaging + ops notes” sections

---

## 2) Non-negotiable requirements (must always be present)

These are “hard requirements.” If any are missing, the deliverable is incomplete.

### A) Offer Snapshot includes Offer Description
Must include:

- Offer name
- Category, market, avatar, intended goal
- Offer dates
- Headline (ad-ready)
- 1-sentence promise
- **Offer Description** (not empty; not placeholder)
- Scarcity mechanism
- Risk reversal

### B) TOF/BOF ad modules included (offer-specific)
Must include:

- A section titled like “TOF/BOF Ad Modules (Offer-Specific Copy)”
- At least one TOF and/or BOF module (when generation is enabled)
- For each module included:
  - Module key / label
  - Hook text
  - Primary text
  - (Optional) CTA

**Quality bar (anti-generic):**
- Module copy must visibly reference offer-specific context (e.g., offer name, market, service, price mechanic, or concrete angle) and not read like universal template copy.

### C) Exact mechanics (“The Deal”)
Must include:

- Regular price vs offer price
- Discount type + amount
- What’s included / not included
- Eligibility + redemption rules
- Services list (line items)

### D) Unit economics
Must include:

- Customer price (AOV)
- Tech payout + materials + fees
- Profit and margin
- Where it can break + safeguards

### E) Ops notes + reusable messaging
Must include:

- In-home script notes (or explicit N/A)
- Special instructions
- Capacity assumption
- Cancellation/reschedule risks
- Messaging pack (booking microcopy, SMS confirmation, SMS reminder, price line, tech broadcast)

---

## 3) Strongly recommended sections (should be present unless truly N/A)

These are not always mandatory, but the deliverable is expected to cover them whenever the offer has the information.

- Value equation
- Competitor reality check
- Creative angles (hooks / objections / proof ideas)
- Decision notes (best case / worst case / confidence)
- Platform copy (Meta): headline/subheadline/primary text variants/landing bullets/disclaimer
- Customer-facing offer statement
- Executive summary
- Value stack
- Social proof + urgency mechanics
- Eligibility / rules (if separate)

---

## 4) Generation rules (what must happen before preview/export)

To be considered “full offer,” the system must ensure:

1) The latest offer inputs are collected into a snapshot.
2) The offer snapshot is saved (or at minimum, the preview/export uses the up-to-date snapshot).
3) TOF/BOF modules are generated/ensured so preview/PDF are not missing the copy section.

Practical expectation:

- If a user clicks “Generate Brief,” the system should:
  - Create/refresh the saved offer snapshot (silent save is OK)
  - Ensure modules exist (silent/background generation is OK)
  - Then render preview/export using the completed snapshot

---

## 5) Acceptance checklist (copy/paste verification)

Use this to confirm the deliverable “covers all bases.”

### Preview (modal) acceptance
- [ ] Offer Snapshot shows **Offer Description** (not blank)
- [ ] TOF/BOF modules section exists
- [ ] At least one module renders hook + primary text (when modules exist)
- [ ] The Deal section includes discount mechanic + included services
- [ ] Unit economics section includes profit + margin
- [ ] Messaging pack is present
- [ ] Ops notes are present

### PDF export acceptance
- [ ] PDF includes Offer Description in Offer Snapshot
- [ ] PDF includes TOF/BOF modules section when modules exist
- [ ] PDF includes the same mechanics/economics sections as preview
- [ ] Export is blocked only by hard-fail guardrails (or explicitly confirmed when unprofitable)

### “Full offer” integrity acceptance
- [ ] Preview and PDF reflect the same snapshot (no mismatch)
- [ ] Module copy is offer-specific (not generic)
- [ ] “No copy yet” does not appear when modules exist in DB for that offer

---

## 6) Common gaps (what to watch for)

These are the typical failure modes that make people say “it didn’t export the full offer.”

1) **Offer Description missing**
- Symptom: snapshot looks like a form dump but lacks the narrative.
- Fix expectation: Offer Description is explicitly rendered in preview and export.

2) **TOF/BOF modules missing (“No copy yet”)**
- Symptom: module section absent or empty even when the offer should have modules.
- Fix expectation: brief generation ensures modules before rendering.

3) **Thin offer payload**
- Symptom: library list view loads an offer without `offer_frameworks.modules` so UI shows empty.
- Fix expectation: hydrate full offer row before rendering modules.

4) **Generic/reused module copy across offers**
- Symptom: multiple offers share identical hooks/primary text.
- Fix expectation: backend detects generic modules and regenerates/overwrites.

5) **Preview vs PDF mismatch**
- Symptom: preview shows content but PDF omits it (or vice versa).
- Fix expectation: both consume the same snapshot and module structure.

---

## 7) Output format expectations (style)

- Human-readable headings
- Clear numbering
- Copy blocks preserve line breaks where meaningful
- Sections explicitly say “N/A” rather than silently disappearing when data is missing

---

## 8) Definition of “done”

This deliverable is considered complete when:

- Preview shows Offer Description + TOF/BOF modules + mechanics/economics sections.
- PDF includes the same critical content (especially Offer Description + TOF/BOF modules).
- “Full offer” is reproducible immediately after creation (no waiting, no manual refresh rituals).

# Proof Rail Visual Consistency Problem - Context for AI Agents

## Problem Statement

The user is experiencing a **fundamental visual inconsistency** between three different renderers of the same proof asset:

1. **Editor Preview** ("Proof Rail (4:3)" stage in Dash.html)
2. **"Recent Installs" tiles** (customer-facing shop on bundles page)
3. **Library Grid** (admin asset library in Dash.html)

## Core Issues Identified

### Issue 1: Recent Installs Tiles Don't Match Editor Preview

**Symptom**: When the user edits an asset in the Proof Rail Editor and sets a specific crop/frame, the "Recent Installs" section on the bundles page shows a **completely different visual presentation** of the same asset.

**User's Frustration**: 
- "You can still see the difference"
- "All of those are completely different from what I'm showing you in relation or in scale"
- "I want it to look the same. I don't want to see the raw picture"

**Technical Root Cause**:
- The editor uses one set of rendering rules (objectFit, objectPosition, transform constraints)
- The shop tiles were using **different** rules, causing letterboxing or incorrect framing
- The CSS default (`object-fit: cover`) was being overridden with `contain`, causing the "floating image in a black box" effect

**Critical Misunderstanding by AI**:
The AI initially interpreted the "floating image with black matte" as a BUG, when in reality:
- The editor's crop/cutoff behavior is **INTENTIONAL** (it's supposed to crop)
- The problem is that the **shop tiles don't match** what the editor shows
- User quote: "The way it is showing up in the editor is how I intentionally set it, right? The image size is one thing, but then the window that the image is being displayed in guarantees that there's going to have to be some sort of cutoff. Intentionally, that's the whole point."

### Issue 2: Library Grid Images Are Too Large

**Symptom**: The asset library grid in Dash.html is rendering thumbnails at an excessively large size, making the UI unwieldy.

**User's Frustration**:
- "There are big ass fucking implementations of the images in the library"
- "In a library, when did you blow up the fucking size so much? When?"

**Technical Root Cause**:
- Grid was using `grid-template-columns: repeat(auto-fill, minmax(200px, 1fr))`
- The `1fr` allows tiles to grow indefinitely on wide screens
- Should be capped at a reasonable fixed size (e.g., 160px)

### Issue 3: Scale/Proportion Inconsistencies

**Symptom**: Even when the same transform values are applied, the **visual result** differs across contexts due to:
- Different container aspect ratios
- Different objectFit modes
- Different clamp limits on pan/zoom

**User's Frustration**:
- "You need to pinpoint exactly what is causing how much of the image shows up, how big it is relative to the stage it's on"
- "How big of an area the guard rail or the outline is"

**Technical Insight**:
The user is asking for **pixel-perfect WYSIWYG** behavior:
- What you see in the editor's "Proof Rail (4:3)" preview
- **Must match exactly** what customers see in "Recent Installs" tiles
- **Must match exactly** what's shown in library thumbnails

## Key User Requirements (Extracted)

1. **Editor is Source of Truth**: The "Proof Rail (4:3)" editor preview is the canonical representation. All other views must match it.

2. **No Letterboxing/Pillarboxing**: The shop tiles should **fill the frame** (like `object-fit: cover`), not float with black bars (like `object-fit: contain`).

3. **Consistent Transform Math**: Pan, zoom, rotation, and filters must use the **same coordinate system** and **same clamp limits** across all renderers.

4. **Library Grid Size**: Thumbnails in the library should be a reasonable, fixed size (not scaling to fill available space).

5. **Intentional Cropping**: The fact that the editor crops/cuts off parts of the image is **by design**. The problem is when other views show a different crop.

## What the User Does NOT Want

- "I don't want to see the raw picture" (no uncropped full-image views in production contexts)
- No explanations about what the problem "might be" — they want direct action
- No repeated misunderstandings of the same issue
- No assumptions that the editor's crop behavior is a bug (it's the intended behavior)

## Correct Solution Path

1. **Identify the exact CSS + JS rendering logic** for each context:
   - Editor preview (`updatePreviewContext` in Dash.html)
   - Recent Installs tiles (`buildProofMediaStyle` in frontend/bundles.js)
   - Library grid thumbnails (`buildAssetPreviewStyle` in Dash.html)

2. **Ensure all three use identical rules** for proof_rail context:
   - Same objectFit mode (or omit to use CSS default `cover`)
   - Same objectPosition calculation
   - Same pan/zoom/rotation clamp limits
   - Same transform application order

3. **Fix library grid size** independently (it's a pure CSS grid-template-columns issue).

4. **Deploy and verify** that all three views show the same visual result for the same asset.

## Common Pitfalls for AI Agents

1. **Misinterpreting the editor's crop as a bug** instead of the intended behavior.
2. **Forcing `object-fit: contain` everywhere** as a "fix," which causes letterboxing.
3. **Ignoring the library grid size complaint** and only focusing on the Recent Installs tiles.
4. **Applying different physics models** (contain vs cover, tight vs expanded clamps) in different contexts.
5. **Not deploying after making changes**, leaving the user unable to verify the fix.

## Expected Outcome

After correct implementation:
- User opens an asset in the Proof Rail Editor, sets a crop
- The "Proof Rail (4:3)" preview shows the intended framing
- The "Recent Installs" tiles on the shop page show **the exact same framing**
- The library grid thumbnail shows **the exact same framing** (just smaller)
- No letterboxing, no "raw picture," no visual discrepancies

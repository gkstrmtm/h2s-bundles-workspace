# Fix live Home2Smart.com/funnel tracking (HighLevel)

## What’s happening
The live page `https://home2smart.com/funnel` is hosted by HighLevel/LeadConnector and contains an embedded “Custom Code” block with a tracking client.

That embedded client is currently:
- Sending `track('page_unload')` on `beforeunload` (inflates totals)
- Including `page_url: window.location.href` in every tracking payload

Our backend already ignores/doesn’t persist `page_url`, but removing it at the source reduces noise and prevents accidental reintroduction.

## Required fix (copy/paste edits)
In HighLevel:
1. Go to the funnel step for `/funnel`.
2. Open the “Custom Code” element that contains the dashboard HTML.
3. Find the section labeled `TRACKING CLIENT`.
4. Apply BOTH edits below, then save + publish.

### Edit 1 — Stop sending page_url
In the `track()` payload object, delete this line:

```js
page_url: window.location.href,
```

### Edit 2 — Stop sending page_unload
Delete this block entirely:

```js
// Track page unload
window.addEventListener('beforeunload', function() {
  track('page_unload');
});
```

Replace it with:

```js
// Intentionally do not track page unload.
```

## Quick verification
- Open DevTools → Network.
- Reload `https://home2smart.com/funnel`.
- Confirm you see a `POST` to `/api/track` for `page_view`.
- Close/navigate away from the page and confirm there is **no** request/event with `event_type=page_unload`.

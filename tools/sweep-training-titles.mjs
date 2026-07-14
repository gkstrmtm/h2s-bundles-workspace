/**
 * sweep-training-titles.mjs
 *
 * Finds all VIDEO Training_Resources with generic titles ("Training Video", "Training Resource", etc.)
 * and replaces them with the real title fetched from YouTube/Loom oEmbed.
 *
 * Usage:
 *   node tools/sweep-training-titles.mjs           # live run (updates DB)
 *   node tools/sweep-training-titles.mjs --dry-run  # preview only
 */

const SUPABASE_URL  = 'https://ngnskohzqijcmyhzmwnm.supabase.co';
const SUPABASE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5nbnNrb2h6cWlqY215aHptd25tIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NDk3Mjk3MiwiZXhwIjoyMDgwNTQ4OTcyfQ.CP66293EB_UY_8eykav0AEE-tziT6WpgfpyjA6cv2tw';
const IS_DRY_RUN    = process.argv.includes('--dry-run');
const DELAY_MS      = 300; // be polite to oEmbed endpoints

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function isGenericTitle(title) {
  const raw = (title || '').trim().toLowerCase();
  if (!raw) return true;
  return /^(training( resource| video| pdf| sop)?|video|untitled)(\s*\(\d+ videos?\))?$/.test(raw);
}

function extractYouTubeId(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (host.includes('youtu.be')) return u.pathname.replace(/^\//, '').trim();
    if (host.includes('youtube.com')) {
      const v = u.searchParams.get('v');
      if (v) return v;
      const parts = u.pathname.split('/').filter(Boolean);
      const embedIdx = parts.indexOf('embed');
      if (embedIdx >= 0) return parts[embedIdx + 1] || '';
      const shortsIdx = parts.indexOf('shorts');
      if (shortsIdx >= 0) return parts[shortsIdx + 1] || '';
    }
    return '';
  } catch { return ''; }
}

function extractLoomId(url) {
  try {
    const u = new URL(url);
    if (!u.hostname.toLowerCase().includes('loom.com')) return '';
    const parts = u.pathname.split('/').filter(Boolean);
    const shareIdx = parts.indexOf('share');
    if (shareIdx >= 0) return parts[shareIdx + 1] || '';
    const embedIdx = parts.indexOf('embed');
    if (embedIdx >= 0) return parts[embedIdx + 1] || '';
    return '';
  } catch { return ''; }
}

async function fetchOEmbed(url) {
  const ytId = extractYouTubeId(url);
  if (ytId) {
    try {
      const canonical = `https://www.youtube.com/watch?v=${ytId}`;
      const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(canonical)}`);
      if (r.ok) {
        const d = await r.json();
        const title = (d.title || '').trim();
        if (title) return { title, provider: 'YouTube', thumbnailUrl: d.thumbnail_url || '' };
      }
    } catch { /* skip */ }
  }
  const loomId = extractLoomId(url);
  if (loomId) {
    try {
      const canonical = `https://www.loom.com/share/${loomId}`;
      const r = await fetch(`https://www.loom.com/v1/oembed?format=json&url=${encodeURIComponent(canonical)}`);
      if (r.ok) {
        const d = await r.json();
        const title = (d.title || '').trim();
        if (title) return { title, provider: 'Loom', thumbnailUrl: d.thumbnail_url || '' };
      }
    } catch { /* skip */ }
  }
  return null;
}

async function main() {
  console.log(`\n=== sweep-training-titles === ${IS_DRY_RUN ? '[DRY RUN]' : '[LIVE]'}\n`);

  // Fetch all VIDEO resources (include Assets_Meta so we can use cached titles)
  const resp = await fetch(
    `${SUPABASE_URL}/rest/v1/Training_Resources?Type=eq.VIDEO&select=Resource_ID,Title,URL,Assets,Assets_Meta`,
    {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Accept': 'application/json'
      }
    }
  );
  if (!resp.ok) {
    console.error('Failed to fetch resources:', resp.status, await resp.text());
    process.exit(1);
  }

  const all = await resp.json();
  console.log(`Total VIDEO resources: ${all.length}`);

  const candidates = all.filter(r => isGenericTitle(r.Title));
  console.log(`Generic-titled (will attempt to fix): ${candidates.length}\n`);

  let updated = 0, skipped = 0, errors = 0;

  for (const resource of candidates) {
    // Build URL list: assets array first, then primary URL
    const urlList = [];
    try {
      const assets = Array.isArray(resource.Assets) ? resource.Assets : [];
      urlList.push(...assets.filter(u => typeof u === 'string' && /^https?:\/\//i.test(u)));
    } catch { /* ignore */ }
    if (resource.URL && !urlList.includes(resource.URL)) urlList.unshift(resource.URL);

    if (!urlList.length) {
      console.log(`  [skip]   ${resource.Resource_ID} "${resource.Title}" — no URL`);
      skipped++;
      continue;
    }

    // --- 1. Check Assets_Meta for an already-fetched title (fastest) ---
    let bestTitle = null;
    const assetsMeta = resource.Assets_Meta && typeof resource.Assets_Meta === 'object' ? resource.Assets_Meta : {};
    for (const url of urlList) {
      const m = assetsMeta[url];
      if (m && m.title && !isGenericTitle(m.title)) {
        bestTitle = m.title.trim();
        break;
      }
    }

    // --- 2. Fall back to live oEmbed fetch if no cached title ---
    if (!bestTitle) {
      for (const url of urlList) {
        await sleep(DELAY_MS);
        const meta = await fetchOEmbed(url);
        if (meta && meta.title && !isGenericTitle(meta.title)) {
          bestTitle = meta.title;
          break;
        }
      }
    }

    if (!bestTitle) {
      console.log(`  [skip]   ${resource.Resource_ID} "${resource.Title}" — no title from oEmbed`);
      skipped++;
      continue;
    }

    console.log(`  [update] ${resource.Resource_ID}: "${resource.Title}" → "${bestTitle}"`);

    if (!IS_DRY_RUN) {
      const patchResp = await fetch(
        `${SUPABASE_URL}/rest/v1/Training_Resources?Resource_ID=eq.${encodeURIComponent(resource.Resource_ID)}`,
        {
          method: 'PATCH',
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify({ Title: bestTitle })
        }
      );
      if (!patchResp.ok) {
        console.error(`    ERROR ${patchResp.status}: ${await patchResp.text()}`);
        errors++;
      } else {
        updated++;
      }
    } else {
      updated++;
    }
  }

  console.log(`\nResult: ${updated} ${IS_DRY_RUN ? 'would be updated' : 'updated'}, ${skipped} skipped, ${errors} errors\n`);
}

main().catch(e => { console.error(e); process.exit(1); });

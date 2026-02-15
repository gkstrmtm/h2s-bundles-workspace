require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local') });
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function pickArg(name, fallback = null) {
  const idx = process.argv.indexOf(name);
  if (idx >= 0 && process.argv[idx + 1] && !process.argv[idx + 1].startsWith('--')) return process.argv[idx + 1];
  return fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function uuidFromString(input) {
  const hash = crypto.createHash('sha1').update(String(input)).digest('hex');
  // 16 bytes = 32 hex chars
  const b = hash.slice(0, 32).split('');
  // Set version to 5 (0101)
  b[12] = '5';
  // Set variant to 10xx
  const variant = parseInt(b[16], 16);
  b[16] = ((variant & 0x3) | 0x8).toString(16);
  const h = b.join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function guessMime(ext) {
  const e = String(ext || '').toLowerCase().replace(/^\./, '');
  if (e === 'md') return 'text/markdown';
  if (e === 'sql') return 'text/plain';
  if (e === 'txt') return 'text/plain';
  if (e === 'json') return 'application/json';
  if (e === 'html') return 'text/html';
  return 'application/octet-stream';
}

async function main() {
  const mgmtUrl = process.env.NEXT_PUBLIC_SUPABASE_URL_MGMT || process.env.SUPABASE_URL_MGMT;
  const mgmtKey = process.env.SUPABASE_SERVICE_ROLE_KEY_MGMT || process.env.SUPABASE_SERVICE_KEY_MGMT;
  if (!mgmtUrl || !mgmtKey) {
    console.error('Missing MGMT Supabase creds. Expected SUPABASE_URL_MGMT + SUPABASE_SERVICE_KEY_MGMT in backend/.env.local');
    process.exit(1);
  }

  const yes = hasFlag('--yes');
  const dryRun = hasFlag('--dry-run') || !yes;
  const max = Number(pickArg('--max', '500'));

  const defaultManifest = path.resolve(__dirname, '..', '..', 'frontend', 'library', 'manifest.json');
  const manifestPath = path.resolve(pickArg('--manifest', defaultManifest));

  if (!fs.existsSync(manifestPath)) {
    console.error(`[import] Missing manifest at: ${manifestPath}`);
    console.error('[import] Generate it with:');
    console.error('  cd frontend; node ./scripts/generate-library-manifest.mjs');
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const items = Array.isArray(raw?.items) ? raw.items : [];
  if (!items.length) {
    console.error('[import] Manifest has no items.');
    process.exit(2);
  }

  const supabaseMgmt = createClient(mgmtUrl, mgmtKey);

  const rows = items.slice(0, max).map((it) => {
    const stableId = uuidFromString(`manifest:${it.id || it.path || it.title}`);
    const relPath = String(it.path || '');
    const name = path.basename(relPath);
    const ext = String(it.ext || path.extname(name).replace('.', ''));

    const fileLink = JSON.stringify([
      {
        name,
        type: guessMime(ext),
        url: `/${relPath.replace(/^\/+/, '')}`,
      },
    ]);

    const descLines = [
      'Imported file deliverable (docs/sql archive).',
      '',
      it.category ? `Category: ${it.category}` : null,
      it.date ? `Date: ${it.date}` : null,
      it.original_path ? `Original: ${it.original_path}` : null,
      it.source_group ? `Source group: ${it.source_group}` : null,
    ].filter(Boolean);

    return {
      Deliverable_ID: stableId,
      Title: it.title || name || 'Imported Deliverable',
      Description: descLines.join('\n'),
      File_Link: fileLink,
      Submitted_By: 'SYSTEM_IMPORT',
      Status: 'PUBLISHED',
    };
  });

  console.log(`[import] manifest=${manifestPath}`);
  console.log(`[import] items=${items.length} inserting=${rows.length} mode=${dryRun ? 'DRY_RUN' : 'APPLY'}`);

  if (dryRun) {
    console.log('[import] Dry run only. Re-run with --yes to upsert into MGMT Deliverables.');
    return;
  }

  const { error } = await supabaseMgmt
    .from('Deliverables')
    .upsert(rows, { onConflict: 'Deliverable_ID', ignoreDuplicates: true });

  if (error) {
    console.error('[import] Upsert failed:', error);
    process.exit(1);
  }

  console.log('[import] Done.');
}

main().catch((e) => {
  console.error('[import] Fatal:', e?.stack || e?.message || String(e));
  process.exit(1);
});

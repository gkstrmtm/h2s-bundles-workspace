import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: new URL('../.env.local', import.meta.url) });

defaultMain().catch((err) => {
  console.error('[audit-proof-asset-formats] Fatal:', err);
  process.exitCode = 1;
});

function parseArgs(argv) {
  const args = new Map();
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      args.set(key, next);
      i++;
    } else {
      args.set(key, 'true');
    }
  }
  return args;
}

function buildSupabasePublicObjectUrl(base, bucket, path) {
  const b = String(bucket || '').replace(/^\/+|\/+$/g, '');
  const p = String(path || '').replace(/^\/+/, '');
  const u = String(base || '').replace(/\/+$/, '');
  if (!u || !b || !p) return '';
  const encodedPath = p
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
  return `${u}/storage/v1/object/public/${encodeURIComponent(b)}/${encodedPath}`;
}

function detectFormat(buf) {
  if (!buf || buf.length < 12) return { format: 'unknown', detail: '' };

  // JPEG
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { format: 'jpeg', detail: 'magic' };
  // PNG
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  )
    return { format: 'png', detail: 'magic' };
  // GIF
  const gif = buf.subarray(0, 6).toString('ascii');
  if (gif === 'GIF87a' || gif === 'GIF89a') return { format: 'gif', detail: 'magic' };
  // WebP: RIFF....WEBP
  if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') {
    return { format: 'webp', detail: 'magic' };
  }

  // ISO BMFF (AVIF/HEIC/etc): ....ftypxxxx
  const ascii = buf.toString('ascii');
  const ftypIdx = ascii.indexOf('ftyp');
  if (ftypIdx !== -1 && ascii.length >= ftypIdx + 8) {
    const brand = ascii.slice(ftypIdx + 4, ftypIdx + 8);
    if (brand === 'avif' || brand === 'avis') return { format: 'avif', detail: `ftyp:${brand}` };
    if (brand.startsWith('hei')) return { format: 'heic', detail: `ftyp:${brand}` };
    if (brand === 'mif1') return { format: 'heif', detail: `ftyp:${brand}` };
    if (brand === 'mp42' || brand === 'isom') return { format: 'mp4', detail: `ftyp:${brand}` };
    return { format: 'iso-bmff', detail: `ftyp:${brand}` };
  }

  return { format: 'unknown', detail: '' };
}

function extFromPath(path) {
  const p = String(path || '').toLowerCase();
  const m = p.match(/\.([a-z0-9]+)$/);
  return m ? m[1] : '';
}

async function fetchMagicBytes(url) {
  const res = await fetch(url, { headers: { Range: 'bytes=0-63' } });
  const contentType = res.headers.get('content-type') || '';
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return { ok: false, status: res.status, contentType, buf: null, error: text.slice(0, 200) };
  }
  const ab = await res.arrayBuffer();
  const buf = Buffer.from(ab);
  return { ok: true, status: res.status, contentType, buf, error: '' };
}

async function defaultMain() {
  const args = parseArgs(process.argv);
  const max = Number(args.get('max') || 2000);
  const batch = Number(args.get('batch') || 500);
  const all = String(args.get('all') || 'false') === 'true';

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY/SUPABASE_SERVICE_ROLE_KEY in backend/.env.local');
  }

  const sb = createClient(supabaseUrl, supabaseKey, { auth: { autoRefreshToken: false, persistSession: false } });

  console.log('[audit] Querying proof_assets...');
  const items = [];
  for (let offset = 0; ; offset += batch) {
    const to = offset + batch - 1;
    const { data, error } = await sb
      .from('proof_assets')
      .select('asset_id,storage_bucket,storage_path,media_kind,updated_at,created_at')
      .order('updated_at', { ascending: false })
      .range(offset, to);

    if (error) throw error;
    if (!data || data.length === 0) break;

    for (const row of data) {
      const mk = String(row.media_kind || '').toLowerCase();
      const isVideo = mk === 'video';
      if (isVideo) continue;
      if (!row.storage_path) continue;
      items.push(row);
      if (!all && items.length >= max) break;
    }

    if (!all && items.length >= max) break;
    if (data.length < batch) break;
  }

  console.log(`[audit] Scanning ${items.length} image assets for actual bytes + content-type...`);

  const counts = new Map();
  const bad = [];
  const errors = [];

  const concurrency = Number(args.get('concurrency') || 8);
  let idx = 0;

  async function worker() {
    for (;;) {
      const i = idx++;
      if (i >= items.length) return;
      const a = items[i];
      const bucket = a.storage_bucket || 'proof';
      const path = a.storage_path;
      const publicUrl = buildSupabasePublicObjectUrl(supabaseUrl, bucket, path);

      const ext = extFromPath(path);

      try {
        const r = await fetchMagicBytes(publicUrl);
        if (!r.ok) {
          errors.push({ asset_id: a.asset_id, status: r.status, url: publicUrl, err: r.error });
          continue;
        }

        const det = detectFormat(r.buf);
        const key = `${det.format} | ${String(r.contentType || '').split(';')[0] || 'no-ct'} | .${ext || '?'}`;
        counts.set(key, (counts.get(key) || 0) + 1);

        const isOptimized = det.format === 'webp' || det.format === 'avif';
        if (!isOptimized) {
          bad.push({
            asset_id: a.asset_id,
            format: det.format,
            ct: r.contentType,
            ext,
            storage_path: path,
            updated_at: a.updated_at,
          });
        }
      } catch (e) {
        errors.push({ asset_id: a.asset_id, status: 0, url: publicUrl, err: String(e?.message || e) });
      }

      if ((i + 1) % 200 === 0) {
        console.log(`[audit] ${i + 1}/${items.length}...`);
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  const sortedCounts = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  console.log('\n=== FORMAT COUNTS (actual bytes) ===');
  for (const [k, v] of sortedCounts) {
    console.log(String(v).padStart(6, ' '), k);
  }

  const badSorted = bad.sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
  console.log(`\n=== NOT WEBP/AVIF (${badSorted.length}) ===`);
  for (const row of badSorted.slice(0, 30)) {
    console.log(`- ${row.format.padEnd(8)} asset_id=${row.asset_id} ext=.${row.ext || '?'} ct=${(row.ct || '').split(';')[0]} path=${row.storage_path}`);
  }
  if (badSorted.length > 30) console.log(`... and ${badSorted.length - 30} more`);

  if (errors.length) {
    console.log(`\n=== FETCH ERRORS (${errors.length}) ===`);
    for (const e of errors.slice(0, 20)) {
      console.log(`- asset_id=${e.asset_id} status=${e.status} err=${String(e.err || '').slice(0, 120)}`);
    }
    if (errors.length > 20) console.log(`... and ${errors.length - 20} more`);
  }

  console.log('\nDone.');
  console.log('Tip: run `node scripts/audit-proof-asset-formats.mjs --all true --concurrency 12` for full scan (may take a while).');
}

import { createClient } from '@supabase/supabase-js';

const input = await new Promise((resolve, reject) => {
  let raw = '';
  if (process.stdin.isTTY && process.stdin.setRawMode) process.stdin.setRawMode(true);
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    raw += chunk;
    if (!/[\r\n]/.test(raw)) return;
    process.stdin.pause();
    try { resolve(JSON.parse(raw.trim())); } catch (error) { reject(new Error(`Invalid migration input: ${error.message}`)); }
  });
  process.stdin.on('end', () => {
    if (!raw.trim()) return reject(new Error('Migration input is required.'));
    try { resolve(JSON.parse(raw)); } catch (error) { reject(new Error(`Invalid migration input: ${error.message}`)); }
  });
});

const clean = (value) => String(value || '').trim().replaceAll('\\', '');
const sourceUrl = clean(input.source_url).replace(/\/+$/, '');
const destinationUrl = clean(input.destination_url).replace(/\/+$/, '');
const sourceKey = clean(input.source_service_role_key);
const destinationKey = clean(input.destination_service_role_key);
const mode = input.mode === 'apply' ? 'apply' : 'dry-run';
const bucket = 'proof';
const tables = ['proof_packs', 'proof_assets', 'proof_slots'];

if (!sourceUrl || !destinationUrl || !sourceKey || !destinationKey) throw new Error('Both migration-only URLs and service-role keys are required.');
if (sourceUrl === destinationUrl) throw new Error('Source and destination must be different Supabase projects.');

const requestTimeoutMs = 15000;
const timedFetch = (url, init = {}) => {
  const timeoutSignal = AbortSignal.timeout(requestTimeoutMs);
  const signal = init.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal;
  return fetch(url, { ...init, signal });
};
const options = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: timedFetch }
};
const source = createClient(sourceUrl, sourceKey, options);
const destination = createClient(destinationUrl, destinationKey, options);

async function readTable(client, table) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client.from(table).select('*').range(from, from + 999);
    if (error) return { ok: false, error: error.message, rows: [] };
    rows.push(...(data || []));
    if (!data || data.length < 1000) return { ok: true, rows };
  }
}

async function listObjects(client, prefix = '') {
  const found = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await client.storage.from(bucket).list(prefix, { limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } });
    if (error) throw new Error(`Unable to list ${bucket}/${prefix}: ${error.message}`);
    for (const entry of data || []) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id) found.push({ path, size: Number(entry.metadata?.size || 0), contentType: entry.metadata?.mimetype || entry.metadata?.contentType || 'application/octet-stream' });
      else found.push(...await listObjects(client, path));
    }
    if (!data || data.length < 1000) break;
  }
  return found;
}

async function bucketInfo(client) {
  const { data, error } = await client.storage.getBucket(bucket);
  return error ? { ok: false, error: error.message } : { ok: true, public: data.public, fileSizeLimit: data.file_size_limit };
}

const report = {
  mode,
  source: { project: new URL(sourceUrl).hostname.split('.')[0], bucket: await bucketInfo(source), tables: {} },
  destination: { project: new URL(destinationUrl).hostname.split('.')[0], bucket: await bucketInfo(destination), tables: {} },
  storage: { source_objects: 0, source_bytes: 0, copied: 0, verified: 0, failed: [] },
  database: { upserted: {}, failed: [] }
};

const sourceRows = {};
for (const table of tables) {
  const [src, dst] = await Promise.all([readTable(source, table), readTable(destination, table)]);
  sourceRows[table] = src.rows;
  report.source.tables[table] = src.ok ? { ok: true, rows: src.rows.length } : { ok: false, error: src.error };
  report.destination.tables[table] = dst.ok ? { ok: true, rows: dst.rows.length } : { ok: false, error: dst.error };
}

let objects = [];
try {
  objects = await listObjects(source);
  report.storage.source_objects = objects.length;
  report.storage.source_bytes = objects.reduce((sum, object) => sum + object.size, 0);
} catch (error) {
  report.storage.failed.push({ stage: 'source_inventory', error: error.message });
}

if (mode === 'apply') {
  if (!report.source.bucket.ok) throw new Error(`Source proof bucket unavailable: ${report.source.bucket.error}`);
  if (!report.destination.bucket.ok) {
    const { error } = await destination.storage.createBucket(bucket, { public: true });
    if (error) throw new Error(`Unable to create destination proof bucket: ${error.message}`);
    report.destination.bucket = await bucketInfo(destination);
  }

  for (const object of objects) {
    try {
      const { data: blob, error: downloadError } = await source.storage.from(bucket).download(object.path);
      if (downloadError || !blob) throw new Error(downloadError?.message || 'download returned no data');
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const { error: uploadError } = await destination.storage.from(bucket).upload(object.path, bytes, { contentType: object.contentType, upsert: true });
      if (uploadError) throw new Error(uploadError.message);
      report.storage.copied += 1;
      const { data: verifyBlob, error: verifyError } = await destination.storage.from(bucket).download(object.path);
      if (verifyError || !verifyBlob) throw new Error(`verification download failed: ${verifyError?.message || 'no data'}`);
      if (verifyBlob.size !== bytes.byteLength) throw new Error(`size mismatch: source=${bytes.byteLength}, destination=${verifyBlob.size}`);
      report.storage.verified += 1;
    } catch (error) {
      report.storage.failed.push({ path: object.path, error: error.message });
    }
  }

  for (const table of tables) {
    const rows = sourceRows[table] || [];
    if (!rows.length) { report.database.upserted[table] = 0; continue; }
    if (!report.destination.tables[table]?.ok) {
      report.database.failed.push({ table, error: 'destination table is unavailable; no rows written' });
      continue;
    }
    let count = 0;
    for (let index = 0; index < rows.length; index += 250) {
      const batch = rows.slice(index, index + 250);
      const { error } = await destination.from(table).upsert(batch);
      if (error) { report.database.failed.push({ table, batch: index / 250, error: error.message }); break; }
      count += batch.length;
    }
    report.database.upserted[table] = count;
  }
}

console.log(JSON.stringify(report, null, 2));
if (report.storage.failed.length || report.database.failed.length) process.exitCode = 2;

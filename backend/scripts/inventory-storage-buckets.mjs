import { createClient } from '@supabase/supabase-js';

const input = await new Promise((resolve, reject) => {
  let raw = '';
  if (process.stdin.isTTY && process.stdin.setRawMode) process.stdin.setRawMode(true);
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    raw += chunk;
    if (!/[\r\n]/.test(raw)) return;
    process.stdin.pause();
    try { resolve(JSON.parse(raw.trim())); } catch (error) { reject(error); }
  });
});

const url = String(input.url || '').trim().replace(/\/+$/, '');
const key = String(input.service_role_key || '').trim().replaceAll('\\', '');
const client = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: (target, init = {}) => fetch(target, { ...init, signal: AbortSignal.timeout(15000) }) }
});

async function listObjects(bucket, prefix = '') {
  const found = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await client.storage.from(bucket).list(prefix, {
      limit: 1000,
      offset,
      sortBy: { column: 'name', order: 'asc' }
    });
    if (error) throw new Error(`${bucket}/${prefix}: ${error.message}`);
    for (const entry of data || []) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id) found.push({ path, size: Number(entry.metadata?.size || 0) });
      else found.push(...await listObjects(bucket, path));
    }
    if (!data || data.length < 1000) break;
  }
  return found;
}

const { data: buckets, error } = await client.storage.listBuckets();
if (error) throw error;
const report = [];
for (const bucket of buckets || []) {
  const objects = await listObjects(bucket.id);
  report.push({
    bucket: bucket.id,
    public: bucket.public,
    file_size_limit: bucket.file_size_limit,
    objects: objects.length,
    bytes: objects.reduce((total, object) => total + object.size, 0)
  });
}
console.log(JSON.stringify(report, null, 2));

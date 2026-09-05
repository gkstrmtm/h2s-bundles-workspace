import { readFileSync, statSync } from 'node:fs';
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

const url = String(input.destination_url || '').trim().replace(/\/+$/, '');
const key = String(input.destination_service_role_key || '').trim().replaceAll('\\', '');
const filePath = String(input.file_path || '').trim();
const objectPath = String(input.object_path || '').trim();
const expectedSha256 = String(input.sha256 || '').trim().toUpperCase();
const bucket = 'legacy-backups';
if (!url || !key || !filePath || !objectPath || !expectedSha256) throw new Error('Missing backup upload input.');

const client = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: (target, init = {}) => fetch(target, { ...init, signal: AbortSignal.timeout(60000) }) }
});

const { data: existing } = await client.storage.getBucket(bucket);
if (!existing) {
  const { error } = await client.storage.createBucket(bucket, { public: false });
  if (error) throw new Error(`Unable to create private backup bucket: ${error.message}`);
} else if (existing.public) {
  throw new Error('Refusing upload because legacy-backups is public.');
}

const bytes = statSync(filePath).size;
const { error: uploadError } = await client.storage.from(bucket).upload(objectPath, readFileSync(filePath), {
  contentType: 'application/octet-stream',
  upsert: true
});
if (uploadError) throw new Error(`Backup upload failed: ${uploadError.message}`);

const manifest = JSON.stringify({ source_project: 'ulbzmgmxrqyipclrbohi', bytes, sha256: expectedSha256, created_at: new Date().toISOString() }, null, 2);
const { error: manifestError } = await client.storage.from(bucket).upload(`${objectPath}.json`, manifest, {
  contentType: 'application/json',
  upsert: true
});
if (manifestError) throw new Error(`Manifest upload failed: ${manifestError.message}`);

const { data: downloaded, error: downloadError } = await client.storage.from(bucket).download(objectPath);
if (downloadError || !downloaded) throw new Error(`Backup verification download failed: ${downloadError?.message || 'no data'}`);
if (downloaded.size !== bytes) throw new Error(`Backup size mismatch: local=${bytes}, destination=${downloaded.size}`);

console.log(JSON.stringify({ bucket, objectPath, private: true, bytes, verified: true, sha256: expectedSha256 }, null, 2));

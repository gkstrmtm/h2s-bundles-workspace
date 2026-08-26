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

const clean = (value) => String(value || '').trim().replaceAll('\\', '');
const options = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: (target, init = {}) => fetch(target, { ...init, signal: AbortSignal.timeout(30000) }) }
};
const source = createClient(clean(input.source_url), clean(input.source_service_role_key), options);
const destination = createClient(clean(input.destination_url), clean(input.destination_service_role_key), options);

async function listObjects(client, bucket, prefix = '') {
  const found = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await client.storage.from(bucket).list(prefix, { limit: 1000, offset });
    if (error) throw new Error(`${bucket}/${prefix}: ${error.message}`);
    for (const entry of data || []) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id) found.push({ path, contentType: entry.metadata?.mimetype || 'application/octet-stream' });
      else found.push(...await listObjects(client, bucket, path));
    }
    if (!data || data.length < 1000) break;
  }
  return found;
}

const { data: sourceBuckets, error: bucketError } = await source.storage.listBuckets();
if (bucketError) throw bucketError;
const wanted = (sourceBuckets || []).filter((bucket) => bucket.id !== 'proof');
const report = [];

for (const bucket of wanted) {
  const { data: existing } = await destination.storage.getBucket(bucket.id);
  if (!existing) {
    const { error } = await destination.storage.createBucket(bucket.id, {
      public: bucket.public,
      fileSizeLimit: bucket.file_size_limit || undefined,
      allowedMimeTypes: bucket.allowed_mime_types || undefined
    });
    if (error) throw new Error(`create ${bucket.id}: ${error.message}`);
  } else if (existing.public !== bucket.public) {
    throw new Error(`${bucket.id}: destination privacy differs from source`);
  }

  const objects = await listObjects(source, bucket.id);
  let copied = 0;
  let verified = 0;
  const failed = [];
  for (const object of objects) {
    try {
      const { data: blob, error: downloadError } = await source.storage.from(bucket.id).download(object.path);
      if (downloadError || !blob) throw new Error(downloadError?.message || 'source download returned no data');
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const { error: uploadError } = await destination.storage.from(bucket.id).upload(object.path, bytes, {
        contentType: object.contentType,
        upsert: true
      });
      if (uploadError) throw new Error(uploadError.message);
      copied += 1;
      const { data: verifyBlob, error: verifyError } = await destination.storage.from(bucket.id).download(object.path);
      if (verifyError || !verifyBlob) throw new Error(verifyError?.message || 'verification returned no data');
      if (verifyBlob.size !== bytes.byteLength) throw new Error(`size mismatch ${bytes.byteLength}/${verifyBlob.size}`);
      verified += 1;
    } catch (error) {
      failed.push({ path: object.path, error: error.message });
    }
  }
  report.push({ bucket: bucket.id, public: bucket.public, objects: objects.length, copied, verified, failed });
}

console.log(JSON.stringify(report, null, 2));
if (report.some((bucket) => bucket.failed.length)) process.exitCode = 2;

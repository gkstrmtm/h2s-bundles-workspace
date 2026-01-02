import { resolveDispatchSchema } from '@/lib/dispatchSchema';

function safeParseJson(value: any): any {
  if (!value) return null;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function looksLikeBase64(s: string): boolean {
  const v = String(s || '').trim();
  if (!v) return false;
  // Very loose check: base64 is usually long and only base64 chars.
  if (v.length < 16) return false;
  return /^[A-Za-z0-9+/=\r\n]+$/.test(v);
}

function asBool(v: any): boolean {
  return v === true || v === 'true' || v === 1 || v === '1';
}

function asNum(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export type ArtifactType = 'photo' | 'signature' | 'w9' | 'other';

export type PortalArtifact = {
  artifact_id: string;
  job_id: string;
  type: ArtifactType;
  storage_url?: string | null;
  url?: string | null;
  file_url?: string | null;
  photo_url?: string | null;
  filename?: string | null;
  mimetype?: string | null;
  uploaded_at: string;
  uploaded_by?: string | null;
};

function isLikelyWebUrl(u: string): boolean {
  const v = String(u || '').trim().toLowerCase();
  return v.startsWith('http://') || v.startsWith('https://') || v.startsWith('data:');
}

async function resolveArtifactUrl(sb: any, rawUrl: any): Promise<string | null> {
  const u = String(rawUrl ?? '').trim();
  if (!u) return null;
  if (isLikelyWebUrl(u)) return u;

  const normalized = u.replace(/^\/+/, '');

  const bucketCandidates = ['h2s-job-artifacts', 'job-artifacts', 'artifacts', 'dispatch-artifacts', 'uploads'];

  async function tryBucket(bucket: string, objectPath: string): Promise<string | null> {
    try {
      const signed = await sb.storage.from(bucket).createSignedUrl(objectPath, 60 * 60 * 24 * 7);
      if (!signed?.error && signed?.data?.signedUrl) return signed.data.signedUrl;
    } catch {
      // ignore
    }

    try {
      const pub = sb.storage.from(bucket).getPublicUrl(objectPath);
      const publicUrl = pub?.data?.publicUrl;
      if (publicUrl) return publicUrl;
    } catch {
      // ignore
    }

    return null;
  }

  // If the URL looks like "bucket/path/to/object", use that bucket first.
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length >= 2 && bucketCandidates.includes(parts[0])) {
    const direct = await tryBucket(parts[0], parts.slice(1).join('/'));
    if (direct) return direct;
  }

  // Otherwise treat it as an object path and try common buckets.
  for (const bucket of bucketCandidates) {
    const signed = await tryBucket(bucket, normalized);
    if (signed) return signed;
  }

  // Last resort: return the raw value.
  return u;
}

export async function verifyJobAccess(
  sb: any,
  payload: { role: string; sub: string; email?: string },
  jobId: string
): Promise<{ ok: true; schema: any; jobRow?: any } | { ok: false; error: string; error_code: string }> {
  if (!sb) return { ok: false, error: 'Dispatch DB not configured', error_code: 'dispatch_db_not_configured' };
  if (!jobId) return { ok: false, error: 'Missing job_id', error_code: 'bad_request' };

  const schema = await resolveDispatchSchema(sb, { preferProValue: payload.sub, preferEmailValue: payload.email });

  if (payload.role === 'admin') {
    // Admin can operate on any job.
    try {
      if (schema) {
        const { data } = await sb.from(schema.jobsTable).select('*').eq(schema.jobsIdCol as any, jobId).maybeSingle();
        return { ok: true, schema, jobRow: data || undefined };
      }
    } catch {
      // ignore
    }
    return { ok: true, schema };
  }

  if (payload.role !== 'pro') {
    return { ok: false, error: 'Not a pro session', error_code: 'bad_session' };
  }

  const proValues = Array.from(new Set([payload.sub, payload.email].filter(Boolean).map((v) => String(v))));

  // Check assignment table first (preferred)
  if (schema) {
    const assignTable = schema.assignmentsTable;
    const jobCol = schema.assignmentsJobCol || 'job_id';
    const proCol = schema.assignmentsProCol;

    for (const v of proValues) {
      try {
        const { data, error } = await sb.from(assignTable).select('*').eq(jobCol as any, jobId).eq(proCol as any, v).limit(1);
        if (!error && Array.isArray(data) && data.length) {
          return { ok: true, schema };
        }
      } catch {
        // ignore
      }
    }
  }

  // Fallback: check jobs table pro-id columns
  try {
    const jobTable = schema?.jobsTable || 'h2s_dispatch_jobs';
    const jobIdCol = schema?.jobsIdCol || 'job_id';
    const { data: jobRow, error } = await sb.from(jobTable).select('*').eq(jobIdCol as any, jobId).maybeSingle();
    if (error || !jobRow) return { ok: false, error: 'Job not found', error_code: 'not_found' };

    const candidates = [
      jobRow.assigned_pro_id,
      jobRow.pro_id,
      jobRow.tech_id,
      jobRow.technician_id,
      jobRow.pro_email,
      jobRow.tech_email,
      jobRow.email,
    ].map((x: any) => String(x ?? '').trim());

    for (const v of proValues) {
      if (candidates.includes(String(v).trim())) {
        return { ok: true, schema, jobRow };
      }
    }

    return { ok: false, error: 'Forbidden for this job', error_code: 'forbidden' };
  } catch {
    return { ok: false, error: 'Forbidden for this job', error_code: 'forbidden' };
  }
}

async function artifactsTableExists(sb: any): Promise<boolean> {
  try {
    const { error } = await sb.from('h2s_dispatch_job_artifacts').select('*').limit(1);
    return !error;
  } catch {
    return false;
  }
}

async function tryInsertArtifactRow(sb: any, row: any): Promise<{ ok: true; row: any } | { ok: false; error: string }> {
  try {
    const { data, error } = await sb.from('h2s_dispatch_job_artifacts').insert(row).select('*').maybeSingle();
    if (error) return { ok: false, error: error.message };
    return { ok: true, row: data || row };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'insert_failed' };
  }
}

export async function addArtifact(
  sb: any,
  payload: { role: string; sub: string; email?: string },
  input: {
    job_id: string;
    type: ArtifactType;
    data: string;
    filename?: string;
    mimetype?: string;
  }
): Promise<{ ok: true; artifact: PortalArtifact } | { ok: false; error: string; error_code: string }> {
  const jobId = String(input.job_id || '').trim();
  const type = (String(input.type || 'other').trim().toLowerCase() as ArtifactType) || 'other';
  const data = String(input.data || '').trim();
  const filename = input.filename ? String(input.filename) : null;
  const mimetype = input.mimetype ? String(input.mimetype) : (type === 'signature' ? 'image/png' : 'image/jpeg');

  if (!jobId) return { ok: false, error: 'Missing job_id', error_code: 'bad_request' };
  if (!data) return { ok: false, error: 'Missing data', error_code: 'bad_request' };
  if (!looksLikeBase64(data)) return { ok: false, error: 'Invalid base64 payload', error_code: 'bad_request' };

  const access = await verifyJobAccess(sb, payload, jobId);
  if (!access.ok) return access;

  const artifactId = (globalThis.crypto as any)?.randomUUID ? (globalThis.crypto as any).randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const uploadedAt = new Date().toISOString();

  // Prefer storage URL, but always have a fallback that works.
  let storageUrl: string | null = null;
  try {
    // Best-effort storage upload. Works only if a bucket exists and is configured for reads.
    const bucketCandidates = ['h2s-job-artifacts', 'job-artifacts', 'artifacts', 'dispatch-artifacts', 'uploads'];
    const bytes = Buffer.from(data, 'base64');

    for (const bucket of bucketCandidates) {
      try {
        const objectPath = `${jobId}/${artifactId}_${(filename || `${type}.bin`).replace(/[^a-zA-Z0-9_.-]+/g, '_')}`;
        const up = await sb.storage.from(bucket).upload(objectPath, bytes, { contentType: mimetype, upsert: false });
        if (up?.error) continue;

        const pub = sb.storage.from(bucket).getPublicUrl(objectPath);
        const publicUrl = pub?.data?.publicUrl;
        if (publicUrl) {
          storageUrl = publicUrl;
          break;
        }

        const signed = await sb.storage.from(bucket).createSignedUrl(objectPath, 60 * 60 * 24 * 7);
        if (!signed?.error && signed?.data?.signedUrl) {
          storageUrl = signed.data.signedUrl;
          break;
        }
      } catch {
        // try next bucket
      }
    }
  } catch {
    // ignore
  }

  if (!storageUrl) {
    storageUrl = `data:${mimetype};base64,${data}`;
  }

  const artifact: PortalArtifact = {
    artifact_id: artifactId,
    job_id: jobId,
    type,
    storage_url: storageUrl,
    filename,
    mimetype,
    uploaded_at: uploadedAt,
    uploaded_by: payload.sub || payload.email || null,
  };

  // Try real artifacts table first.
  const hasTable = await artifactsTableExists(sb);
  if (hasTable) {
    // NOTE: Real schema (as observed) includes: artifact_id, job_id, pro_id, type, url, created_at, updated_at
    // and NOT: storage_url, uploaded_at, artifact_type.
    const attempts: any[] = [
      {
        artifact_id: artifact.artifact_id,
        job_id: artifact.job_id,
        pro_id: payload.role === 'pro' ? payload.sub : null,
        type: artifact.type,
        url: artifact.storage_url,
        created_at: artifact.uploaded_at,
        updated_at: artifact.uploaded_at,
        caption: artifact.filename,
      },
      // Older/alternate shapes (kept for compatibility)
      {
        job_id: artifact.job_id,
        type: artifact.type,
        url: artifact.storage_url,
        created_at: artifact.uploaded_at,
      },
      {
        job_id: artifact.job_id,
        type: artifact.type,
        photo_url: artifact.storage_url,
        created_at: artifact.uploaded_at,
      },
      {
        job_id: artifact.job_id,
        type: artifact.type,
        file_url: artifact.storage_url,
        created_at: artifact.uploaded_at,
      },
    ];

    for (const row of attempts) {
      const ins = await tryInsertArtifactRow(sb, row);
      if (ins.ok) break;
    }
  } else {
    // Fallback: embed in job.metadata
    try {
      const jobTable = access.schema?.jobsTable || 'h2s_dispatch_jobs';
      const jobIdCol = access.schema?.jobsIdCol || 'job_id';
      const { data: jobRow } = await sb.from(jobTable).select('*').eq(jobIdCol as any, jobId).maybeSingle();
      const meta = safeParseJson(jobRow?.metadata) || {};
      const arr = Array.isArray(meta.artifacts) ? meta.artifacts : [];
      meta.artifacts = [...arr, artifact];
      meta.artifacts_version = 1;
      await sb.from(jobTable).update({ metadata: meta, updated_at: new Date().toISOString() } as any).eq(jobIdCol as any, jobId);
    } catch {
      // ignore
    }
  }

  // Update job flags/counters (best-effort)
  try {
    const jobTable = access.schema?.jobsTable || 'h2s_dispatch_jobs';
    const jobIdCol = access.schema?.jobsIdCol || 'job_id';

    const { data: jobRow } = await sb.from(jobTable).select('*').eq(jobIdCol as any, jobId).maybeSingle();

    const patch: any = { updated_at: new Date().toISOString() };

    if (type === 'photo') {
      const cur = asNum(jobRow?.photo_count);
      patch.photo_count = cur + 1;
      patch.photo_on_file = true;
    }

    if (type === 'signature') {
      patch.signature_on_file = true;
    }

    await sb.from(jobTable).update(patch).eq(jobIdCol as any, jobId);
  } catch {
    // ignore
  }

  return { ok: true, artifact };
}

export async function getArtifacts(
  sb: any,
  payload: { role: string; sub: string; email?: string },
  input: { job_id: string; type?: ArtifactType }
): Promise<{ ok: true; artifacts: PortalArtifact[] } | { ok: false; error: string; error_code: string }> {
  const jobId = String(input.job_id || '').trim();
  const type = input.type ? (String(input.type).trim().toLowerCase() as ArtifactType) : null;

  const access = await verifyJobAccess(sb, payload, jobId);
  if (!access.ok) return access;

  const out: PortalArtifact[] = [];

  const hasTable = await artifactsTableExists(sb);
  if (hasTable) {
    try {
      // Try common timestamp columns for ordering.
      const orderCols = ['created_at', 'added_at', 'updated_at'];
      for (const orderCol of orderCols) {
        try {
          let q = sb.from('h2s_dispatch_job_artifacts').select('*').eq('job_id', jobId);
          if (type) q = q.eq('type', type);
          const { data, error } = await q.order(orderCol, { ascending: true }).limit(500);
          if (error) continue;
          if (Array.isArray(data)) {
            for (const r of data) {
              const resolvedUrl = await resolveArtifactUrl(sb, r.url || r.file_url || r.photo_url || r.storage_url);
              out.push({
                artifact_id: String(r.artifact_id || r.id || ''),
                job_id: String(r.job_id || jobId),
                type: (String(r.type || 'other') as ArtifactType) || 'other',
                storage_url: resolvedUrl,
                url: resolvedUrl,
                file_url: resolvedUrl,
                photo_url: resolvedUrl,
                filename: r.caption || r.filename || null,
                mimetype: r.mimetype || null,
                uploaded_at: String(r.created_at || r.added_at || r.updated_at || new Date().toISOString()),
                uploaded_by: r.pro_id || r.uploaded_by || null,
              });
            }
            return { ok: true, artifacts: out };
          }
        } catch {
          // try next order col
        }
      }

      // Last resort: no ordering
      let q = sb.from('h2s_dispatch_job_artifacts').select('*').eq('job_id', jobId);
      if (type) q = q.eq('type', type);
      const { data, error } = await q.limit(500);
      if (!error && Array.isArray(data)) {
        for (const r of data) {
          const resolvedUrl = await resolveArtifactUrl(sb, r.url || r.file_url || r.photo_url || r.storage_url);
          out.push({
            artifact_id: String(r.artifact_id || r.id || ''),
            job_id: String(r.job_id || jobId),
            type: (String(r.type || 'other') as ArtifactType) || 'other',
            storage_url: resolvedUrl,
            url: resolvedUrl,
            file_url: resolvedUrl,
            photo_url: resolvedUrl,
            filename: r.caption || r.filename || null,
            mimetype: r.mimetype || null,
            uploaded_at: String(r.created_at || r.added_at || r.updated_at || new Date().toISOString()),
            uploaded_by: r.pro_id || r.uploaded_by || null,
          });
        }
        return { ok: true, artifacts: out };
      }
    } catch {
      // fallback below
    }
  }

  // Fallback: read from job.metadata.artifacts
  try {
    const jobTable = access.schema?.jobsTable || 'h2s_dispatch_jobs';
    const jobIdCol = access.schema?.jobsIdCol || 'job_id';
    const { data: jobRow } = await sb.from(jobTable).select('*').eq(jobIdCol as any, jobId).maybeSingle();
    const meta = safeParseJson(jobRow?.metadata) || {};
    const arr = Array.isArray(meta.artifacts) ? meta.artifacts : [];

    const normalized = arr
      .map((a: any) => ({
        artifact_id: String(a?.artifact_id || a?.id || ''),
        job_id: String(a?.job_id || jobId),
        type: (String(a?.type || 'other') as ArtifactType) || 'other',
        storage_url: a?.storage_url || a?.file_url || a?.photo_url || a?.url || null,
        url: a?.storage_url || a?.file_url || a?.photo_url || a?.url || null,
        file_url: a?.storage_url || a?.file_url || a?.photo_url || a?.url || null,
        photo_url: a?.storage_url || a?.file_url || a?.photo_url || a?.url || null,
        filename: a?.filename || null,
        mimetype: a?.mimetype || null,
        uploaded_at: String(a?.uploaded_at || a?.created_at || new Date().toISOString()),
        uploaded_by: a?.uploaded_by || null,
      }))
      .filter((a: any) => a.artifact_id);

    const filtered = type ? normalized.filter((a: any) => a.type === type) : normalized;
    return { ok: true, artifacts: filtered };
  } catch {
    return { ok: true, artifacts: [] };
  }
}

export async function deleteArtifact(
  sb: any,
  payload: { role: string; sub: string; email?: string },
  input: { artifact_id: string }
): Promise<{ ok: true } | { ok: false; error: string; error_code: string }> {
  const artifactId = String(input.artifact_id || '').trim();
  if (!artifactId) return { ok: false, error: 'Missing artifact_id', error_code: 'bad_request' };

  // Try artifacts table delete first. We still enforce job access by fetching the artifact row.
  const hasTable = await artifactsTableExists(sb);
  if (hasTable) {
    try {
      // IMPORTANT: don't reference columns that might not exist (e.g. `id`).
      // Try `artifact_id` first; if that column doesn't exist, fall back to `id`.

      let row: any = null;
      let jobId: string | null = null;

      const byArtifactId = await sb.from('h2s_dispatch_job_artifacts').select('*').eq('artifact_id', artifactId).limit(1);
      if (!byArtifactId.error && Array.isArray(byArtifactId.data) && byArtifactId.data.length) {
        row = byArtifactId.data[0];
      } else if (String(byArtifactId.error?.message || '').toLowerCase().includes('column') && String(byArtifactId.error?.message || '').toLowerCase().includes('artifact_id')) {
        const byId = await sb.from('h2s_dispatch_job_artifacts').select('*').eq('id', artifactId).limit(1);
        if (!byId.error && Array.isArray(byId.data) && byId.data.length) row = byId.data[0];
      }

      if (row) {
        jobId = row.job_id ? String(row.job_id).trim() : null;
      }

      if (jobId) {
        const access = await verifyJobAccess(sb, payload, jobId);
        if (!access.ok) return access;
      } else if (payload.role !== 'admin') {
        // Portal only provides artifact_id; without job_id we can't authorize a pro.
        return { ok: false, error: 'Artifact not found', error_code: 'not_found' };
      }

      const delByArtifactId = await sb.from('h2s_dispatch_job_artifacts').delete().eq('artifact_id', artifactId);
      if (!delByArtifactId.error) return { ok: true };

      // If `artifact_id` column doesn't exist, try `id`.
      if (String(delByArtifactId.error?.message || '').toLowerCase().includes('column') && String(delByArtifactId.error?.message || '').toLowerCase().includes('artifact_id')) {
        const delById = await sb.from('h2s_dispatch_job_artifacts').delete().eq('id', artifactId);
        if (delById.error) return { ok: false, error: delById.error.message, error_code: 'query_error' };
        return { ok: true };
      }

      return { ok: false, error: delByArtifactId.error.message, error_code: 'query_error' };
    } catch (e: any) {
      return { ok: false, error: e?.message || 'delete_failed', error_code: 'query_error' };
    }
  }

  // Fallback: can't delete from metadata without job_id (portal doesn't send job_id)
  if (payload.role !== 'admin') {
    return { ok: false, error: 'Artifacts table not available for deletion', error_code: 'not_supported' };
  }

  return { ok: true };
}

export async function canCompleteJob(jobRow: any): Promise<boolean> {
  const hasPhotos = asNum(jobRow?.photo_count) > 0 || asBool(jobRow?.photo_on_file);
  const hasSignature = asBool(jobRow?.signature_on_file) || asBool(jobRow?.has_signature);
  return hasPhotos && hasSignature;
}

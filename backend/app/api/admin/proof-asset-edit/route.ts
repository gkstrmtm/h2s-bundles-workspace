import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function corsHeaders(request?: Request) {
  const origin = String(request?.headers?.get('origin') || '').trim();
  const allowOrigin = origin || '*';
  return {
    'Access-Control-Allow-Origin': allowOrigin === 'null' ? '*' : allowOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Cache-Control, X-Requested-With, X-Admin-Key, x-admin-key',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  } as Record<string, string>;
}

function requireAdminKey(_request: Request) {
  // Proof Packs is gated at the UI/page level; do not require an extra admin key header.
  return null;
}

export async function OPTIONS(request: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request) });
}

function parseEnvMs(value: string | undefined, fallback: number) {
  const raw = String(value || '').trim();
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const CONVERT_TIMEOUT_MS = parseEnvMs(process.env.PROOF_CONVERT_TIMEOUT_MS, 50_000);

function parseRotateDeg(input: unknown): 0 | 90 | 180 | 270 {
  const raw = String(input ?? '').trim().toLowerCase();
  if (!raw) return 0;
  const n = Number(raw);
  if (n === 90 || n === 180 || n === 270) return n;
  return 0;
}

function parseBool(input: unknown): boolean {
  const raw = String(input ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function parseTrimSeconds(input: unknown): number | null {
  if (input === null || input === undefined) return null;
  const raw = String(input).trim();
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  if (n < 0) return 0;
  return Math.min(n, 60 * 60);
}

function parseTrimWindow(startInput: unknown, endInput: unknown): { startSec: number; endSec: number | null; durationSec: number | null } {
  const start = parseTrimSeconds(startInput);
  const end = parseTrimSeconds(endInput);

  const startSec = start ?? 0;
  const endSec = end;

  if (endSec !== null && endSec <= startSec) {
    throw new Error('Invalid trim window: trim_end_sec must be greater than trim_start_sec');
  }

  if (endSec === null) {
    return { startSec, endSec: null, durationSec: null };
  }

  const durationSec = Math.max(0, endSec - startSec);
  return { startSec, endSec, durationSec };
}

function parseImageDataUrl(input: unknown): { mime: string; base64: string } | null {
  const raw = String(input ?? '').trim();
  if (!raw) return null;
  const m = raw.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);
  if (!m) return null;
  const mime = String(m[1] || '').toLowerCase();
  const base64 = String(m[2] || '').trim();
  if (!mime.startsWith('image/')) return null;
  if (!base64) return null;
  return { mime, base64 };
}

function bytesFromBase64(base64: string): Buffer {
  // Node's base64 decoder ignores whitespace; still trim to reduce surprises.
  const b = Buffer.from(String(base64 || '').trim(), 'base64');
  if (!b || !b.length) throw new Error('Invalid base64 image bytes');
  return b;
}

function extFromImageMime(mime: string): string {
  const m = String(mime || '').toLowerCase();
  if (m === 'image/jpeg' || m === 'image/jpg') return 'jpg';
  if (m === 'image/webp') return 'webp';
  if (m === 'image/png') return 'png';
  return 'jpg';
}

function ffmpegRotateFilter(deg: 0 | 90 | 180 | 270): string {
  if (deg === 90) return 'transpose=1,';
  if (deg === 270) return 'transpose=2,';
  if (deg === 180) return 'hflip,vflip,';
  return '';
}

function buildVideoFilter(opts: { rotateDeg: 0 | 90 | 180 | 270; bw: boolean }) {
  const rotate = ffmpegRotateFilter(opts.rotateDeg);
  const bw = opts.bw ? 'hue=s=0,' : '';
  // Order: rotate -> scale -> bw (bw after scale avoids extra work).
  return `${rotate}scale=-2:min(1080\\,ih),${bw}format=yuv420p`;
}

async function convertVideoBytesToMp4(
  input: Buffer,
  opts: { rotateDeg: 0 | 90 | 180 | 270; trimStartSec: number; trimDurationSec: number | null; bw: boolean }
) {
  // eslint-disable-next-line no-eval
  const runtimeRequire = eval('require') as any;
  const ffmpegPath = (runtimeRequire?.('ffmpeg-static') as string | null) || null;
  if (!ffmpegPath || !existsSync(ffmpegPath)) {
    throw new Error(`Server video conversion is not available (ffmpeg missing). Path=${String(ffmpegPath || '')}`);
  }

  const id = crypto.randomUUID();
  const inPath = path.join(tmpdir(), `proof_edit_${id}.input`);
  const outPath = path.join(tmpdir(), `proof_edit_${id}.mp4`);

  await writeFile(inPath, input);
  try {
    const trimArgs: string[] = [];
    if (opts.trimStartSec > 0) trimArgs.push('-ss', String(opts.trimStartSec));
    if (opts.trimDurationSec !== null && opts.trimDurationSec > 0) trimArgs.push('-t', String(opts.trimDurationSec));

    const vf = buildVideoFilter({ rotateDeg: opts.rotateDeg, bw: opts.bw });

    const args = [
      '-y',
      '-i',
      inPath,
      ...trimArgs,
      '-map',
      '0:v:0',
      '-map',
      '0:a?',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-preset',
      'veryfast',
      '-crf',
      '23',
      '-maxrate',
      '2M',
      '-bufsize',
      '4M',
      '-vf',
      vf,
      '-movflags',
      '+faststart',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      outPath,
    ];

    await new Promise<void>((resolve, reject) => {
      const child = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '';
      const timer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          // ignore
        }
        reject(new Error('Video conversion timeout'));
      }, CONVERT_TIMEOUT_MS);

      child.stderr.on('data', (d) => {
        stderr += String(d || '');
      });
      child.on('error', (err) => reject(err));
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) return resolve();
        reject(new Error(`ffmpeg failed (exit ${code}). ${stderr.slice(-1500)}`));
      });
    });

    return await readFile(outPath);
  } finally {
    try {
      await unlink(inPath);
    } catch {
      // ignore
    }
    try {
      await unlink(outPath);
    } catch {
      // ignore
    }
  }
}

export async function POST(request: Request) {
  try {
    const authError = requireAdminKey(request);
    if (authError) {
      return NextResponse.json({ ok: false, error: authError }, { status: 401, headers: corsHeaders(request) });
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400, headers: corsHeaders(request) });
    }

    const assetId = String((body as any).asset_id || '').trim();
    if (!assetId) {
      return NextResponse.json({ ok: false, error: 'asset_id required' }, { status: 400, headers: corsHeaders(request) });
    }

    const revertToOriginal = parseBool((body as any).revert_to_original);

    // Capture lightweight properties (intent/weight/geometry) without processing video
    const updateIntent = (body as any).intent;
    const updateWeight = (body as any).weight;
    const updateSmartCrop = (body as any).smart_crop_details;
    const simpleUpdate: Record<string, any> = {};

    // Map intent to database fields (if schema differs) or same column
    if (typeof updateIntent === 'string') {
        const VALID_INTENTS = ['working_shot', 'action_proof', 'result_proof', ''];
        if (VALID_INTENTS.includes(updateIntent)) {
            simpleUpdate.shot_type = updateIntent; // Correct mapping from intent -> shot_type
        }
    }
    // Map weight to psychological_weight
    if (typeof updateWeight === 'number') simpleUpdate.psychological_weight = updateWeight;
    
    // Always save smart_crop_details if provided. This is the "Visual Truth".
    if (updateSmartCrop && typeof updateSmartCrop === 'object') {
        simpleUpdate.smart_crop_details = updateSmartCrop;
    }

    const rotateDeg = parseRotateDeg((body as any).rotate_deg);
    const bw = parseBool((body as any).filter_bw);
    const trim = parseTrimWindow((body as any).trim_start_sec, (body as any).trim_end_sec);
    const trimRequested = trim.startSec > 0 || trim.endSec !== null;
    const needsVideoProcessing = rotateDeg !== 0 || bw || trimRequested;

    const bakedImage = parseImageDataUrl((body as any).baked_image_data_url)
      || ((body as any).baked_image_base64
        ? { mime: String((body as any).baked_image_mime || 'image/jpeg').toLowerCase(), base64: String((body as any).baked_image_base64 || '') }
        : null);
    const needsPhotoBake = !!(bakedImage && bakedImage.base64);

    const nowIso = new Date().toISOString();

    let client;
    try {
      client = getSupabase();
    } catch {
      return NextResponse.json({ ok: false, error: 'Database not available' }, { status: 503, headers: corsHeaders(request) });
    }

    // REVERT PATH: Restore the preserved original (if available) and clear baked metadata.
    // This is used when an image was accidentally baked/cropped and needs to go back.
    if (revertToOriginal) {
      const { data: rows, error: selErr } = await client.from('proof_assets').select('*').eq('asset_id', assetId).limit(1);
      if (selErr) return NextResponse.json({ ok: false, error: selErr.message }, { status: 400, headers: corsHeaders(request) });
      const asset: any = rows?.[0] || null;
      if (!asset) return NextResponse.json({ ok: false, error: 'Asset not found' }, { status: 404, headers: corsHeaders(request) });

      const existingSmart = (asset.smart_crop_details && typeof asset.smart_crop_details === 'object') ? asset.smart_crop_details : {};
      const origBucket = String((existingSmart as any)?.original_storage_bucket || (existingSmart as any)?.original?.storage_bucket || asset?.storage_bucket || 'proof').trim() || 'proof';

      let origPath = String((existingSmart as any)?.original_storage_path || (existingSmart as any)?.original?.storage_path || '').trim();
      let inferredOriginal = false;

      // Fallback inference: if the asset was baked by older code (or metadata missing),
      // attempt to infer the original path from the __crop_ naming convention.
      if (!origPath) {
        const curPath = String(asset?.storage_path || '').trim();
        if (curPath && /__crop_/i.test(curPath)) {
          const guess = curPath.replace(/__crop_[a-z0-9-]+/gi, '').replace(/__crop_/gi, '');
          if (guess && guess !== curPath) {
            try {
              const { error: signedErr } = await client.storage.from(origBucket).createSignedUrl(guess, 60);
              if (!signedErr) {
                origPath = guess;
                inferredOriginal = true;
              }
            } catch {
              // ignore and fall through
            }
          }
        }
      }

      const hasOrigPath = !!origPath;

      const nextSmart: Record<string, any> = { ...(existingSmart as any) };
      // Clear baked metadata and reset framing defaults to avoid surprise cropping.
      try { delete (nextSmart as any).baked; } catch { /* ignore */ }
      nextSmart.mode = 'contain';
      nextSmart.objectPosition = '50% 50%';
      nextSmart.geometry = { tilt_deg: 0, scale_pct: 100, pan_x_pct: 0, pan_y_pct: 0 };
      nextSmart.reverted_at = nowIso;

      // If we inferred the original path, store it so future reverts are deterministic.
      if (inferredOriginal) {
        try {
          (nextSmart as any).original_storage_bucket = origBucket;
          (nextSmart as any).original_storage_path = origPath;
          (nextSmart as any).original_inferred_at = nowIso;
        } catch {
          // ignore
        }
      }

      // If we don't have an original pointer, still allow "revert" to mean
      // "reset crop/framing" back to full-image defaults.
      const patch: Record<string, any> = {
        ...simpleUpdate,
        smart_crop_details: nextSmart,
        updated_at: nowIso,
      };

      if (hasOrigPath) {
        patch.storage_bucket = origBucket;
        patch.storage_path = origPath;
        patch.content_type = String((existingSmart as any)?.original_content_type || asset?.content_type || '') || undefined;
        patch.width_px = (typeof (existingSmart as any)?.original_width_px === 'number') ? (existingSmart as any).original_width_px : undefined;
        patch.height_px = (typeof (existingSmart as any)?.original_height_px === 'number') ? (existingSmart as any).original_height_px : undefined;
      }

      let updatedRows: any[] | null = null;
      let updErr: any = null;

      {
        const r = await client.from('proof_assets').update(patch).eq('asset_id', assetId).select('*').limit(1);
        updatedRows = (r as any).data || null;
        updErr = (r as any).error || null;
      }

      if (updErr && /(updated_at|width_px|height_px|content_type)/i.test(String(updErr.message || updErr))) {
        const patch2 = { ...patch } as Record<string, any>;
        delete patch2.updated_at;
        delete patch2.width_px;
        delete patch2.height_px;
        delete patch2.content_type;
        const r2 = await client.from('proof_assets').update(patch2).eq('asset_id', assetId).select('*').limit(1);
        updatedRows = (r2 as any).data || null;
        updErr = (r2 as any).error || null;
      }

      if (updErr) return NextResponse.json({ ok: false, error: updErr.message }, { status: 400, headers: corsHeaders(request) });

      return NextResponse.json(
        { ok: true, asset: updatedRows?.[0] || null, reverted_to_original: hasOrigPath, reverted_framing: !hasOrigPath },
        { headers: corsHeaders(request) },
      );
    }

    // FAST PATH: If only metadata/geometry changed (and no baked image), update immediately and return.
    if (!needsVideoProcessing && !needsPhotoBake) {
        if (Object.keys(simpleUpdate).length === 0) {
            return NextResponse.json({ ok: true, noop: true }, { headers: corsHeaders(request) });
        }

      // Important: bump updated_at so the asset immediately becomes “recent” for proof-slots.
      // Some environments may not have updated_at; if so, retry without it.
      const fastUpdate: Record<string, any> = { ...simpleUpdate, updated_at: nowIso };

      let updatedRows: any[] | null = null;
      let updErr: any = null;

      {
        const r = await client
          .from('proof_assets')
          .update(fastUpdate)
          .eq('asset_id', assetId)
          .select('*')
          .limit(1);
        updatedRows = (r as any).data || null;
        updErr = (r as any).error || null;
      }

      if (updErr && /updated_at/i.test(String(updErr.message || updErr))) {
        const r2 = await client
          .from('proof_assets')
          .update(simpleUpdate)
          .eq('asset_id', assetId)
          .select('*')
          .limit(1);
        updatedRows = (r2 as any).data || null;
        updErr = (r2 as any).error || null;
      }

        if (updErr) return NextResponse.json({ ok: false, error: updErr.message }, { status: 400, headers: corsHeaders(request) });
        
        return NextResponse.json({ 
            ok: true, 
            asset: updatedRows?.[0] || null,
            _meta: "fast-path-metadata-only" 
        }, { headers: corsHeaders(request) });
    }

    // PHOTO BAKE PATH: Upload a baked (already-cropped) image and switch the asset to the new object.
    // This makes live rendering deterministic (no CSS cover differences).
    if (needsPhotoBake) {
      const { data: rows, error: selErr } = await client.from('proof_assets').select('*').eq('asset_id', assetId).limit(1);
      if (selErr) return NextResponse.json({ ok: false, error: selErr.message }, { status: 400, headers: corsHeaders(request) });
      const asset: any = rows?.[0] || null;
      if (!asset) return NextResponse.json({ ok: false, error: 'Asset not found' }, { status: 404, headers: corsHeaders(request) });

      const mediaKind = String(asset?.media_kind || '').trim();
      if (mediaKind === 'video') {
        return NextResponse.json({ ok: false, error: 'baked_image_data_url is for photos only' }, { status: 400, headers: corsHeaders(request) });
      }

      const bucket = String(asset?.storage_bucket || 'proof').trim() || 'proof';
      const oldPath = String(asset?.storage_path || '').trim();
      if (bucket !== 'proof') return NextResponse.json({ ok: false, error: 'Invalid bucket' }, { status: 400, headers: corsHeaders(request) });
      if (!oldPath) return NextResponse.json({ ok: false, error: 'Asset missing storage_path' }, { status: 400, headers: corsHeaders(request) });

      const outMime = String(bakedImage?.mime || 'image/jpeg').toLowerCase();
      const outBytes = bytesFromBase64(String(bakedImage?.base64 || ''));

      // Always write a NEW object key to avoid CDN cache making it look like nothing happened.
      const dir = oldPath.split('/').slice(0, -1).join('/');
      const base = oldPath.split('/').pop() || 'photo';
      const baseNoExt = base.replace(/\.[a-z0-9]+$/i, '');
      const editSuffix = crypto.randomUUID().slice(0, 8);
      const ext = extFromImageMime(outMime);
      const newPath = `${dir}/${baseNoExt}__crop_${editSuffix}.${ext}`;

      const up = await client.storage.from(bucket).upload(newPath, outBytes, {
        contentType: outMime,
        upsert: false,
      });
      if (up?.error) {
        return NextResponse.json({ ok: false, error: up.error.message || 'Upload failed' }, { status: 500, headers: corsHeaders(request) });
      }

      // Preserve the original object. (Do NOT delete oldPath.)
      const existingSmart = (asset.smart_crop_details && typeof asset.smart_crop_details === 'object') ? asset.smart_crop_details : {};
      const incomingSmart = (updateSmartCrop && typeof updateSmartCrop === 'object') ? updateSmartCrop : {};

      // Capture original pointer once (first bake wins).
      const originalStoragePath = String((existingSmart as any)?.original_storage_path || (existingSmart as any)?.original?.storage_path || '').trim();
      const finalSmart: Record<string, any> = {
        ...existingSmart,
        ...incomingSmart,
      };

      if (!originalStoragePath) {
        finalSmart.original_storage_bucket = bucket;
        finalSmart.original_storage_path = oldPath;
        finalSmart.original_content_type = String(asset?.content_type || '') || undefined;
        finalSmart.original_width_px = (typeof asset?.width_px === 'number') ? asset.width_px : undefined;
        finalSmart.original_height_px = (typeof asset?.height_px === 'number') ? asset.height_px : undefined;
      }

      // Record the baked output pointer for debugging / future features.
      finalSmart.baked = {
        ...(typeof finalSmart.baked === 'object' ? finalSmart.baked : {}),
        storage_bucket: bucket,
        storage_path: newPath,
        content_type: outMime,
        width_px: Number((body as any).baked_width_px) || undefined,
        height_px: Number((body as any).baked_height_px) || undefined,
        kind: String((body as any).baked_kind || 'crop_4_3'),
        created_at: nowIso,
      };

      const patch: Record<string, any> = {
        ...simpleUpdate,
        smart_crop_details: finalSmart,
        storage_bucket: bucket,
        storage_path: newPath,
        content_type: outMime,
        // Keep the same media_kind; normalize common variants.
        media_kind: (mediaKind === 'image') ? 'photo' : mediaKind || 'photo',
        file_size_kb: Math.round(outBytes.length / 1024),
        updated_at: nowIso,
      };

      const bwPx = Number((body as any).baked_width_px);
      const bhPx = Number((body as any).baked_height_px);
      if (Number.isFinite(bwPx) && bwPx > 0) patch.width_px = bwPx;
      if (Number.isFinite(bhPx) && bhPx > 0) patch.height_px = bhPx;

      let updatedRows: any[] | null = null;
      let updErr: any = null;

      {
        const r = await client.from('proof_assets').update(patch).eq('asset_id', assetId).select('*').limit(1);
        updatedRows = (r as any).data || null;
        updErr = (r as any).error || null;
      }

      // Retry without optional columns if the schema is narrower.
      if (updErr && /(updated_at|width_px|height_px)/i.test(String(updErr.message || updErr))) {
        const patch2 = { ...patch } as Record<string, any>;
        delete patch2.updated_at;
        delete patch2.width_px;
        delete patch2.height_px;

        const r2 = await client.from('proof_assets').update(patch2).eq('asset_id', assetId).select('*').limit(1);
        updatedRows = (r2 as any).data || null;
        updErr = (r2 as any).error || null;
      }

      if (updErr) return NextResponse.json({ ok: false, error: updErr.message }, { status: 400, headers: corsHeaders(request) });

      return NextResponse.json(
        {
          ok: true,
          asset: updatedRows?.[0] || null,
          baked: true,
          baked_storage_path: newPath,
          baked_content_type: outMime,
        },
        { headers: corsHeaders(request) },
      );
    }

    // SLOW PATH: Video processing required (transcoding/trimming)
    // We ALSO apply the simple updates here.
    const { data: rows, error: selErr } = await client.from('proof_assets').select('*').eq('asset_id', assetId).limit(1);

    if (selErr) return NextResponse.json({ ok: false, error: selErr.message }, { status: 400, headers: corsHeaders(request) });
    const asset: any = rows?.[0] || null;
    if (!asset) return NextResponse.json({ ok: false, error: 'Asset not found' }, { status: 404, headers: corsHeaders(request) });

    const mediaKind = String(asset?.media_kind || '').trim();
    if (mediaKind !== 'video') {
      return NextResponse.json({ ok: false, error: 'Edit currently supports videos only (unless baked_image_data_url is provided for photos)' }, { status: 400, headers: corsHeaders(request) });
    }

    const bucket = String(asset?.storage_bucket || 'proof').trim() || 'proof';
    const oldPath = String(asset?.storage_path || '').trim();
    if (bucket !== 'proof') return NextResponse.json({ ok: false, error: 'Invalid bucket' }, { status: 400, headers: corsHeaders(request) });
    if (!oldPath) return NextResponse.json({ ok: false, error: 'Asset missing storage_path' }, { status: 400, headers: corsHeaders(request) });

    if (rotateDeg === 0 && !trimRequested && !bw) {
      return NextResponse.json({ ok: true, noop: true }, { headers: corsHeaders(request) });
    }

    const dl = await client.storage.from(bucket).download(oldPath);
    if (dl?.error || !dl?.data) {
      return NextResponse.json({ ok: false, error: dl?.error?.message || 'Could not download asset from storage' }, { status: 404, headers: corsHeaders(request) });
    }

    const originalBytes = Buffer.from(await (dl.data as any).arrayBuffer());
    const outBytes = await convertVideoBytesToMp4(originalBytes, {
      rotateDeg,
      trimStartSec: trim.startSec,
      trimDurationSec: trim.durationSec,
      bw,
    });

    // Always write a NEW object key to avoid CDN cache making it look like nothing happened.
    const dir = oldPath.split('/').slice(0, -1).join('/');
    const base = oldPath.split('/').pop() || 'video';
    const baseNoExt = base.replace(/\.[a-z0-9]+$/i, '');
    const editSuffix = crypto.randomUUID().slice(0, 8);
    const newPath = `${dir}/${baseNoExt}__edit_${editSuffix}.mp4`;

    const up = await client.storage.from(bucket).upload(newPath, outBytes, {
      contentType: 'video/mp4',
      upsert: false,
    });
    if (up?.error) {
      return NextResponse.json({ ok: false, error: up.error.message || 'Upload failed' }, { status: 500, headers: corsHeaders(request) });
    }

    // Best-effort: remove old object after new one exists.
    try {
      await client.storage.from(bucket).remove([oldPath]);
    } catch {
      // ignore
    }

    const patch: Record<string, any> = {
      ...simpleUpdate,
      storage_bucket: bucket,
      storage_path: newPath,
      content_type: 'video/mp4',
      media_kind: 'video',
      file_size_kb: Math.round(outBytes.length / 1024),
      // We bake rotate/bw into the file on the slow path; clear the CSS flags to prevent double-apply.
      video_rotate_deg: 0,
      filter_bw: false,
      updated_at: nowIso,
    };

    // If we know the window length, update duration_seconds to match.
    if (trim.durationSec !== null && Number.isFinite(trim.durationSec)) {
      patch.duration_seconds = trim.durationSec;
    }

    let updatedRows: any[] | null = null;
    let updErr: any = null;

    {
      const r = await client.from('proof_assets').update(patch).eq('asset_id', assetId).select('*').limit(1);
      updatedRows = (r as any).data || null;
      updErr = (r as any).error || null;
    }

    // If the current DB schema doesn't include some optional columns, retry without them.
    if (updErr && /(updated_at|video_rotate_deg|filter_bw)/i.test(String(updErr.message || updErr))) {
      const patch2 = { ...patch } as Record<string, any>;
      delete patch2.updated_at;
      delete patch2.video_rotate_deg;
      delete patch2.filter_bw;

      const r2 = await client.from('proof_assets').update(patch2).eq('asset_id', assetId).select('*').limit(1);
      updatedRows = (r2 as any).data || null;
      updErr = (r2 as any).error || null;
    }

    if (updErr) return NextResponse.json({ ok: false, error: updErr.message }, { status: 400, headers: corsHeaders(request) });

    return NextResponse.json(
      {
        ok: true,
        asset: updatedRows?.[0] || null,
        received_rotate_deg: rotateDeg,
        received_trim_start_sec: trim.startSec,
        received_trim_end_sec: trim.endSec,
        received_filter_bw: bw,
      },
      { headers: corsHeaders(request) },
    );
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'Internal error' }, { status: 500, headers: corsHeaders(request) });
  }
}

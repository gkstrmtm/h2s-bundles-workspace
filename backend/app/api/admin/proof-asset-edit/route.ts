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

    const rotateDeg = parseRotateDeg((body as any).rotate_deg);
    const bw = parseBool((body as any).filter_bw);
    const trim = parseTrimWindow((body as any).trim_start_sec, (body as any).trim_end_sec);
    const trimRequested = trim.startSec > 0 || trim.endSec !== null;

    let client;
    try {
      client = getSupabase();
    } catch {
      return NextResponse.json({ ok: false, error: 'Database not available' }, { status: 503, headers: corsHeaders(request) });
    }

    const { data: rows, error: selErr } = await client.from('proof_assets').select('*').eq('asset_id', assetId).limit(1);
    if (selErr) return NextResponse.json({ ok: false, error: selErr.message }, { status: 400, headers: corsHeaders(request) });
    const asset: any = rows?.[0] || null;
    if (!asset) return NextResponse.json({ ok: false, error: 'Asset not found' }, { status: 404, headers: corsHeaders(request) });

    const mediaKind = String(asset?.media_kind || '').trim();
    if (mediaKind !== 'video') {
      return NextResponse.json({ ok: false, error: 'Edit currently supports videos only' }, { status: 400, headers: corsHeaders(request) });
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
      storage_bucket: bucket,
      storage_path: newPath,
      content_type: 'video/mp4',
      media_kind: 'video',
      file_size_kb: Math.round(outBytes.length / 1024),
    };

    // If we know the window length, update duration_seconds to match.
    if (trim.durationSec !== null && Number.isFinite(trim.durationSec)) {
      patch.duration_seconds = trim.durationSec;
    }

    const { data: updatedRows, error: updErr } = await client.from('proof_assets').update(patch).eq('asset_id', assetId).select('*').limit(1);
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

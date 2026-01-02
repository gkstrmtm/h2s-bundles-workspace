import { NextResponse } from 'next/server';
import { getSupabase, getSupabaseDispatch, getSupabaseMgmt } from '@/lib/supabase';
import { verifyPortalToken } from '@/lib/portalTokens';

function corsHeaders(request?: Request): Record<string, string> {
  const origin = request?.headers.get('origin') || '';
  const allowedOrigins = [
    'https://home2smart.com',
    'https://www.home2smart.com',
    'http://localhost:3000',
    'http://localhost:8080',
  ];

  const allowOrigin = allowedOrigins.includes(origin) ? origin : '*';

  const headers: Record<string, string> = {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  if (allowOrigin !== '*') {
    headers['Access-Control-Allow-Credentials'] = 'true';
  }

  return headers;
}

type TrainingResourceRow = {
  Resource_ID?: string;
  Title?: string;
  Type?: string;
  URL?: string;
  Description?: string;
  Category?: string;
  Order?: number;
  Created_At?: string;
  Skills_Taught?: any;
  Difficulty_Level?: string;
  Estimated_Minutes?: number;
};

type TrainingVideoRow = {
  video_id?: string;
  id?: string;
  title?: string;
  module?: string;
  category?: string;
  duration_sec?: number;
  thumbnail_url?: string;
  thumb?: string;
  url?: string;
  cn_url?: string;
  mirror_url?: string;
  region?: string;
  order_num?: number;
  description?: string;
  tags?: any;
  visible?: boolean;
};

function normalizeToken(raw: any): string {
  return String(raw || '').trim();
}

function normalizeAction(raw: any): string {
  return String(raw || '').trim();
}

function toNum(v: any): number | null {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : null;
}

function groupByModule(videos: any[]) {
  const modules: Record<string, { name: string; videos: any[] }> = {};
  for (const v of videos) {
    const moduleName = String(v?.module || v?.category || 'General').trim() || 'General';
    if (!modules[moduleName]) modules[moduleName] = { name: moduleName, videos: [] };
    modules[moduleName].videos.push(v);
  }
  return Object.values(modules);
}

function getSupabaseRefFromUrl(url: string) {
  const m = String(url || '').match(/https:\/\/([a-z0-9]+)\.supabase\.co/i);
  return m?.[1] || null;
}

function getClientUrl(client: any): string {
  return String(client?.supabaseUrl || client?.rest?.url || process.env.SUPABASE_URL || '');
}

function getPortalTrainingCatalogClient() {
  // Portal training catalog MUST come from the primary (non-management) database.
  // We intentionally do NOT use dispatch or mgmt credentials here.
  return { client: getSupabase(), source: 'main' };
}

function normalizeVideo(row: TrainingVideoRow, opts?: { china?: boolean }) {
  const id = String(row?.id || row?.video_id || '').trim();
  if (!id) return null;

  const title = String(row?.title || '').trim() || 'Untitled';
  const module = String(row?.module || row?.category || 'General').trim() || 'General';
  const durationSec = Number(row?.duration_sec || 0) || 0;
  const thumb = row?.thumbnail_url || row?.thumb || null;

  const url = opts?.china ? (row?.cn_url || row?.mirror_url || row?.url || '') : (row?.url || '');
  const safeUrl = String(url || '').trim();
  if (!safeUrl) return null;

  const tags = Array.isArray(row?.tags)
    ? row.tags
    : row?.tags
      ? String(row.tags)
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
      : [];

  return {
    id,
    video_id: id,
    title,
    module,
    category: module,
    duration_sec: durationSec,
    thumbnail: null,
    thumbnail_url: thumb,
    url: safeUrl,
    region: row?.region || (opts?.china ? 'china' : 'global'),
    order_num: Number(row?.order_num || 0) || 0,
    description: row?.description || '',
    tags,
  };
}

async function queryTrainingVideos(opts?: { china?: boolean }) {
  const { client, source } = getPortalTrainingCatalogClient();

  let q = client
    .from('h2s_training_videos')
    .select('*')
    .eq('visible', true)
    .order('module', { ascending: true })
    .order('order_num', { ascending: true });

  if (opts?.china) {
    q = q.in('region', ['china', 'global']);
  }

  const { data, error } = await q;
  if (error) {
    throw new Error(`portal training catalog query failed: ${error.message}`);
  }

  const raw = (data || []) as TrainingVideoRow[];
  const videos = raw.map((r) => normalizeVideo(r, { china: !!opts?.china })).filter(Boolean);

  return {
    source,
    videos,
    resources: [] as any[],
    modules: groupByModule(videos as any[]),
    supabase_ref: getSupabaseRefFromUrl(getClientUrl(client)),
  };
}

function scoreRecommend(queryRaw: string, videos: any[]) {
  const query = String(queryRaw || '').toLowerCase().trim();
  const tokens = query.split(/\s+/).filter(Boolean);

  if (!query || tokens.length === 0) {
    return { clarifying_question: "What are you trying to do? (e.g., 'install thermostat' or 'mount TV')", recommendations: [] as any[] };
  }

  const scored = (videos || []).map((v: any) => {
    const id = String(v?.id || v?.video_id || '').trim();
    const title = String(v?.title || '').toLowerCase();
    const desc = String(v?.description || '').toLowerCase();
    const module = String(v?.module || v?.category || '').toLowerCase();
    const tags = Array.isArray(v?.tags) ? v.tags.map((t: any) => String(t).toLowerCase()) : [];

    let score = 0;
    for (const t of tokens) {
      if (!t) continue;
      if (title.includes(t)) score += 6;
      if (module.includes(t)) score += 3;
      if (desc.includes(t)) score += 2;
      if (tags.some((x: string) => x.includes(t))) score += 2;
    }

    // Small boost for shorter "how-to" videos.
    const duration = Number(v?.duration_sec || 0) || 0;
    if (duration > 0 && duration <= 900) score += 1;

    return { id, score, title: v?.title };
  });

  scored.sort((a, b) => (b.score || 0) - (a.score || 0));
  const top = scored.filter((s) => s.id && s.score > 0).slice(0, 5);

  if (top.length === 0) {
    return {
      clarifying_question: "I couldn't find a close match. What device/service is this for (thermostat, doorbell, TV, Wi‑Fi)?",
      recommendations: [] as any[],
    };
  }

  return {
    recommendations: top.map((s) => ({
      id: s.id,
      reason: `Matches your request: ${query}`,
      score: s.score,
    })),
  };
}

async function getProgressClient() {
  const dispatch = getSupabaseDispatch();
  if (dispatch) return dispatch;
  return getSupabase();
}

async function trySelectProgress(client: any, proId: string, videoId?: string | null) {
  try {
    let q = client.from('h2s_training_progress').select('*').eq('pro_id', proId);
    if (videoId) q = q.eq('video_id', videoId);
    const { data, error } = await q;
    if (error) return { ok: false as const, error };
    return { ok: true as const, data: data || [] };
  } catch (e: any) {
    return { ok: false as const, error: e };
  }
}

async function tryUpsertProgress(client: any, proId: string, videoId: string, patch: any) {
  const now = new Date().toISOString();

  const existing = await trySelectProgress(client, proId, videoId);
  if (!existing.ok) {
    return { ok: false as const, error: existing.error };
  }

  const row = existing.data?.[0];

  try {
    if (row) {
      const { error } = await client
        .from('h2s_training_progress')
        .update({ ...patch, last_watched_at: now })
        .eq('pro_id', proId)
        .eq('video_id', videoId);
      if (error) return { ok: false as const, error };
      return { ok: true as const, mode: 'update' };
    }

    const insertRow = {
      pro_id: proId,
      video_id: videoId,
      position_sec: 0,
      duration_sec: 0,
      total_watch_time: 0,
      watch_count: 0,
      completed: false,
      last_watched_at: now,
      ...patch,
    };

    const { error } = await client.from('h2s_training_progress').insert(insertRow);
    if (error) return { ok: false as const, error };
    return { ok: true as const, mode: 'insert' };
  } catch (e: any) {
    return { ok: false as const, error: e };
  }
}

async function handle(request: Request) {
  const url = new URL(request.url);

  let body: any = null;
  if (request.method === 'POST') {
    try {
      body = await request.json();
    } catch {
      body = null;
    }
  }

  const action = normalizeAction(url.searchParams.get('action') || body?.action);
  const token = normalizeToken(url.searchParams.get('token') || body?.token);

  if (!action) {
    return NextResponse.json(
      { ok: false, error: 'Missing action parameter', error_code: 'bad_request' },
      { status: 400, headers: corsHeaders(request) }
    );
  }

  if (!token) {
    return NextResponse.json(
      { ok: false, error: 'Missing token', error_code: 'missing_token' },
      { status: 401, headers: corsHeaders(request) }
    );
  }

  let proId: string;
  try {
    const payload = verifyPortalToken(token);
    if (payload.role !== 'pro') {
      return NextResponse.json(
        { ok: false, error: 'Forbidden', error_code: 'forbidden' },
        { status: 403, headers: corsHeaders(request) }
      );
    }
    proId = String(payload.sub);
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || 'Invalid token', error_code: 'invalid_token' },
      { status: 401, headers: corsHeaders(request) }
    );
  }

  try {
    if (action === 'catalog' || action === 'china_catalog') {
      const catalog = await queryTrainingVideos({ china: action === 'china_catalog' });
      return NextResponse.json(
        {
          ok: true,
          ...catalog,
            meta: {
              source_db: catalog.source,
              source_table: 'h2s_training_videos',
              pro_id: proId,
              supabase_ref: catalog.supabase_ref,
            },
        },
        { headers: corsHeaders(request) }
      );
    }

    if (action === 'recommend') {
      const query = String(url.searchParams.get('query') || body?.query || '').trim();
      const inputVideos = Array.isArray(body?.videos) ? body.videos : null;

      // Prefer the UI-provided list to avoid DB dependencies.
      if (inputVideos && inputVideos.length) {
        const rec = scoreRecommend(query, inputVideos);
        return NextResponse.json({ ok: true, ...rec }, { headers: corsHeaders(request) });
      }

      // Fallback: recommend from the catalog.
      const catalog = await queryTrainingVideos({ china: false });
      const rec = scoreRecommend(query, catalog.videos || []);
      return NextResponse.json({ ok: true, ...rec }, { headers: corsHeaders(request) });
    }

    if (action === 'progress') {
      const videoId = normalizeToken(url.searchParams.get('video_id') || body?.video_id) || null;
      const client = await getProgressClient();

      const sel = await trySelectProgress(client, proId, videoId);
      if (sel.ok) {
        if (!videoId) {
          return NextResponse.json({ ok: true, progress: sel.data }, { headers: corsHeaders(request) });
        }

        const row = sel.data?.[0] || null;
        return NextResponse.json(
          {
            ok: true,
            position_sec: row?.position_sec || 0,
            duration_sec: row?.duration_sec || 0,
            completed: !!row?.completed,
            total_watch_time: row?.total_watch_time || 0,
            watch_count: row?.watch_count || 0,
            meta: { persisted: true },
          },
          { headers: corsHeaders(request) }
        );
      }

      return NextResponse.json(
        {
          ok: true,
          position_sec: 0,
          duration_sec: 0,
          completed: false,
          total_watch_time: 0,
          watch_count: 0,
          meta: { persisted: false, warning: sel.error?.message || String(sel.error) },
        },
        { headers: corsHeaders(request) }
      );
    }

    if (action === 'heartbeat') {
      const videoId = normalizeToken(url.searchParams.get('video_id') || body?.video_id);
      if (!videoId) {
        return NextResponse.json(
          { ok: false, error: 'Missing video_id', error_code: 'bad_request' },
          { status: 400, headers: corsHeaders(request) }
        );
      }

      const positionSec = toNum(url.searchParams.get('position_sec') || body?.position_sec) ?? 0;
      const durationSec = toNum(url.searchParams.get('duration_sec') || body?.duration_sec) ?? 0;
      const watchDelta = toNum(url.searchParams.get('watch_time_delta') || body?.watch_time_delta) ?? 0;

      const isCompleted = durationSec > 0 ? positionSec >= durationSec * 0.95 : false;

      const client = await getProgressClient();
      const sel = await trySelectProgress(client, proId, videoId);
      const existing = sel.ok ? (sel.data?.[0] || null) : null;

      const prevTotal = Number(existing?.total_watch_time || 0) || 0;
      const prevCount = Number(existing?.watch_count || 0) || 0;
      const prevDuration = Number(existing?.duration_sec || 0) || 0;
      const prevCompleted = !!existing?.completed;

      const safeDelta = Math.max(0, watchDelta);
      const nextTotal = prevTotal + safeDelta;
      const nextCount = prevCount + (safeDelta > 0 ? 1 : 0);
      const nextDuration = Math.max(prevDuration, durationSec);
      const nextCompleted = prevCompleted || isCompleted;

      const up = await tryUpsertProgress(client, proId, videoId, {
        position_sec: positionSec,
        duration_sec: nextDuration,
        total_watch_time: nextTotal,
        watch_count: nextCount,
        completed: nextCompleted,
        ...(nextCompleted && !prevCompleted ? { completed_at: new Date().toISOString() } : {}),
      });

      return NextResponse.json(
        {
          ok: true,
          position_sec: positionSec,
          duration_sec: nextDuration,
          total_watch_time: nextTotal,
          watch_count: nextCount,
          completed: nextCompleted,
          meta: up.ok ? { persisted: true } : { persisted: false, warning: up.error?.message || String(up.error) },
        },
        { headers: corsHeaders(request) }
      );
    }

    if (action === 'complete') {
      const videoId = normalizeToken(url.searchParams.get('video_id') || body?.video_id);
      if (!videoId) {
        return NextResponse.json(
          { ok: false, error: 'Missing video_id', error_code: 'bad_request' },
          { status: 400, headers: corsHeaders(request) }
        );
      }

      const client = await getProgressClient();
      const up = await tryUpsertProgress(client, proId, videoId, {
        completed: true,
        completed_at: new Date().toISOString(),
      });

      return NextResponse.json(
        { ok: true, completed: true, meta: up.ok ? { persisted: true } : { persisted: false, warning: up.error?.message || String(up.error) } },
        { headers: corsHeaders(request) }
      );
    }

    return NextResponse.json(
      { ok: false, error: `Invalid action: ${action}`, error_code: 'invalid_action' },
      { status: 400, headers: corsHeaders(request) }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || 'Internal error', error_code: 'server_error' },
      { status: 500, headers: corsHeaders(request) }
    );
  }
}

export async function OPTIONS(request: Request) {
  return NextResponse.json({}, { headers: corsHeaders(request) });
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}

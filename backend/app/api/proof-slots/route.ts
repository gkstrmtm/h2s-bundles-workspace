import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders() });
}

function clampInt(value: string | null, fallback: number, min: number, max: number) {
  const n = parseInt(value || '', 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function computeQualityScore(asset: any) {
  // Lightweight heuristic that’s easy to reason about.
  // Range: ~0–100.
  let score = 0;

  const isVideo = asset.media_kind === 'video';
  const fileSizeKb = typeof asset.file_size_kb === 'number' ? asset.file_size_kb : null;
  const durationSeconds = typeof asset.duration_seconds === 'number' ? asset.duration_seconds : null;
  const width = typeof asset.width_px === 'number' ? asset.width_px : null;
  const height = typeof asset.height_px === 'number' ? asset.height_px : null;
  const hasAudio = asset.has_audio === true;

  // Prefer reasonable dimensions
  if (width && height) {
    const minDim = Math.min(width, height);
    if (minDim >= 720) score += 20;
    else if (minDim >= 540) score += 10;
  }

  // Prefer short clips
  if (isVideo) {
    if (durationSeconds !== null) {
      if (durationSeconds <= 12) score += 25;
      else if (durationSeconds <= 20) score += 15;
      else score += 5;
    }
    if (hasAudio) score += 2;
  } else {
    score += 20; // photos are inherently “fast + stable”
  }

  // Prefer smaller file size
  if (fileSizeKb !== null) {
    if (fileSizeKb <= 250) score += 25;
    else if (fileSizeKb <= 800) score += 15;
    else score += 5;
  }

  // Visibility + verification
  if (asset.is_visible) score += 10;
  if (asset.is_verified) score += 10;

  return Math.max(0, Math.min(100, score));
}

function slotFitness(slotKey: string, asset: any) {
  // Hard rules (“what goes where”)
  const isTv = asset.service === 'tv_mounting';
  const isCams = asset.service === 'cameras';

  const shot = String(asset.shot_type || '').toLowerCase();
  const isNight = asset.time_of_day === 'night';
  const isVideo = asset.media_kind === 'video';
  const isPhoto = asset.media_kind === 'photo';

  // Night B/W camera POV: camera sections only
  if (isNight && isCams && slotKey === 'hero') return -Infinity;

  // Hero: prefer TV photos (clean finish / after) or calm short video (rare)
  if (slotKey === 'hero') {
    if (isPhoto && isTv) {
      if (shot.includes('after') || shot.includes('clean')) return 50;
      return 30;
    }
    // Cameras hero is allowed but lower priority
    if (isPhoto && isCams) return 15;
    if (isVideo) return 5;
    return -Infinity;
  }

  // Mid-proof rail: a mix is ok, but TV process POV belongs here
  if (slotKey === 'mid_proof_rail') {
    if (isTv && (shot.includes('level') || shot.includes('stud') || shot.includes('conceal'))) return 50;
    // Cameras: motion tracking / POV is very strong proof
    if (isCams && (shot.includes('motion') || shot.includes('track'))) return 60;
    if (isCams && (shot.includes('mount') || shot.includes('weather') || shot.includes('pov') || shot.includes('view'))) return 45;
    return 25;
  }

  // Pre-CTA: reassurance proof is king
  if (slotKey === 'pre_cta') {
    // Camera motion tracking following a person is the highest-converting proof unit
    if (isCams && (shot.includes('motion') || shot.includes('track'))) return 70;
    if (isCams && (shot.includes('pov') || shot.includes('view'))) return 60;
    if (isCams && (shot.includes('weather') || shot.includes('seal') || shot.includes('mount'))) return 45;
    if (isTv && (shot.includes('level') || shot.includes('stud'))) return 35;
    return 15;
  }

  return 0;
}

function shotHas(shot: string, terms: string[]) {
  const s = String(shot || '').toLowerCase();
  return terms.some((t) => s.includes(t));
}

function diversifyRanked(slotKey: string, service: string, ranked: any[], limitPerSlot: number) {
  const max = Math.max(1, Math.min(12, limitPerSlot));
  if (!Array.isArray(ranked) || ranked.length <= 1) return (ranked || []).slice(0, max);

  // Hero is intentionally “best single asset” style.
  if (slotKey === 'hero') return ranked.slice(0, max);

  // Goal: avoid showing 3 near-identical POVs or 3 near-identical mounted shots.
  // We keep it simple + deterministic: pick top from desired categories first, then fill.
  const picked: any[] = [];
  const pickedIds = new Set<string>();

  const pickFirst = (predicate: (a: any) => boolean) => {
    for (const a of ranked) {
      const id = String(a?.asset_id || a?.storage_path || '');
      if (!id || pickedIds.has(id)) continue;
      if (!predicate(a)) continue;
      pickedIds.add(id);
      picked.push(a);
      return true;
    }
    return false;
  };

  const fill = () => {
    for (const a of ranked) {
      if (picked.length >= max) break;
      const id = String(a?.asset_id || a?.storage_path || '');
      if (!id || pickedIds.has(id)) continue;
      pickedIds.add(id);
      picked.push(a);
    }
  };

  const isCams = service === 'cameras';
  const isTv = service === 'tv_mounting';

  const isCameraMotion = (a: any) => shotHas(a?.shot_type, ['motion', 'track']);
  const isCameraPov = (a: any) => shotHas(a?.shot_type, ['pov', 'view']);
  const isCameraMounted = (a: any) => shotHas(a?.shot_type, ['mount', 'seal', 'weather']);
  const isCameraHandheld = (a: any) => shotHas(a?.shot_type, ['third', 'hand', 'bird']);
  const isTvFinish = (a: any) => shotHas(a?.shot_type, ['after', 'clean', 'finish']);
  const isTvProcess = (a: any) => shotHas(a?.shot_type, ['stud', 'level', 'conceal', 'during']);

  if (slotKey === 'pre_cta') {
    if (isCams) {
      pickFirst(isCameraMotion);
      pickFirst(isCameraPov);
      pickFirst((a) => isCameraMounted(a) || isCameraHandheld(a));
      fill();
      return picked.slice(0, max);
    }
    if (isTv) {
      pickFirst(isTvFinish);
      pickFirst(isTvProcess);
      fill();
      return picked.slice(0, max);
    }
  }

  if (slotKey === 'mid_proof_rail') {
    if (isCams) {
      pickFirst(isCameraMotion);
      pickFirst(isCameraPov);
      pickFirst((a) => isCameraMounted(a) || isCameraHandheld(a));
      fill();
      return picked.slice(0, max);
    }
    if (isTv) {
      pickFirst(isTvProcess);
      pickFirst(isTvFinish);
      fill();
      return picked.slice(0, max);
    }
  }

  return ranked.slice(0, max);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const surface = (searchParams.get('surface') || 'bundles').trim();
  const limitPerSlot = clampInt(searchParams.get('limit') || '6', 6, 1, 12);

  try {
    // Safe fallback payload (frontend must be able to render with no DB support)
    const empty = {
      ok: true,
      surface,
      slots: {
        hero: { tv_mounting: [], cameras: [] },
        mid_proof_rail: { tv_mounting: [], cameras: [] },
        pre_cta: { tv_mounting: [], cameras: [] },
      },
      message: 'No proof assets configured',
    };

    let client;
    try {
      client = getSupabase();
    } catch {
      return NextResponse.json(empty, { headers: corsHeaders() });
    }

    // 1) Try slot assignments first
    const { data: slotRows, error: slotErr } = await client
      .from('proof_slots')
      .select('*')
      .eq('surface', surface)
      .eq('status', 'active');

    if (slotErr) {
      // If schema not present yet, return safe empty
      return NextResponse.json(empty, { headers: corsHeaders() });
    }

    // 2) For each slot+service, gather assets by explicit assignment (asset_id) or by pack_id
    const grouped: any = {
      hero: { tv_mounting: [], cameras: [] },
      mid_proof_rail: { tv_mounting: [], cameras: [] },
      pre_cta: { tv_mounting: [], cameras: [] },
    };

    for (const slotKey of ['hero', 'mid_proof_rail', 'pre_cta']) {
      for (const service of ['tv_mounting', 'cameras']) {
        const slot = (slotRows || []).find((r: any) => r.slot_key === slotKey && r.service === service);
        if (!slot) continue;

        let assets: any[] = [];

        if (slot.asset_id) {
          const { data } = await client.from('proof_assets').select('*').eq('asset_id', slot.asset_id).limit(1);
          assets = (data || []) as any[];
        } else if (slot.pack_id) {
          const { data } = await client
            .from('proof_assets')
            .select('*')
            .eq('pack_id', slot.pack_id)
            .eq('is_visible', true)
            .order('created_at', { ascending: false })
            .limit(50);
          assets = (data || []) as any[];
        }

        // Apply intelligence: compute quality + slot fitness; performance gate for hero
        const ranked = assets
          .map((a: any) => {
            const quality = typeof a.quality_score === 'number' && a.quality_score > 0
              ? a.quality_score
              : computeQualityScore(a);
            const fit = slotFitness(slotKey, a);
            const perfGate = slotKey === 'hero'
              ? (typeof a.file_size_kb === 'number' ? a.file_size_kb <= 250 : a.media_kind === 'photo')
              : true;
            return {
              ...a,
              quality_score: quality,
              slot_fitness_score: fit,
              allowed_for_slot: perfGate && Number.isFinite(fit),
            };
          })
          .filter((a: any) => a.allowed_for_slot)
          .sort((a: any, b: any) => {
            const aScore = (a.slot_fitness_score || 0) * 2 + (a.quality_score || 0);
            const bScore = (b.slot_fitness_score || 0) * 2 + (b.quality_score || 0);
            return bScore - aScore;
          });

        const diversified = diversifyRanked(slotKey, service, ranked, limitPerSlot)
          .map((a: any) => ({
            asset_id: a.asset_id,
            pack_id: a.pack_id,
            service: a.service,
            media_kind: a.media_kind,
            shot_type: a.shot_type,
            time_of_day: a.time_of_day,
            storage_bucket: a.storage_bucket,
            storage_path: a.storage_path,
            content_type: a.content_type,
            width_px: a.width_px,
            height_px: a.height_px,
            duration_seconds: a.duration_seconds,
            file_size_kb: a.file_size_kb,
            has_audio: a.has_audio,
            quality_score: a.quality_score,
            slot_fitness_score: a.slot_fitness_score,
            smart_crop_details: a.smart_crop_details,
            city: a.city,
            state: a.state,
          }));

        grouped[slotKey][service] = diversified;
      }
    }

    return NextResponse.json({ ok: true, surface, slots: grouped }, { 
      headers: {
        ...corsHeaders(),
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'CDN-Cache-Control': 'no-store'
      }
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || 'Failed to fetch proof slots' },
      { status: 500, headers: corsHeaders() },
    );
  }
}

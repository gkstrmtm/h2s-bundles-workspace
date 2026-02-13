import { NextRequest, NextResponse } from 'next/server';
import { getSupabase, getSupabaseDispatch, getSupabaseMgmt } from '@/lib/supabase';

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
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-h2s-admin-token, x-h2s-admin-key, x-correlation-id, x-request-id',
  };

  if (allowOrigin !== '*') {
    headers['Access-Control-Allow-Credentials'] = 'true';
  }

  return headers;
}

type SectionError = { section: string; message: string };

type Timings = Record<string, number>;

function nowMs() {
  return Date.now();
}

function clampInt(value: unknown, min: number, max: number, fallback: number) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

function getRequestId(request: NextRequest) {
  return (
    request.headers.get('x-correlation-id') ||
    request.headers.get('x-request-id') ||
    `ws_${Date.now()}_${Math.random().toString(16).slice(2)}`
  );
}

function safeJsonParse(value: any) {
  if (value == null) return null;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function isOffersSchemaMismatchError(err: any) {
  const msg = String(err?.message || '').toLowerCase();
  return (
    msg.includes('relation') && msg.includes('does not exist') ||
    msg.includes('column') && msg.includes('does not exist') ||
    msg.includes('invalid input syntax for type uuid')
  );
}

function isSchemaMismatchError(err: any) {
  const msg = String(err?.message || '').toLowerCase();
  return msg.includes('column') && msg.includes('does not exist');
}

function getDeliverablesDb() {
  try {
    const mgmt = getSupabaseMgmt();
    if (mgmt) return mgmt;
  } catch {
    // ignore
  }
  return getSupabase();
}

function getOffersDbFallback() {
  return {
    primary: getDeliverablesDb(),
    fallback: getSupabase(),
  };
}

async function loadOffer(offerId: string) {
  const { primary, fallback } = getOffersDbFallback();

  const run = async (db: any) => {
    return await db.from('Offers').select('*').eq('Offer_ID', offerId).single();
  };

  let { data: offer, error } = await run(primary);
  if (error && isOffersSchemaMismatchError(error)) {
    ({ data: offer, error } = await run(fallback));
  }
  return { offer, error };
}

function getOfferFrameworks(offer: any) {
  const ai = safeJsonParse(offer?.AI_Analysis) || offer?.AI_Analysis || {};
  const frameworks = ai?.offer_frameworks || ai?.offerFrameworks || null;
  return frameworks;
}

function findDeterministicBrief(deliverables: any[]) {
  // Deterministic rule:
  // 1) Deliverable_Type == 'offer_brief' (or metadata.type === 'offer_brief')
  // 2) Prefer Status COMPLETE/APPROVED, else newest by Updated_At/Created_At
  const normalized = (deliverables || []).map((d) => {
    const md = safeJsonParse(d?.Metadata) || d?.Metadata || null;
    const deliverableType = String(d?.Deliverable_Type || md?.type || '').toLowerCase();
    const status = String(d?.Status || '').toUpperCase();
    const updatedAt = d?.Updated_At || d?.UpdatedAt || null;
    const createdAt = d?.Created_At || d?.CreatedAt || null;
    return {
      raw: d,
      deliverableType,
      status,
      sortTs: new Date(updatedAt || createdAt || 0).getTime(),
    };
  });

  const briefs = normalized.filter((x) => x.deliverableType === 'offer_brief');
  if (!briefs.length) return null;

  const goodStatus = new Set(['COMPLETE', 'COMPLETED', 'APPROVED', 'FINAL']);
  const best = briefs
    .slice()
    .sort((a, b) => {
      const aGood = goodStatus.has(a.status) ? 1 : 0;
      const bGood = goodStatus.has(b.status) ? 1 : 0;
      if (aGood !== bGood) return bGood - aGood;
      return b.sortTs - a.sortTs;
    })[0];

  return best?.raw || null;
}

async function loadDeliverablesForOffer(params: {
  offerId: string;
  deliverableType?: string | null;
  status?: string | null;
  cursor?: string | null;
  limit: number;
}) {
  const { offerId, deliverableType, status, cursor, limit } = params;
  const db = getDeliverablesDb();

  const baseSelect = [
    'Deliverable_ID',
    'Offer_ID',
    'Deliverable_Type',
    'Task_ID',
    'Title',
    'Description',
    'File_Link',
    'Submitted_By',
    'Status',
    'Metadata',
    'AI_Analysis',
    'Created_At',
    'Updated_At',
  ].join(',');

  const runQuery = async () => {
    let q = db
      .from('Deliverables')
      .select(baseSelect)
      .order('Created_At', { ascending: false })
      .limit(limit);

    q = q.eq('Offer_ID', offerId);

    if (status) q = q.eq('Status', status);
    if (deliverableType) q = q.eq('Deliverable_Type', deliverableType);
    if (cursor) q = q.lt('Created_At', cursor);

    return await q;
  };

  let { data, error } = await runQuery();

  if (error && isSchemaMismatchError(error)) {
    // Back-compat fallback: query without new columns and filter via Metadata.
    let q = db
      .from('Deliverables')
      .select('*')
      .order('Created_At', { ascending: false })
      .limit(Math.min(limit * 4, 800));

    if (status) q = q.eq('Status', status);
    if (cursor) q = q.lt('Created_At', cursor);

    const res = await q;
    if (res.error) return { deliverables: null as any, error: res.error };

    const filtered = (res.data || []).filter((d: any) => {
      const md = safeJsonParse(d?.Metadata) || d?.Metadata || null;
      const mdOfferId = md?.offerId || md?.offer_id || md?.Offer_ID;
      const mdType = String(md?.type || md?.deliverableType || '').toLowerCase();
      const wantType = deliverableType ? String(deliverableType).toLowerCase() : null;

      const offerMatches = String(mdOfferId || '') === String(offerId);
      const typeMatches = !wantType || mdType === wantType;

      // Special-case historical briefs titled like "Offer Brief: <name>" when offerId was stored as name.
      const title = String(d?.Title || '').toLowerCase();
      const legacyBriefMatch =
        wantType === 'offer_brief' && (title.includes('offer brief') || title.includes('offerbuilder'));

      return offerMatches ? typeMatches : legacyBriefMatch && wantType === 'offer_brief';
    });

    data = filtered.slice(0, limit);
    error = null;
  }

  const items: any[] = (data as any[]) || [];
  const nextCursor = items.length ? (items[items.length - 1] as any)?.Created_At || null : null;
  return { deliverables: items, nextCursor, error };
}

async function loadCreativesForOffer(params: { offerId: string; limit: number }) {
  // Creatives live in main DB for most installs; links may be in mgmt DB.
  const mgmtDb = getDeliverablesDb();
  const mainDb = getSupabaseDispatch();

  if (!mainDb) {
    return { creatives: null as any, error: { message: 'Dispatch DB not configured' } };
  }

  const { offerId, limit } = params;

  const linksRes = await mgmtDb
    .from('ad_creative_links')
    .select('creative_id,created_at')
    .eq('offer_id', offerId)
    .order('created_at', { ascending: false })
    .limit(Math.min(limit, 500));

  if (linksRes.error) {
    return { creatives: null as any, error: linksRes.error };
  }

  const creativeIds = (linksRes.data || []).map((r: any) => r.creative_id).filter(Boolean);
  if (!creativeIds.length) return { creatives: [], error: null };

  const creativesRes = await mainDb
    .from('ad_creatives')
    .select('*')
    .in('creative_id', creativeIds)
    .limit(Math.min(limit, 500));

  if (creativesRes.error) {
    return { creatives: null as any, error: creativesRes.error };
  }

  // Reorder to link order
  const byId = new Map((creativesRes.data || []).map((c: any) => [c.creative_id, c]));
  const ordered = creativeIds.map((id) => byId.get(id)).filter(Boolean);
  return { creatives: ordered, error: null };
}

export async function GET(request: NextRequest, ctx: { params: Promise<{ offerId: string }> }) {
  const start = nowMs();
  const timings: Timings = {};
  const errors: SectionError[] = [];
  const requestId = getRequestId(request);

  try {
    const { offerId } = await ctx.params;

    const searchParams = request.nextUrl.searchParams;
    const deliverablesLimit = clampInt(searchParams.get('deliverablesLimit'), 1, 200, 50);
    const deliverablesCursor = searchParams.get('deliverablesCursor');
    const deliverablesStatus = searchParams.get('deliverablesStatus');
    const deliverablesType = searchParams.get('deliverablesType');
    const creativesLimit = clampInt(searchParams.get('creativesLimit'), 0, 200, 50);

    const tOffer = nowMs();
    const { offer, error: offerError } = await loadOffer(offerId);
    timings.offer = nowMs() - tOffer;

    if (offerError) {
      return NextResponse.json(
        {
          ok: false,
          requestId,
          error: `Failed to load offer: ${offerError.message}`,
        },
        { status: 500, headers: { ...corsHeaders(request), 'x-correlation-id': requestId } }
      );
    }

    const frameworks = getOfferFrameworks(offer);

    const tDelivs = nowMs();
    const delivsRes = await loadDeliverablesForOffer({
      offerId,
      deliverableType: deliverablesType,
      status: deliverablesStatus,
      cursor: deliverablesCursor,
      limit: deliverablesLimit,
    });
    timings.deliverables = nowMs() - tDelivs;
    if (delivsRes.error) {
      errors.push({ section: 'deliverables', message: delivsRes.error.message });
    }

    const deliverables = delivsRes.deliverables || [];
    const tBrief = nowMs();
    const briefRes = await loadDeliverablesForOffer({
      offerId,
      deliverableType: 'offer_brief',
      status: null,
      cursor: null,
      limit: 50,
    });
    timings.brief = nowMs() - tBrief;
    if (briefRes.error) {
      errors.push({ section: 'brief', message: briefRes.error.message });
    }

    const brief = findDeterministicBrief(briefRes.deliverables || deliverables);

    const tCreatives = nowMs();
    const creativesRes = creativesLimit
      ? await loadCreativesForOffer({ offerId, limit: creativesLimit })
      : { creatives: [], error: null };
    timings.creatives = nowMs() - tCreatives;
    if (creativesRes.error) {
      errors.push({ section: 'creatives', message: creativesRes.error.message });
    }

    const integrity = {
      offerFound: true,
      hasFrameworks: !!frameworks,
      deliverablesCount: deliverables.length,
      briefSelected: brief ? { Deliverable_ID: brief.Deliverable_ID, Title: brief.Title } : null,
      creativesCount: (creativesRes.creatives || []).length,
      issues: [] as string[],
    };

    if (!brief) integrity.issues.push('No offer brief deliverable found for this offer.');

    timings.total = nowMs() - start;

    return NextResponse.json(
      {
        ok: true,
        requestId,
        offer,
        frameworks,
        brief,
        deliverablesPage: {
          items: deliverables,
          nextCursor: delivsRes.nextCursor || null,
          limit: deliverablesLimit,
        },
        creatives: creativesRes.creatives || [],
        integrity,
        errors,
        timings,
      },
      { headers: { ...corsHeaders(request), 'x-correlation-id': requestId } }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, requestId, error: e?.message || 'Unknown error' },
      { status: 500, headers: { ...corsHeaders(request), 'x-correlation-id': requestId } }
    );
  }
}

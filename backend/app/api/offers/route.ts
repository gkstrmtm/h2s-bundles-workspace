import { NextRequest, NextResponse } from 'next/server';
import { getSupabase, getSupabaseMgmt } from '@/lib/supabase';

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
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-h2s-admin-token, x-h2s-admin-key, x-correlation-id, x-request-id',
  };

  if (allowOrigin !== '*') {
    headers['Access-Control-Allow-Credentials'] = 'true';
  }

  return headers;
}

function clampInt(value: unknown, min: number, max: number, fallback: number) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

function safeTrim(v: any) {
  return String(v ?? '').trim();
}

function safeLower(v: any) {
  return safeTrim(v).toLowerCase();
}

function parseMaybeJson(value: any) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function extractMetadataType(md: any) {
  const obj = parseMaybeJson(md);
  if (!obj || typeof obj !== 'object') return '';
  return safeLower((obj as any).type || (obj as any).kind || (obj as any).deliverableType || '');
}

function isOffersSchemaMismatchError(err: any) {
  const msg = String(err?.message || '').toLowerCase();
  return (
    (msg.includes('relation') && msg.includes('does not exist')) ||
    (msg.includes('column') && msg.includes('does not exist')) ||
    msg.includes('invalid input syntax for type uuid')
  );
}

function getOffersDbFallback() {
  let primary: any = null;
  try {
    primary = getSupabaseMgmt();
  } catch {
    // ignore
  }

  return {
    primary: primary || getSupabase(),
    fallback: getSupabase(),
  };
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request) });
}

export async function GET(request: NextRequest) {
  const searchParams = new URL(request.url).searchParams;
  const limit = clampInt(searchParams.get('limit'), 1, 500, 200);
  const offersVaName = safeTrim(searchParams.get('vaName') || searchParams.get('createdBy') || '');

  const wantFull = ['1', 'true', 'yes'].includes(String(searchParams.get('full') || searchParams.get('includeFull') || '').toLowerCase());
  const slim = !wantFull;

  const slimSelect = [
    'Offer_ID',
    'Created_By',
    'Created_At',
    'Updated_At',
    'SKU_ID',
    'Status',
    'Guardrail_Status',
    'Profit_Per_Job',
    'Margin_Pct',
    'Economics',
    'AI_Analysis',
    'Performance_Data',
    // minimal Message_Context fields used by the frontend list renderer
    'ctx_offerName:Message_Context->>offerName',
    'ctx_offer_name:Message_Context->>offer_name',
    'ctx_name:Message_Context->>name',
    'ctx_title:Message_Context->>title',
    'ctx_offer_builder:Message_Context->offer_builder',
    'ctx_offerBuilder:Message_Context->offerBuilder',
  ].join(',');

  const { primary, fallback } = getOffersDbFallback();

  const buildOffersQuery = (db: any) => {
    let q = db
      .from('Offers')
      .select(slim ? slimSelect : '*')
      .order('Updated_At', { ascending: false })
      .limit(limit);
    if (offersVaName) q = q.eq('Created_By', offersVaName);
    return q;
  };

  let { data: offers, error: offersError } = await buildOffersQuery(primary);
  if (offersError && isOffersSchemaMismatchError(offersError)) {
    ({ data: offers, error: offersError } = await buildOffersQuery(fallback));
  }

  if (offersError) {
    return NextResponse.json(
      { ok: false, error: `Failed to load offers: ${offersError.message}` },
      { status: 500, headers: corsHeaders(request) }
    );
  }

  const normalizedOffers = (offers || []).map((row: any) => {
    if (!slim) return row;
    const {
      ctx_offerName,
      ctx_offer_name,
      ctx_name,
      ctx_title,
      ctx_offer_builder,
      ctx_offerBuilder,
      ...rest
    } = row || {};

    const Message_Context: any = {};
    if (ctx_offerName != null) Message_Context.offerName = ctx_offerName;
    if (ctx_offer_name != null) Message_Context.offer_name = ctx_offer_name;
    if (ctx_name != null) Message_Context.name = ctx_name;
    if (ctx_title != null) Message_Context.title = ctx_title;
    if (ctx_offer_builder != null) Message_Context.offer_builder = ctx_offer_builder;
    if (ctx_offerBuilder != null) Message_Context.offerBuilder = ctx_offerBuilder;

    return { ...rest, Message_Context };
  });

  const offerIds: string[] = Array.from(
    new Set<string>(
      (normalizedOffers || [])
        .map((o: any) => safeTrim(o?.Offer_ID || o?.offer_id))
        .filter(Boolean)
    )
  );

  // Name index used for legacy briefs that were created without Offer_ID linkage
  // (e.g., only the Title "Offer Brief: <offer name>" is present).
  const nameToOfferIds = new Map<string, Set<string>>();
  const addOfferNameIndex = (name: any, offerId: string) => {
    const key = safeLower(name);
    if (!key || !offerId) return;
    let set = nameToOfferIds.get(key);
    if (!set) {
      set = new Set<string>();
      nameToOfferIds.set(key, set);
    }
    set.add(offerId);
  };

  for (const o of normalizedOffers || []) {
    const offerId = safeTrim(o?.Offer_ID || o?.offer_id);
    if (!offerId) continue;

    let ctx: any = (o as any).Message_Context;
    ctx = parseMaybeJson(ctx) || ctx;
    if (!ctx || typeof ctx !== 'object') ctx = {};

    addOfferNameIndex(ctx.offerName, offerId);
    addOfferNameIndex(ctx.offer_name, offerId);
    addOfferNameIndex(ctx.name, offerId);
    addOfferNameIndex(ctx.title, offerId);

    const ob = parseMaybeJson((ctx as any).offer_builder || (ctx as any).offerBuilder);
    if (ob && typeof ob === 'object') {
      addOfferNameIndex((ob as any).name, offerId);
    }
  }

  // Compute briefExists:
  // - Preferred: Deliverables linked by Offer_ID and typed as offer_brief (Deliverable_Type or metadata.type)
  // - Legacy: title starts with "Offer Brief:" and may not have Offer_ID filled in; match by offer name.
  let briefOfferIds = new Set<string>();
  const offerIdSet = new Set<string>(offerIds);

  const ingestBriefs = (rows: any[]) => {
    for (const d of Array.isArray(rows) ? rows : []) {
      const title = safeTrim(d?.Title);
      const titleLower = title.toLowerCase();
      const mdType = extractMetadataType(d?.Metadata || d?.metadata);
      const deliverableType = safeLower(d?.Deliverable_Type || d?.deliverable_type || mdType);
      const looksLikeBrief = deliverableType === 'offer_brief' || titleLower.startsWith('offer brief:');
      if (!looksLikeBrief) continue;

      const linkedOfferId = safeTrim(d?.Offer_ID || d?.offer_id);
      if (linkedOfferId && offerIdSet.has(linkedOfferId)) {
        briefOfferIds.add(linkedOfferId);
        continue;
      }

      // Legacy: no Offer_ID linkage — map by name from title.
      if (titleLower.startsWith('offer brief:')) {
        const nameFromTitle = safeLower(title.slice('Offer Brief:'.length));
        const ids = nameToOfferIds.get(nameFromTitle);
        if (ids) ids.forEach((id) => briefOfferIds.add(id));
      }
    }
  };

  const tryLoadBriefsLinked = async (db: any) => {
    const { data, error } = await db
      .from('Deliverables')
      .select('Offer_ID,Deliverable_Type,Title,Metadata,Created_At')
      .in('Offer_ID', offerIds)
      .order('Created_At', { ascending: false })
      .limit(Math.min(offerIds.length * 3, 5000));

    if (error) return { ok: false as const, error };
    return { ok: true as const, rows: Array.isArray(data) ? data : [] };
  };

  const tryLoadBriefsByTitle = async (db: any) => {
    const { data, error } = await db
      .from('Deliverables')
      .select('Offer_ID,Deliverable_Type,Title,Metadata,Created_At')
      .ilike('Title', 'Offer Brief:%')
      .order('Created_At', { ascending: false })
      .limit(2000);

    if (error) return { ok: false as const, error };
    return { ok: true as const, rows: Array.isArray(data) ? data : [] };
  };

  if (offerIds.length) {
    // Try mgmt DB first (if present), then main DB.
    try {
      const a = await tryLoadBriefsLinked(primary);
      if (a.ok && a.rows.length) ingestBriefs(a.rows);
    } catch {
      // ignore
    }

    if (!briefOfferIds.size) {
      try {
        const b = await tryLoadBriefsLinked(fallback);
        if (b.ok && b.rows.length) ingestBriefs(b.rows);
      } catch {
        // ignore
      }
    }

    // Legacy safety net: if briefs exist but aren't linked by Offer_ID,
    // try matching by title prefix "Offer Brief: <offer name>".
    if (!briefOfferIds.size) {
      try {
        const c = await tryLoadBriefsByTitle(primary);
        if (c.ok && c.rows.length) ingestBriefs(c.rows);
      } catch {
        // ignore
      }
    }

    if (!briefOfferIds.size) {
      try {
        const d = await tryLoadBriefsByTitle(fallback);
        if (d.ok && d.rows.length) ingestBriefs(d.rows);
      } catch {
        // ignore
      }
    }
  }

  const offersWithBriefExists = (normalizedOffers || []).map((o: any) => {
    const id = safeTrim(o?.Offer_ID || o?.offer_id);
    return {
      ...o,
      briefExists: id ? briefOfferIds.has(id) : false,
    };
  });

  return NextResponse.json({ ok: true, offers: offersWithBriefExists }, { headers: corsHeaders(request) });
}

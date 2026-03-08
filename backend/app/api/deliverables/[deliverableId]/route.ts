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
    'Access-Control-Allow-Headers':
      'Content-Type, Authorization, x-h2s-admin-token, x-h2s-admin-key, x-correlation-id, x-request-id',
  };

  if (allowOrigin !== '*') {
    headers['Access-Control-Allow-Credentials'] = 'true';
  }

  return headers;
}

function safeTrim(v: any) {
  return String(v ?? '').trim();
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

function isSchemaMismatchError(err: any) {
  const msg = String(err?.message || '').toLowerCase();
  return msg.includes('column') && msg.includes('does not exist');
}

function isNotFoundError(err: any) {
  const code = String((err as any)?.code || '');
  const msg = String(err?.message || '').toLowerCase();
  // Supabase/PostgREST: PGRST116 is "Results contain 0 rows" when .single()
  return code === 'PGRST116' || msg.includes('0 rows') || msg.includes('no rows');
}

function getDeliverablesDbFallback() {
  let primary: any = null;
  try {
    primary = getSupabaseMgmt();
  } catch {
    // ignore
  }
  return { primary: primary || getSupabase(), fallback: getSupabase() };
}

async function loadDeliverable(deliverableId: string) {
  const { primary, fallback } = getDeliverablesDbFallback();

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

  const run = async (db: any, selectClause: string) => {
    return await db.from('Deliverables').select(selectClause).eq('Deliverable_ID', deliverableId).single();
  };

  let { data, error } = await run(primary, baseSelect);
  if (error && isSchemaMismatchError(error)) {
    ({ data, error } = await run(primary, '*'));
  }

  if (error) {
    // fallback DB (main)
    let { data: data2, error: error2 } = await run(fallback, baseSelect);
    if (error2 && isSchemaMismatchError(error2)) {
      ({ data: data2, error: error2 } = await run(fallback, '*'));
    }
    data = data2;
    error = error2;
  }

  return { deliverable: data, error };
}

function normalizeDeliverableRow(row: any) {
  const deliverableId = safeTrim(row?.Deliverable_ID || row?.deliverable_id || row?.deliverableId);
  const offerId = safeTrim(row?.Offer_ID || row?.offer_id || row?.offerId);
  const type = safeTrim(row?.Deliverable_Type || row?.deliverable_type || row?.type).toLowerCase();
  const status = safeTrim(row?.Status || row?.status);
  const title = safeTrim(row?.Title || row?.title);
  const fileLink = safeTrim(row?.File_Link || row?.file_link || row?.fileLink);
  const metadata = safeJsonParse(row?.Metadata) || row?.Metadata || safeJsonParse(row?.metadata) || row?.metadata || {};
  const aiAnalysis = safeJsonParse(row?.AI_Analysis) || row?.AI_Analysis || safeJsonParse(row?.ai_analysis) || row?.ai_analysis || null;
  const description = safeTrim(row?.Description || row?.description);

  const bodyFromMetadata = (() => {
    try {
      const md: any = metadata && typeof metadata === 'object' ? metadata : null;
      const d = safeTrim(md?.description || md?.body || md?.text || '');
      return d || '';
    } catch {
      return '';
    }
  })();

  const body = description || bodyFromMetadata || '';

  const createdAt = row?.Created_At || row?.created_at || row?.createdAt || null;
  const updatedAt = row?.Updated_At || row?.updated_at || row?.updatedAt || null;

  return {
    deliverableId,
    offerId: offerId || null,
    type: type || null,
    status: status || null,
    title: title || null,
    body,
    fileLink: fileLink || null,
    metadata: metadata && typeof metadata === 'object' ? metadata : {},
    aiAnalysis,
    createdAt,
    updatedAt,
  };
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request) });
}

export async function GET(request: NextRequest, ctx: { params: Promise<{ deliverableId: string }> }) {
  const requestId =
    request.headers.get('x-correlation-id') ||
    request.headers.get('x-request-id') ||
    `del_${Date.now()}_${Math.random().toString(16).slice(2)}`;

  try {
    const { deliverableId } = await ctx.params;
    const id = safeTrim(deliverableId);
    if (!id) {
      return NextResponse.json(
        { ok: false, requestId, error: 'Missing deliverableId' },
        { status: 400, headers: { ...corsHeaders(request), 'x-correlation-id': requestId } }
      );
    }

    const { deliverable, error } = await loadDeliverable(id);
    if (error) {
      const status = isNotFoundError(error) ? 404 : 500;
      const msg = isNotFoundError(error) ? 'Deliverable not found' : `Failed to load deliverable: ${error.message}`;
      return NextResponse.json(
        { ok: false, requestId, error: msg },
        { status, headers: { ...corsHeaders(request), 'x-correlation-id': requestId } }
      );
    }

    const normalized = normalizeDeliverableRow(deliverable);
    return NextResponse.json(
      { ok: true, requestId, deliverable: normalized },
      { headers: { ...corsHeaders(request), 'x-correlation-id': requestId } }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, requestId, error: e?.message || 'Unknown error' },
      { status: 500, headers: { ...corsHeaders(request), 'x-correlation-id': requestId } }
    );
  }
}

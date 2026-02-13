import { NextRequest, NextResponse } from 'next/server';
import { assertAdminIfConfigured } from '@/app/api/_lib/admin';
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
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-h2s-admin-token, x-h2s-admin-key, x-correlation-id, x-request-id',
  };

  if (allowOrigin !== '*') {
    headers['Access-Control-Allow-Credentials'] = 'true';
  }

  return headers;
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

function getDeliverablesDb() {
  try {
    const mgmt = getSupabaseMgmt();
    if (mgmt) return mgmt;
  } catch {
    // ignore
  }
  return getSupabase();
}

export async function OPTIONS(request: NextRequest) {
  return NextResponse.json({}, { headers: corsHeaders(request) });
}

export async function POST(request: NextRequest, ctx: { params: Promise<{ offerId: string }> }) {
  try {
    assertAdminIfConfigured(request);

    const { offerId } = await ctx.params;
    const body = await request.json();

    const deliverableId = String(body?.deliverableId || body?.Deliverable_ID || '').trim();
    const deliverableType = body?.deliverableType ? String(body.deliverableType).trim() : null;

    if (!deliverableId) {
      return NextResponse.json(
        { ok: false, error: 'deliverableId is required' },
        { status: 400, headers: corsHeaders(request) }
      );
    }

    const db = getDeliverablesDb();

    // Preferred: first-class columns.
    const updatePayload: any = { Offer_ID: offerId };
    if (deliverableType) updatePayload.Deliverable_Type = deliverableType;

    let { data, error } = await db
      .from('Deliverables')
      .update(updatePayload)
      .eq('Deliverable_ID', deliverableId)
      .select('*')
      .single();

    if (error && isSchemaMismatchError(error)) {
      // Back-compat: update Metadata JSON.
      const { data: row, error: loadError } = await db
        .from('Deliverables')
        .select('Deliverable_ID,Metadata')
        .eq('Deliverable_ID', deliverableId)
        .single();

      if (loadError) {
        return NextResponse.json(
          { ok: false, error: `Failed to load deliverable: ${loadError.message}` },
          { status: 500, headers: corsHeaders(request) }
        );
      }

      const metadata = safeJsonParse(row?.Metadata) || row?.Metadata || {};
      const nextMetadata: any = { ...(metadata || {}) };
      nextMetadata.offerId = offerId;
      if (deliverableType) nextMetadata.type = deliverableType;

      const res = await db
        .from('Deliverables')
        .update({ Metadata: nextMetadata })
        .eq('Deliverable_ID', deliverableId)
        .select('*')
        .single();

      data = res.data;
      error = res.error;
    }

    if (error) {
      return NextResponse.json(
        { ok: false, error: `Failed to relink deliverable: ${error.message}` },
        { status: 500, headers: corsHeaders(request) }
      );
    }

    return NextResponse.json({ ok: true, deliverable: data }, { headers: corsHeaders(request) });
  } catch (e: any) {
    const status = Number(e?.statusCode || 500);
    return NextResponse.json(
      { ok: false, error: e?.message || 'Unknown error' },
      { status, headers: corsHeaders(request) }
    );
  }
}

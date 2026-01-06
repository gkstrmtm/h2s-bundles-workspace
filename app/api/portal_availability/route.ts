import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
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
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  if (allowOrigin !== '*') {
    headers['Access-Control-Allow-Credentials'] = 'true';
  }

  return headers;
}

export async function OPTIONS(request: Request) {
  return NextResponse.json({}, { headers: corsHeaders(request) });
}

function pickToken(req: Request, body?: any): string {
  const auth = req.headers.get('authorization') || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  const bearer = m?.[1] ? String(m[1]).trim() : '';
  const fromBody = body?.token ? String(body.token).trim() : '';
  const fromQuery = new URL(req.url).searchParams.get('token') || '';
  return bearer || fromBody || fromQuery;
}

function pickAction(req: Request, body?: any): string {
  const fromBody = body?.action ? String(body.action).trim() : '';
  const fromQuery = new URL(req.url).searchParams.get('action') || '';
  return (fromBody || fromQuery || 'get').toLowerCase();
}

function jsonError(request: Request, status: number, error: string, error_code: string) {
  return NextResponse.json({ ok: false, error, error_code }, { status, headers: corsHeaders(request) });
}

const TABLE = 'h2s_dispatch_pros_availability';

async function handle(request: Request) {
  const body = await request.json().catch(() => ({}));
  const token = pickToken(request, body);
  const action = pickAction(request, body);

  if (!token) {
    return jsonError(request, 401, 'Invalid/expired session', 'bad_session');
  }

  const payload = verifyPortalToken(token);
  const proId = payload?.sub ? String(payload.sub) : '';
  if (!proId) {
    return jsonError(request, 401, 'Invalid/expired session', 'bad_session');
  }

  const supabase = getSupabase();

  if (action === 'get') {
    const { data, error } = await supabase
      .from(TABLE)
      .select('*')
      .eq('pro_id', proId)
      .order('date_local', { ascending: true });

    if (error) {
      return jsonError(request, 500, 'Failed to load availability', 'query_error');
    }

    return NextResponse.json({ ok: true, rows: data || [] }, { headers: corsHeaders(request) });
  }

  if (action === 'set') {
    const type = String(body?.type || 'vacation');
    const date_local = body?.date_local ? String(body.date_local).trim() : '';
    const reason = body?.reason ? String(body.reason).trim() : '';

    if (!date_local) {
      return jsonError(request, 400, 'Missing date_local', 'missing_date');
    }

    const { data: existing } = await supabase
      .from(TABLE)
      .select('avail_id')
      .eq('pro_id', proId)
      .eq('date_local', date_local)
      .maybeSingle();

    if (existing?.avail_id) {
      return NextResponse.json(
        { ok: true, message: 'Date already blocked', avail_id: existing.avail_id },
        { headers: corsHeaders(request) }
      );
    }

    const { data, error } = await supabase
      .from(TABLE)
      .insert({
        pro_id: proId,
        type,
        date_local,
        reason,
        created_at: new Date().toISOString(),
      })
      .select('*')
      .single();

    if (error) {
      return jsonError(request, 500, 'Failed to save availability: ' + error.message, 'insert_error');
    }

    return NextResponse.json({ ok: true, availability: data }, { headers: corsHeaders(request) });
  }

  if (action === 'delete') {
    const availabilityId = (body?.avail_id || body?.availability_id || '').toString().trim();

    if (!availabilityId) {
      return jsonError(request, 400, 'Missing availability_id', 'missing_id');
    }

    const { data: existingRecord, error: checkError } = await supabase
      .from(TABLE)
      .select('avail_id, pro_id, type, date_local')
      .eq('avail_id', availabilityId)
      .eq('pro_id', proId)
      .maybeSingle();

    if (checkError) {
      return jsonError(request, 500, 'Failed to verify record: ' + checkError.message, 'check_error');
    }

    if (!existingRecord) {
      return jsonError(request, 404, 'Record not found or access denied', 'not_found');
    }

    const { error, data: deleteResult } = await supabase
      .from(TABLE)
      .delete()
      .eq('avail_id', availabilityId)
      .eq('pro_id', proId)
      .select('*');

    if (error) {
      return jsonError(request, 500, 'Failed to delete availability: ' + error.message, 'delete_error');
    }

    const deletedRowId = deleteResult?.[0]?.avail_id || availabilityId;

    return NextResponse.json({ ok: true, deleted_id: deletedRowId }, { headers: corsHeaders(request) });
  }

  return jsonError(request, 400, 'Invalid action. Use: get, set, or delete', 'invalid_action');
}

export async function POST(request: Request) {
  try {
    return await handle(request);
  } catch (error: any) {
    return jsonError(request, 500, 'Server error: ' + (error?.message || 'Internal error'), 'server_error');
  }
}

export async function GET(request: Request) {
  // Compatibility: accept query params.
  const url = new URL(request.url);
  const payload = Object.fromEntries(url.searchParams.entries());
  return POST(
    new Request(request.url, {
      method: 'POST',
      headers: request.headers,
      body: JSON.stringify(payload),
    })
  );
}

export async function DELETE(request: Request) {
  // Allow DELETE requests too; treat as action=delete.
  const url = new URL(request.url);
  const payload = Object.fromEntries(url.searchParams.entries());
  return POST(
    new Request(request.url, {
      method: 'POST',
      headers: request.headers,
      body: JSON.stringify({ ...payload, action: 'delete' }),
    })
  );
}

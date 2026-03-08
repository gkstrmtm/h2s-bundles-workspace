import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { jwtVerify } from 'jose';

const HUB_COOKIE_NAME = 'h2s_hub_session';

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-h2s-hub-key',
  };
}

function safeTrim(value: any): string {
  return String(value || '').trim();
}

function normalizeUrl(raw: string): string {
  const u = safeTrim(raw);
  if (!u) return '';
  if (u.startsWith('/')) return u;
  try {
    const parsed = new URL(u);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return u;
  } catch {
    return '';
  }
}

function requireWriteKey(request: NextRequest): { ok: true } | { ok: false; status: number; error: string; error_code: string } {
  const expected = safeTrim(process.env.HUB_LINKS_WRITE_KEY);
  if (!expected) {
    return { ok: false, status: 503, error: 'Write key not configured', error_code: 'write_key_not_configured' };
  }

  const got = safeTrim(request.headers.get('x-h2s-hub-key'));
  if (!got || got !== expected) {
    return { ok: false, status: 403, error: 'Forbidden', error_code: 'forbidden' };
  }

  return { ok: true };
}

function getJwtSecret(): Uint8Array | null {
  const raw = safeTrim(process.env.HUB_GATE_JWT_SECRET);
  if (!raw) return null;
  return new TextEncoder().encode(raw);
}

function isGateEnabled(): boolean {
  // Gate is considered enabled when a PIN is configured.
  // (Secret must also be present for verification.)
  const pin = safeTrim(process.env.HUB_GATE_PIN || process.env.HUB_GATE_KEY || '');
  return !!pin;
}

async function requireHubSession(request: NextRequest): Promise<{ ok: true } | { ok: false; status: number; error: string; error_code: string }> {
  if (!isGateEnabled()) return { ok: true };

  const secret = getJwtSecret();
  if (!secret) {
    return { ok: false, status: 503, error: 'Hub gate not configured', error_code: 'not_configured' };
  }

  const token = safeTrim(request.cookies.get(HUB_COOKIE_NAME)?.value);
  if (!token) {
    return { ok: false, status: 401, error: 'Unauthorized', error_code: 'unauthorized' };
  }

  try {
    await jwtVerify(token, secret, { algorithms: ['HS256'] });
    return { ok: true };
  } catch {
    return { ok: false, status: 401, error: 'Unauthorized', error_code: 'unauthorized' };
  }
}

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders() });
}

export async function GET(request: NextRequest) {
  try {
    const gate = await requireHubSession(request);
    if (!gate.ok) {
      return NextResponse.json({ ok: false, error: gate.error, error_code: gate.error_code }, { status: gate.status, headers: corsHeaders() });
    }

    const db = getSupabase();

    const { data, error } = await db
      .from('h2s_hub_links')
      .select('id,title,url,description,sort_order,created_at,updated_at,is_active')
      .eq('is_active', true)
      .order('sort_order', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) {
      return NextResponse.json({ ok: false, error: error.message, error_code: 'query_error' }, { status: 500, headers: corsHeaders() });
    }

    return NextResponse.json({ ok: true, links: data || [] }, { headers: corsHeaders() });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'Internal error', error_code: 'internal_error' }, { status: 500, headers: corsHeaders() });
  }
}

export async function POST(request: NextRequest) {
  try {
    const gate = await requireHubSession(request);
    if (!gate.ok) {
      return NextResponse.json({ ok: false, error: gate.error, error_code: gate.error_code }, { status: gate.status, headers: corsHeaders() });
    }

    const auth = requireWriteKey(request);
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error, error_code: auth.error_code }, { status: auth.status, headers: corsHeaders() });
    }

    const body = await request.json().catch(() => ({}));
    const title = safeTrim(body?.title).slice(0, 60);
    const url = normalizeUrl(body?.url);
    const description = safeTrim(body?.description).slice(0, 160) || null;

    const sortOrderRaw = body?.sort_order;
    const sortOrder = Number.isFinite(Number(sortOrderRaw)) ? Math.max(-999999, Math.min(999999, Math.trunc(Number(sortOrderRaw)))) : 0;

    if (!title) {
      return NextResponse.json({ ok: false, error: 'Missing title', error_code: 'bad_request' }, { status: 400, headers: corsHeaders() });
    }
    if (!url) {
      return NextResponse.json({ ok: false, error: 'Invalid url', error_code: 'bad_request' }, { status: 400, headers: corsHeaders() });
    }

    const db = getSupabase();

    const { data, error } = await db
      .from('h2s_hub_links')
      .insert([
        {
          title,
          url,
          description,
          sort_order: sortOrder,
          is_active: true,
        },
      ])
      .select('id,title,url,description,sort_order,created_at,updated_at,is_active')
      .single();

    if (error) {
      const msg = String(error.message || 'Insert failed');
      const code = msg.toLowerCase().includes('duplicate') || msg.toLowerCase().includes('unique') ? 'duplicate' : 'insert_error';
      return NextResponse.json({ ok: false, error: msg, error_code: code }, { status: code === 'duplicate' ? 409 : 500, headers: corsHeaders() });
    }

    return NextResponse.json({ ok: true, link: data }, { headers: corsHeaders() });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'Internal error', error_code: 'internal_error' }, { status: 500, headers: corsHeaders() });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const gate = await requireHubSession(request);
    if (!gate.ok) {
      return NextResponse.json({ ok: false, error: gate.error, error_code: gate.error_code }, { status: gate.status, headers: corsHeaders() });
    }

    const auth = requireWriteKey(request);
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error, error_code: auth.error_code }, { status: auth.status, headers: corsHeaders() });
    }

    const url = new URL(request.url);
    const id = safeTrim(url.searchParams.get('id'));

    if (!id) {
      return NextResponse.json({ ok: false, error: 'Missing id', error_code: 'bad_request' }, { status: 400, headers: corsHeaders() });
    }

    const db = getSupabase();
    const { error } = await db.from('h2s_hub_links').delete().eq('id', id);

    if (error) {
      return NextResponse.json({ ok: false, error: error.message, error_code: 'delete_error' }, { status: 500, headers: corsHeaders() });
    }

    return NextResponse.json({ ok: true }, { headers: corsHeaders() });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'Internal error', error_code: 'internal_error' }, { status: 500, headers: corsHeaders() });
  }
}

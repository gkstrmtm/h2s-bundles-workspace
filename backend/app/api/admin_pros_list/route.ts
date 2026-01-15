import { NextResponse } from 'next/server';
import { getSupabase, getSupabaseDispatch } from '@/lib/supabase';
import { corsHeaders, requireAdmin } from '@/lib/adminAuth';

// ═══════════════════════════════════════════════════════════════════════════
// 🛡️ GUARDRAIL: Pros Table Priority
// ═══════════════════════════════════════════════════════════════════════════
// The h2s_pros table is the CANONICAL source for all technician data.
// It contains 39+ records with complete info (vehicle, address, is_active, etc.)
//
// h2s_dispatch_pros is LEGACY/OUTDATED with only 1 generic record.
// Always check h2s_pros FIRST to get the real technician roster.
//
// Table priority order: h2s_pros > h2s_dispatch_pros > h2s Pros (legacy)
// ═══════════════════════════════════════════════════════════════════════════

async function tryLoadPros(sb: any, table: string): Promise<any[] | null> {
  try {
    const { data, error } = await sb.from(table).select('*').limit(2000);
    if (error || !Array.isArray(data)) return null;
    return data;
  } catch {
    return null;
  }
}

type ProSourceMeta = { db: 'dispatch' | 'main'; table: string } | null;

async function loadProsWithFallback(dispatchSb: any, mainSb: any | null): Promise<{ rows: any[]; source: ProSourceMeta }> {
  // PRIORITY: h2s_pros is the main table with all technician data
  // h2s_dispatch_pros only has 1 generic record and is outdated
  const tableCandidates = ['h2s_pros', 'h2s_dispatch_pros', 'h2s Pros'];

  for (const table of tableCandidates) {
    const rows = await tryLoadPros(dispatchSb, table);
    if (rows && rows.length > 0) return { rows, source: { db: 'dispatch', table } };
  }

  if (mainSb) {
    for (const table of tableCandidates) {
      const rows = await tryLoadPros(mainSb, table);
      if (rows && rows.length > 0) return { rows, source: { db: 'main', table } };
    }
  }

  // If the tables exist but are empty, preserve that signal by returning [] and a best-guess source.
  // Prefer dispatch/h2s_pros since that’s the expected canonical table name.
  return { rows: [], source: { db: 'dispatch', table: 'h2s_pros' } };
}

function normalizeProRow(p: any) {
  const pro_id = String(p?.pro_id || p?.tech_id || p?.id || '').trim();
  const name = p?.name || p?.pro_name || p?.full_name || p?.display_name || null;
  const status = p?.status || p?.state || null;
  const email = p?.email || p?.pro_email || p?.tech_email || null;
  const phone = p?.phone || p?.pro_phone || p?.mobile || null;
  
  // Normalize vehicle info fields
  const vehicle_make_model = p?.vehicle_text || p?.vehicle_make_model || null;
  const vehicle_year = p?.vehicle_year || null;
  const vehicle_license_plate = p?.vehicle_license_plate || null;
  const vehicle_color = p?.vehicle_color || null;
  
  // Normalize address fields - prioritize home_* fields
  const address = p?.home_address || p?.address || null;
  const city = p?.home_city || p?.city || null;
  const state = p?.home_state || p?.state || null;
  const zip = p?.home_zip || p?.zip || null;
  
  // Normalize company info
  const company_name = p?.company_name || p?.company || null;

  return {
    ...p,
    pro_id,
    name,
    pro_name: name,
    status,
    email,
    phone,
    vehicle_make_model,
    vehicle_year,
    vehicle_license_plate,
    vehicle_color,
    home_address: address,
    home_city: city,
    home_state: state,
    home_zip: zip,
    city,
    state,
    zip,
    company_name,
  };
}

async function handle(request: Request, body: any) {
  const dispatchClient = getSupabaseDispatch();
  if (!dispatchClient) {
    return NextResponse.json(
      { ok: false, error: 'Dispatch database not configured', error_code: 'dispatch_db_not_configured' },
      { status: 503, headers: corsHeaders(request) }
    );
  }

  const auth = await requireAdmin({ request, body, supabaseClient: dispatchClient as any });
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error, error_code: auth.error_code }, { status: auth.status, headers: corsHeaders(request) });
  }

  const sb: any = dispatchClient as any;

  let main: any | null = null;
  try {
    main = getSupabase() as any;
  } catch {
    main = null;
  }

  const { rows, source } = await loadProsWithFallback(sb, main);
  const pros = rows
    .map(normalizeProRow)
    .filter((p) => p.pro_id)
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));

  return NextResponse.json({ ok: true, pros, count: pros.length, meta: { source } }, { headers: corsHeaders(request) });
}

export async function OPTIONS(request: Request) {
  return NextResponse.json({}, { headers: corsHeaders(request) });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    return await handle(request, body);
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'Internal error' }, { status: 500, headers: corsHeaders(request) });
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const payload = Object.fromEntries(url.searchParams.entries());
  return POST(new Request(request.url, { method: 'POST', headers: request.headers, body: JSON.stringify(payload) }));
}

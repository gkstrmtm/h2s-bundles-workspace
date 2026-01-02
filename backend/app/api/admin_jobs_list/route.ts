import { NextResponse } from 'next/server';
import { getSupabase, getSupabaseDispatch } from '@/lib/supabase';
import { corsHeaders, requireAdmin } from '@/lib/adminAuth';
import { resolveDispatchSchema } from '@/lib/dispatchSchema';

function parseDays(raw: any): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 30;
  return Math.min(365, Math.max(1, Math.floor(n)));
}

function normalizeStatus(raw: any): string {
  const s = String(raw || '').trim().toLowerCase();
  return s || 'all';
}

function pickAssignedProValue(job: any): string {
  const candidates = [
    job?.assigned_to,
    job?.assigned_pro_id,
    job?.pro_id,
    job?.tech_id,
    job?.technician_id,
    job?.assigned_email,
    job?.assigned_pro_email,
    job?.pro_email,
    job?.tech_email,
    job?.email,
  ];
  for (const v of candidates) {
    const s = String(v ?? '').trim();
    if (s) return s;
  }
  return '';
}

async function loadProsIndex(primary: any, secondary: any | null): Promise<Map<string, any>> {
  const index = new Map<string, any>();

  const tryLoad = async (sb: any, table: string) => {
    try {
      const { data, error } = await sb.from(table).select('*').limit(2000);
      if (error || !Array.isArray(data)) return false;
      for (const p of data) {
        const proId = String(p?.pro_id || p?.tech_id || p?.id || '').trim();
        const email = String(p?.email || p?.pro_email || p?.tech_email || '').trim().toLowerCase();
        if (proId) index.set(proId, p);
        if (email) index.set(email, p);
      }
      return true;
    } catch {
      return false;
    }
  };

  const tableCandidates = ['h2s_dispatch_pros', 'h2s_pros', 'h2s Pros'];

  // Prefer dispatch pros table; then global pros; then the legacy spaced name.
  for (const table of tableCandidates) {
    if (await tryLoad(primary, table)) return index;
  }

  // If that didn’t yield anything, try the secondary client (often the “main” DB)
  if (secondary) {
    for (const table of tableCandidates) {
      // Don't early return here; we want to keep any earlier index entries too.
      await tryLoad(secondary, table);
      if (index.size > 0) return index;
    }
  }
  return index;
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
  const schema = await resolveDispatchSchema(sb);
  const jobsTable = schema?.jobsTable || 'h2s_dispatch_jobs';
  const idCol = schema?.jobsIdCol || 'job_id';
  const statusCol = schema?.jobsStatusCol || 'status';

  const status = normalizeStatus(body?.status);
  const days = parseDays(body?.days);
  const sinceIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  let rows: any[] = [];

  // Try common query shapes; fall back if some columns don’t exist.
  try {
    let q = sb.from(jobsTable).select('*').order('created_at', { ascending: false }).limit(1000);

    // created_at might not exist in some schemas
    try {
      q = q.gte('created_at', sinceIso);
    } catch {
      // ignore
    }

    if (status && status !== 'all') {
      try {
        q = q.eq(statusCol as any, status);
      } catch {
        // ignore
      }
    }

    const { data, error } = await q;
    if (error) throw error;
    rows = Array.isArray(data) ? data : [];
  } catch {
    // Fallback: just pull latest rows
    try {
      const { data } = await sb.from(jobsTable).select('*').limit(500);
      rows = Array.isArray(data) ? data : [];
    } catch {
      rows = [];
    }
  }

  let main: any | null = null;
  try {
    main = getSupabase() as any;
  } catch {
    main = null;
  }

  const prosIndex = await loadProsIndex(sb, main);

  const jobs = rows.map((j: any) => {
    const jobId = j?.job_id ?? j?.[idCol] ?? j?.id;
    const assignedKey = pickAssignedProValue(j);
    const proRow = assignedKey ? (prosIndex.get(assignedKey) || prosIndex.get(String(assignedKey).toLowerCase())) : null;

    const assigned_pro_name =
      j?.assigned_pro_name ||
      j?.pro_name ||
      j?.technician_name ||
      j?.tech_name ||
      j?.metadata?.pro_name ||
      proRow?.name ||
      proRow?.pro_name ||
      null;

    const assigned_pro_phone =
      j?.assigned_pro_phone ||
      j?.pro_phone ||
      j?.technician_phone ||
      j?.tech_phone ||
      j?.metadata?.pro_phone ||
      proRow?.phone ||
      proRow?.pro_phone ||
      null;

    return {
      ...j,
      job_id: String(jobId || ''),
      assigned_pro_name,
      assigned_pro_phone,
    };
  });

  return NextResponse.json(
    {
      ok: true,
      jobs,
      meta: {
        jobs_table: jobsTable,
        jobs_id_col: idCol,
        jobs_status_col: schema?.jobsStatusCol || null,
        admin: auth.adminEmail,
      },
    },
    { headers: corsHeaders(request) }
  );
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

import { NextResponse } from 'next/server';
import { getSupabase, getSupabaseDispatch } from '@/lib/supabase';
import { corsHeaders, requireAdmin } from '@/lib/adminAuth';
import { resolveDispatchSchema } from '@/lib/dispatchSchema';
import { AdminJobDTO, AdminAddress, AdminCustomer, AdminServiceScope, AdminJobFinancials, AdminProAssignment } from '@/lib/dtos';

function safeParseJson(value: any): any {
  if (value == null) return null;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return null;
  const s = value.trim();
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    try {
      const inner = JSON.parse(s);
      if (typeof inner === 'string') return JSON.parse(inner);
      return inner;
    } catch {
      return null;
    }
  }
}

function parseDays(raw: any): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 30;
  return Math.min(365, Math.max(1, Math.floor(n)));
}

function normalizeStatus(raw: any): string {
  const s = String(raw || '').trim().toLowerCase();
  return s || 'all';
}

function normalizePayoutStatus(row: any): 'pending' | 'approved' | 'paid' | 'rejected' | 'none' {
  if (!row) return 'none';
  const s = String(row.status || row.payout_status || '').toLowerCase();
  if (s.includes('paid')) return 'paid';
  if (s.includes('approv')) return 'approved';
  if (s.includes('reject') || s.includes('declin')) return 'rejected';
  return 'pending';
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
  for (const table of tableCandidates) {
    if (await tryLoad(primary, table)) return index;
  }
  if (secondary) {
    for (const table of tableCandidates) {
      await tryLoad(secondary, table);
      if (index.size > 0) return index;
    }
  }
  return index;
}

const PAYOUT_TABLE_CANDIDATES = [
  'h2s_payouts_ledger',
  'h2s_dispatch_payouts_ledger',
  'h2s_dispatch_payouts',
  'dispatch_payouts',
  'h2s_payouts',
  'payouts',
];

async function loadPayoutsForJobs(dispatchClient: any, jobIds: string[]): Promise<Map<string, any>> {
  const map = new Map();
  if (!jobIds.length) return map;

  for (const table of PAYOUT_TABLE_CANDIDATES) {
    try {
      const { data } = await dispatchClient
        .from(table)
        .select('*')
        .in('job_id', jobIds); // Efficient backend filtering
      
      if (data && data.length > 0) {
        data.forEach((p: any) => {
          map.set(String(p.job_id), p);
        });
        return map; // Found the active table
      }
    } catch {}
  }
  return map;
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
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status, headers: corsHeaders(request) });
  }

  const sb: any = dispatchClient as any;
  const schema = await resolveDispatchSchema(sb);
  const jobsTable = schema?.jobsTable || 'h2s_dispatch_jobs';
  const idCol = schema?.jobsIdCol || 'job_id';
  const statusCol = schema?.jobsStatusCol || 'status';

  const status = normalizeStatus(body?.status);
  const days = parseDays(body?.days);
  const specificJobIds = Array.isArray(body?.specific_job_ids) ? body.specific_job_ids.map(String) : (body?.specific_job_id ? [String(body.specific_job_id)] : []);
  const sinceIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  let rows: any[] = [];

  // 1. Fetch Jobs
  try {
    let q = sb.from(jobsTable).select('*').order('created_at', { ascending: false });

    if (specificJobIds.length > 0) {
      // Direct lookup bypasses date and status filters
      q = q.in(idCol, specificJobIds).limit(specificJobIds.length);
    } else {
      q = q.limit(2000); // Increased from 500
      
      // Filter by date
      try { q = q.gte('created_at', sinceIso); } catch {}
      
      // Filter by status (unless 'all')
      if (status && status !== 'all') {
        try { q = q.eq(statusCol as any, status); } catch {}
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

  // 2. Prepare for Enrichment
  const jobIds = rows.map((j: any) => String(j.job_id || j[idCol] || j.id || '')).filter(Boolean);
  
  // 3. Parallel Fetching (Pros, Orders, Payouts)
  let mainClient: any | null = null;
  try { mainClient = getSupabase(); } catch {}

  const [prosIndex, ordersData, payoutsMap] = await Promise.all([
    loadProsIndex(sb, mainClient),
    
    // Link to Orders (Main DB) - FETCH ALL MATCHING ORDERS
    (async () => {
      const res = { map: new Map(), list: [] as any[] };
      if (!mainClient) return res;
      try {
        // Fetch extended history to maximize matches
        const { data: orders } = await mainClient.from('h2s_orders').select('*').order('created_at', { ascending: false }).limit(2000);
        if (orders) {
          res.list = orders;
          orders.forEach((o: any) => {
             const meta = safeParseJson(o.metadata_json) || safeParseJson(o.metadata) || {};
             const jid = meta.dispatch_job_id || meta.job_id;
             if (jid) res.map.set(String(jid), o);
             // Also index by order_id just in case
             if (o.id) res.map.set(String(o.id), o);
          });
        }
      } catch {}
      return res;
    })(),

    // Payouts
    loadPayoutsForJobs(sb, jobIds)
  ]);

  const linkMap = ordersData.map;
  
  // VIRTUAL JOIN: If an order exists but no job row, create a virtual job row
  const existingJobIds = new Set(rows.map((r: any) => String(r.job_id || r[idCol] || r.id || '')));
  
  const virtualJobs = ordersData.list.filter((o: any) => {
      const meta = safeParseJson(o.metadata_json) || safeParseJson(o.metadata) || {};
      const targetJobId = String(meta.dispatch_job_id || meta.job_id || o.id || '');
      return targetJobId && !existingJobIds.has(targetJobId);
  }).map((o: any) => {
      const meta = safeParseJson(o.metadata_json) || safeParseJson(o.metadata) || {};
      const jid = String(meta.dispatch_job_id || meta.job_id || o.id || '');
      
      // Ensure it's in the map for the DTO builder
      if (!linkMap.has(jid)) linkMap.set(jid, o);
      
      return {
          job_id: jid,
          // Map Order Status to Job Status
          status: o.status === 'paid' ? 'unassigned' : (o.status || 'pending'), 
          created_at: o.created_at,
          updated_at: o.updated_at,
          job_number: o.order_id, // Use Order ID as display
          customer_name: o.customer_name,
          customer_email: o.customer_email,
          customer_phone: o.customer_phone,
          is_virtual: true
      };
  });
  
  // Append virtual jobs to the list
  rows = [...rows, ...virtualJobs];

  // 4. Construct DTOs
  const jobs = rows.map((j: any) => {
    const rawId = j.job_id || j[idCol] || j.id;
    const jobId = String(rawId || '');
    
    // Virtual job handling: if 'pending' but virtually created, might act as 'unassigned'
    
    const assignedKey = pickAssignedProValue(j);
    const proRaw = assignedKey ? (prosIndex.get(assignedKey) || prosIndex.get(String(assignedKey).toLowerCase())) : null;
    
    const orderRaw = linkMap.get(jobId) || {};
    const orderMeta = safeParseJson(orderRaw.metadata_json) || safeParseJson(orderRaw.metadata) || {};
    const jobMeta = j.metadata || {}; // JSON column typically
    
    const payoutRaw = payoutsMap.get(jobId);

    // Merge Data Sources
    const customerName = j.customer_name || orderRaw.customer_name || orderMeta.customer_name || 'Guest Customer';
    const customerEmail = j.customer_email || orderRaw.customer_email || orderMeta.customer_email || '';
    const customerPhone = j.customer_phone || orderRaw.customer_phone || orderMeta.customer_phone || '';

    const items = j.line_items || orderRaw.items || orderMeta.items_json || [];
    const parsedItems = typeof items === 'string' ? (safeParseJson(items) || []) : (Array.isArray(items) ? items : []);

    const serviceTitle = j.service_name || orderRaw.service_name || orderMeta.service_name || "Service";
    
    // Financials
    const totalAmount = Number(j.service_amount ?? orderRaw.total ?? orderRaw.total_amount ?? orderMeta.total_amount ?? 0);
    const payoutEst = Number(j.payout_estimated ?? orderRaw.payout_estimated ?? orderMeta.payout_estimated ?? orderMeta.estimated_payout ?? 0);
    const payoutRowAmount = Number(payoutRaw?.amount ?? payoutRaw?.total_amount ?? 0);
    
    // DTO Construction
    const dto: AdminJobDTO = {
      job_id: jobId,
      display_id: j.job_number || jobId.slice(0, 8).toUpperCase(),
      status: String(j[statusCol] || j.status || 'pending').toLowerCase(),
      created_at: j.created_at || new Date().toISOString(),
      updated_at: j.updated_at || new Date().toISOString(),
      
      customer: {
        name: customerName,
        email: customerEmail,
        phone: customerPhone,
        id: orderRaw?.user_id
      },
      
      address: {
        street: j.service_address || orderRaw.address || orderMeta.service_address || '',
        city: j.service_city || orderRaw.city || orderMeta.service_city || '',
        state: j.service_state || orderRaw.state || orderMeta.service_state || '',
        zip: j.service_zip || orderRaw.zip || orderMeta.service_zip || '',
        formatted: j.service_address || orderRaw.address
      },
      
      scope: {
        items: parsedItems,
        item_count: parsedItems.length,
        special_instructions: j.description || orderRaw.special_instructions || orderMeta.description || '',
      },
      
      financials: {
        total_price: totalAmount,
        payout_estimated: payoutEst,
        payout_actual: payoutRowAmount || undefined,
        payout_id: payoutRaw?.payout_id || payoutRaw?.entry_id,
        payout_status: normalizePayoutStatus(payoutRaw),
        bonuses: 0,
        tip: 0
      },
      
      assignment: {
        pro_id: proRaw?.pro_id || proRaw?.id,
        name: proRaw?.name || proRaw?.pro_name || j.assigned_pro_name || 'Unassigned',
        email: proRaw?.email || proRaw?.pro_email || j.assigned_pro_email,
        phone: proRaw?.phone || proRaw?.pro_phone || j.assigned_pro_phone,
        status: proRaw ? 'accepted' : 'unassigned' // Simplified for now
      },
      
      schedule: {
        duration_minutes: 120, // Default
        confirmed: !!j.scheduled_start,
        scheduled_start: j.scheduled_start,
        scheduled_end: j.scheduled_end
      },
      
      flags: {
        pain_flags: Array.isArray(j.pain_flags) ? j.pain_flags : (jobMeta.pain_flags || []),
        actions_required: []
      },
      
      metadata: { ...jobMeta, ...orderMeta }
    };
    
    // BACKWARD COMPATIBILITY: Merge DTO fields to top level
    return {
      ...j, // Original fields
      ...dto.address, // service_address, etc.
      customer_name: dto.customer.name,
      customer_email: dto.customer.email,
      customer_phone: dto.customer.phone,
      service_name: serviceTitle,
      service_amount: dto.financials.total_price,
      payout_estimated: dto.financials.payout_estimated,
      assigned_pro_name: dto.assignment.name,
      assigned_pro_phone: dto.assignment.phone,
      assigned_pro_email: dto.assignment.email,
      
      // Inject DTO for modern clients
      dto
    };
  });

  return NextResponse.json(
    {
      ok: true,
      jobs,
      meta: {
        jobs_table: jobsTable,
        count: jobs.length,
        admin: auth.adminEmail,
      },
    },
    { headers: corsHeaders(request) }
  );
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

export async function OPTIONS(request: Request) {
  return NextResponse.json({}, { headers: corsHeaders(request) });
}

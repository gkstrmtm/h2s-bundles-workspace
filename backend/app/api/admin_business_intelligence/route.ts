import { NextResponse } from 'next/server';
import { getSupabase, getSupabaseDispatch } from '@/lib/supabase';
import { corsHeaders, requireAdmin } from '@/lib/adminAuth';
import { resolveDispatchSchema } from '@/lib/dispatchSchema';

const PAYOUT_TABLE_CANDIDATES = [
  'h2s_payouts_ledger',
  'h2s_dispatch_payouts_ledger',
  'h2s_dispatch_payouts',
  'dispatch_payouts',
  'h2s_payouts',
  'payouts',
];

function safePct(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function numOrZero(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function parseMaybeJson(v: any): any {
  if (!v) return null;
  if (typeof v === 'object') return v;
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function extractItems(job: any): any[] {
  const meta = job?.metadata && typeof job.metadata === 'object' ? job.metadata : parseMaybeJson(job?.metadata);
  const fromMeta = meta?.items_json || meta?.items || null;
  const fromJob = job?.items_json || job?.line_items_json || job?.line_items || null;

  const items = Array.isArray(fromMeta) ? fromMeta : Array.isArray(fromJob) ? fromJob : parseMaybeJson(fromMeta) || parseMaybeJson(fromJob);
  return Array.isArray(items) ? items : [];
}

function computeRevenueFromItems(items: any[]): number {
  let subtotal = 0;
  for (const it of items || []) {
    if (!it || it.type === 'product') continue; // ignore product hardware line-items
    const line =
      numOrZero(it.line_total) ||
      numOrZero(it.lineTotal) ||
      numOrZero(it.line_customer_total) ||
      numOrZero(it.lineCustomerTotal) ||
      0;
    if (line > 0) {
      subtotal += line;
      continue;
    }
    const qty = numOrZero(it.qty) || 1;
    const unit = numOrZero(it.unit_price) || numOrZero(it.unitPrice) || 0;
    if (unit > 0) subtotal += qty * unit;
  }
  return subtotal;
}

function computeJobRevenue(job: any): number {
  const meta = job?.metadata && typeof job.metadata === 'object' ? job.metadata : parseMaybeJson(job?.metadata) || {};

  // Prefer explicit order totals if present
  const direct =
    numOrZero(job?.subtotal) ||
    numOrZero(job?.order_subtotal) ||
    numOrZero(job?.orderSubtotal) ||
    numOrZero(job?.total) ||
    numOrZero(job?.order_total) ||
    numOrZero(job?.orderTotal) ||
    numOrZero(job?.total_amount) ||
    numOrZero(job?.totalAmount) ||
    numOrZero(job?.amount_paid) ||
    numOrZero(job?.amountPaid) ||
    numOrZero(meta?.subtotal) ||
    numOrZero(meta?.order_subtotal) ||
    numOrZero(meta?.total) ||
    numOrZero(meta?.order_total) ||
    numOrZero(meta?.total_amount);

  if (direct > 0) return direct;

  const items = extractItems(job);
  const fromItems = computeRevenueFromItems(items);
  if (fromItems > 0) return fromItems;

  return 0;
}

function classifyPricingTier(job: any): 'byo' | 'h2s' {
  const items = extractItems(job);
  for (const it of items) {
    const meta = it?.metadata || {};
    const provider = String(meta?.mount_provider || meta?.mountProvider || '').toLowerCase();
    if (provider === 'customer') return 'byo';
    if (provider === 'h2s') return 'h2s';
  }
  // Default: treat as H2S (since dispatch jobs are mostly H2S fulfillment)
  return 'h2s';
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function extractOrderKey(job: any): string {
  return String(job?.order_id || job?.orderId || job?.metadata?.order_id || job?.metadata?.orderId || '').trim();
}

function computeOrderRevenue(order: any): number {
  const meta = parseMaybeJson(order?.metadata_json) || parseMaybeJson(order?.metadata) || {};
  const direct =
    numOrZero(order?.subtotal) ||
    numOrZero(order?.order_subtotal) ||
    numOrZero(order?.total) ||
    numOrZero(meta?.subtotal) ||
    numOrZero(meta?.order_subtotal) ||
    numOrZero(meta?.total);
  if (direct > 0) return direct;
  const items = Array.isArray(meta?.items_json) ? meta.items_json : parseMaybeJson(meta?.items_json);
  if (Array.isArray(items)) {
    const fromItems = computeRevenueFromItems(items);
    if (fromItems > 0) return fromItems;
  }
  return 0;
}

async function loadOrdersIndex(mainSb: any, keys: string[]): Promise<Map<string, any>> {
  const index = new Map<string, any>();
  const uniq = Array.from(new Set(keys.filter(Boolean)));
  if (!mainSb || uniq.length === 0) return index;

  const cols = 'id,order_id,session_id,subtotal,order_subtotal,total,metadata_json,metadata,created_at';
  const batches = chunk(uniq, 80);

  const add = (rows: any[]) => {
    for (const o of rows || []) {
      const id = String(o?.id || '').trim();
      const orderId = String(o?.order_id || '').trim();
      const sessionId = String(o?.session_id || '').trim();
      if (id) index.set(id, o);
      if (orderId) index.set(orderId, o);
      if (sessionId) index.set(sessionId, o);
    }
  };

  for (const b of batches) {
    try {
      const { data } = await mainSb.from('h2s_orders').select(cols).in('id', b).limit(1000);
      if (Array.isArray(data)) add(data);
    } catch {
      // ignore
    }
    try {
      const { data } = await mainSb.from('h2s_orders').select(cols).in('order_id', b).limit(1000);
      if (Array.isArray(data)) add(data);
    } catch {
      // ignore
    }
    try {
      const { data } = await mainSb.from('h2s_orders').select(cols).in('session_id', b).limit(1000);
      if (Array.isArray(data)) add(data);
    } catch {
      // ignore
    }
  }

  return index;
}

async function loadPayoutsByJobIndex(dispatchSb: any, days: number): Promise<Map<string, number>> {
  const index = new Map<string, number>();
  if (!dispatchSb) return index;

  const sinceIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const untilIso = new Date().toISOString();

  const trySelect = async (table: string) => {
    try {
      const { data, error } = await dispatchSb
        .from(table)
        .select('*')
        .gte('created_at', sinceIso)
        .lt('created_at', untilIso)
        .limit(2000);
      if (!error && Array.isArray(data)) return data;
    } catch {
      // ignore
    }
    try {
      const { data, error } = await dispatchSb.from(table).select('*').limit(500);
      if (!error && Array.isArray(data)) return data;
    } catch {
      // ignore
    }
    return null;
  };

  let rows: any[] | null = null;
  for (const t of PAYOUT_TABLE_CANDIDATES) {
    rows = await trySelect(t);
    if (rows) break;
  }

  for (const p of rows || []) {
    const jobId = String(p?.job_id || p?.dispatch_job_id || p?.work_order_id || p?.workorder_id || '').trim();
    if (!jobId) continue;
    const amount = numOrZero(p?.amount ?? p?.total_amount ?? p?.payout_amount ?? 0);
    if (!(amount > 0)) continue;
    // If multiple rows exist, keep the max (safe for partial duplication)
    const prev = index.get(jobId) || 0;
    if (amount > prev) index.set(jobId, amount);
  }

  return index;
}

function getCity(job: any): string {
  const c =
    job?.city ||
    job?.service_city ||
    job?.serviceCity ||
    job?.metadata?.service_city ||
    job?.metadata?.serviceCity ||
    job?.metadata?.city ||
    job?.metadata?.service_city_name ||
    '';
  return String(c || '').trim().toLowerCase();
}

function getCustomerKey(job: any): string {
  const e = job?.customer_email || job?.email || job?.metadata?.customer_email || '';
  const p = job?.customer_phone || job?.phone || job?.metadata?.customer_phone || '';
  const n = job?.customer_name || job?.metadata?.customer_name || '';
  return String(e || p || n || '').trim().toLowerCase();
}

function getStatus(job: any, statusCol?: string): string {
  const s = statusCol ? job?.[statusCol] : job?.status;
  return String(s || job?.status || '').trim().toLowerCase();
}

function isoDayFrom(value: any): string {
  if (!value) return '';
  const t = new Date(value).getTime();
  if (!Number.isFinite(t)) return '';
  return new Date(t).toISOString().slice(0, 10);
}

async function loadJobs(sb: any, jobsTable: string, days: number) {
  const sinceIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  try {
    const { data, error } = await sb.from(jobsTable).select('*').gte('created_at', sinceIso).limit(2000);
    if (!error && Array.isArray(data)) return data;
  } catch {
    // ignore
  }

  try {
    const { data, error } = await sb.from(jobsTable).select('*').limit(500);
    if (!error && Array.isArray(data)) return data;
  } catch {
    // ignore
  }

  return [];
}

async function loadActiveProsCount(dispatchSb: any, mainSb: any | null): Promise<number> {
  const tryCount = async (table: string) => {
    try {
      const { data, error } = await dispatchSb.from(table).select('*').limit(2000);
      if (error || !Array.isArray(data)) return null;
      const active = data.filter((p: any) => {
        const st = String(p?.status ?? '').toLowerCase();
        return !st || st === 'active' || st === 'available' || st === 'enabled';
      });
      return (active.length || data.length) as number;
    } catch {
      return null;
    }
  };

  const candidates = ['h2s_dispatch_pros', 'h2s_pros', 'h2s Pros'];
  for (const t of candidates) {
    const c = await tryCount(t);
    if (typeof c === 'number') return c;
  }

  if (mainSb) {
    for (const t of candidates) {
      try {
        const { data, error } = await mainSb.from(t).select('*').limit(2000);
        if (error || !Array.isArray(data)) continue;
        const active = data.filter((p: any) => {
          const st = String(p?.status ?? '').toLowerCase();
          return !st || st === 'active' || st === 'available' || st === 'enabled';
        });
        return (active.length || data.length) as number;
      } catch {
        // ignore
      }
    }
  }

  return 0;
}

function buildAiHtml(metrics: any): string {
  const ops = metrics.operations || {};
  const wf = metrics.workforce || {};
  const cap = metrics.capacity || {};
  const geo = metrics.geography || {};

  return `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial; line-height:1.6; color:#e2e8f0">
      <h3 style="margin:0 0 8px 0; font-size:18px;">Dispatch Snapshot</h3>
      <ul>
        <li><strong>Completed jobs (30d):</strong> ${ops.jobs_completed || 0}</li>
        <li><strong>Pending jobs:</strong> ${ops.jobs_pending || 0}</li>
        <li><strong>Active pros:</strong> ${wf.active_pros || 0}</li>
        <li><strong>Capacity utilization:</strong> ${cap.utilization_pct || 0}%</li>
      </ul>
      <h4 style="margin:16px 0 8px 0;">Operational Notes</h4>
      <ul>
        <li><strong>Bottlenecks (&gt;48h):</strong> ${(geo.bottlenecks_count ?? ops.bottlenecks?.length ?? 0)}</li>
        <li><strong>Understaffed cities:</strong> ${(geo.understaffed_cities || []).slice(0, 5).join(', ') || 'None detected'}</li>
      </ul>
      <p style="margin-top:12px; color:#94a3b8; font-size:12px;">This report is generated without external AI providers.</p>
    </div>
  `;
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
  const schema = await resolveDispatchSchema(sb);
  const jobsTable = schema?.jobsTable || 'h2s_dispatch_jobs';

  const days = 30;
  const jobs = await loadJobs(sb, jobsTable, days);

  const orderKeys = jobs.map(extractOrderKey).filter(Boolean);
  const ordersIndex = main ? await loadOrdersIndex(main, orderKeys) : new Map<string, any>();
  const payoutsByJob = await loadPayoutsByJobIndex(sb, days);

  const resolveRevenue = (j: any): number => {
    let jobRevenue = computeJobRevenue(j);
    if (!(jobRevenue > 0)) {
      const ok = extractOrderKey(j);
      const order = ok ? ordersIndex.get(ok) : null;
      const orderRev = order ? computeOrderRevenue(order) : 0;
      if (orderRev > 0) jobRevenue = orderRev;
    }

    // Final fallback: infer revenue from payout amount (default payout rule is ~35% of subtotal)
    if (!(jobRevenue > 0)) {
      const jobId = String(j?.job_id || j?.id || '').trim();
      const payout = (jobId && payoutsByJob.get(jobId)) || numOrZero(parseMaybeJson(j?.metadata)?.estimated_payout) || 0;
      if (payout > 0) {
        const inferred = payout / 0.35;
        if (Number.isFinite(inferred) && inferred > 0) jobRevenue = inferred;
      }
    }

    return jobRevenue;
  };

  const statusCol = schema?.jobsStatusCol || 'status';

  const completedStatuses = new Set(['completed', 'pending_payment', 'paid']);
  const pendingStatuses = new Set(['pending', 'pending_scheduling', 'offer_sent', 'accepted', 'scheduled', 'unassigned', 'new']);

  let jobsCompleted = 0;
  let jobsPending = 0;

  let totalRevenue = 0;
  let revenueCompleted = 0;

  const revenueByDay = new Map<string, number>();

  const cityStats = new Map<string, { jobs: number; revenue: number; margin: number }>();
  const pendingByCity = new Map<string, number>();
  const customers = new Map<string, number>();

  const now = Date.now();
  const bottlenecks: any[] = [];

  for (const j of jobs) {
    const st = getStatus(j, statusCol);
    const jobRevenue = resolveRevenue(j);
    if (jobRevenue > 0) totalRevenue += jobRevenue;

    if (completedStatuses.has(st)) {
      jobsCompleted++;
      if (jobRevenue > 0) {
        revenueCompleted += jobRevenue;
        const day = isoDayFrom(j?.completed_at || j?.completedAt || j?.created_at || j?.createdAt);
        if (day) revenueByDay.set(day, (revenueByDay.get(day) || 0) + jobRevenue);
      }
    } else if (pendingStatuses.has(st)) {
      jobsPending++;
    }

    const city = getCity(j);
    if (city) {
      const s = cityStats.get(city) || { jobs: 0, revenue: 0, margin: 50 };
      s.jobs += 1;
      if (jobRevenue > 0) s.revenue += jobRevenue;
      cityStats.set(city, s);
      if (!completedStatuses.has(st)) pendingByCity.set(city, (pendingByCity.get(city) || 0) + 1);
    }

    const ck = getCustomerKey(j);
    if (ck) customers.set(ck, (customers.get(ck) || 0) + 1);

    // Bottlenecks: pending for >48h
    const createdAt = j?.created_at ? new Date(j.created_at).getTime() : NaN;
    if (Number.isFinite(createdAt) && !completedStatuses.has(st)) {
      const hoursPending = (now - createdAt) / (1000 * 60 * 60);
      if (hoursPending > 48) {
        bottlenecks.push({
          job_id: String(j?.job_id || j?.id || ''),
          hours_pending: Math.round(hoursPending),
          status: st || 'pending',
        });
      }
    }
  }

  const totalConsidered = jobsCompleted + jobsPending;
  const completionRate = totalConsidered ? safePct((jobsCompleted / totalConsidered) * 100) : 0;

  const activePros = await loadActiveProsCount(sb, main);
  const utilization = activePros ? safePct((jobsPending / Math.max(1, activePros * 3)) * 100) : 0;

  const topCities = Array.from(cityStats.entries())
    .map(([name, s]) => ({ name, jobs: s.jobs, revenue: s.revenue, margin: s.margin }))
    .sort((a, b) => b.jobs - a.jobs)
    .slice(0, 10);

  const understaffed = Array.from(pendingByCity.entries())
    .filter(([, cnt]) => cnt >= 3)
    .sort((a, b) => b[1] - a[1])
    .map(([city]) => city)
    .slice(0, 10);

  // Simple MoM approximation: compare last 30d vs previous 30d if possible
  let momGrowth = 0;
  try {
    const prevJobs = await loadJobs(sb, jobsTable, 60);
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const thisPeriod = prevJobs.filter((j: any) => (j?.created_at ? new Date(j.created_at).getTime() : 0) >= cutoff).length;
    const prevPeriod = prevJobs.length - thisPeriod;
    momGrowth = prevPeriod ? Math.round(((thisPeriod - prevPeriod) / prevPeriod) * 100) : 0;
  } catch {
    momGrowth = 0;
  }

  const uniqueCustomers = customers.size;
  const repeatCustomers = Array.from(customers.values()).filter((c) => c > 1).length;
  const repeatRate = uniqueCustomers ? safePct((repeatCustomers / uniqueCustomers) * 100) : 0;

  const metrics: any = {
    revenue: {
      total: Math.round(totalRevenue),
      margin: 50,
    },
    operations: {
      jobs_completed: jobsCompleted,
      jobs_pending: jobsPending,
      completion_rate: completionRate,
      bottlenecks: bottlenecks.slice(0, 25),
    },
    workforce: {
      active_pros: activePros,
      utilization_rate: utilization,
    },
    growth: {
      mom_growth: momGrowth,
      this_month_jobs: jobs.length,
      repeat_rate: repeatRate,
      unique_customers: uniqueCustomers,
    },
    capacity: {
      utilization_pct: utilization,
      current_load: jobsPending,
    },
    geography: {
      top_cities: topCities,
      understaffed_cities: understaffed,
      bottlenecks_count: bottlenecks.length,
    },
    pricing: {
      byo: { jobs: 0, revenue: 0, margin: 50 },
      h2s: { jobs: 0, revenue: 0, margin: 50 },
    },
    meta: {
      jobs_table: jobsTable,
      admin: auth.adminEmail,
    },
  };

  // Pricing breakdown (basic): bucket by whether customer provided mount.
  for (const j of jobs) {
    const st = getStatus(j, statusCol);
    if (!completedStatuses.has(st)) continue;
    const rev = resolveRevenue(j);
    if (!(rev > 0)) continue;
    const tier = classifyPricingTier(j);
    metrics.pricing[tier].jobs += 1;
    metrics.pricing[tier].revenue += rev;
  }

  // Prefer completed revenue for summary accuracy
  metrics.revenue.completed_total = Math.round(revenueCompleted);

  // Real revenue trend (last 30 days, completed jobs only)
  const trend: { date: string; total: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    const day = d.toISOString().slice(0, 10);
    trend.push({ date: day, total: Math.round(revenueByDay.get(day) || 0) });
  }
  metrics.revenue.trend = trend;

  const analyze = new URL(request.url).searchParams.get('analyze') === 'true';
  if (analyze) {
    metrics.ai_analysis = buildAiHtml(metrics);
  }

  return NextResponse.json(metrics, { headers: corsHeaders(request) });
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

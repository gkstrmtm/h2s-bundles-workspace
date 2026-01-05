import { NextResponse } from 'next/server';
import { getSupabase, getSupabaseDb1, getSupabaseDispatch, getSupabaseMgmt } from '@/lib/supabase';
import OpenAI from 'openai';

type TrackingEventRow = {
  visitor_id?: string | null;
  session_id?: string | null;
  occurred_at?: string | null;
  event_type?: string | null;
  event_name?: string | null;
  page_path?: string | null;
  utm_source?: string | null;
  utm_campaign?: string | null;
  revenue_amount?: string | number | null;
  metadata?: any;
};

// Initialize OpenAI only if API key exists
const openai = process.env.OPENAI_API_KEY 
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

// Helper to handle CORS
function corsHeaders(request?: Request): Record<string, string> {
  // Allow specific origins or use wildcard for non-credential requests
  const origin = request?.headers.get('origin') || '';
  const allowedOrigins = [
    'https://home2smart.com',
    'https://www.home2smart.com',
    'http://localhost:3000',
    'http://localhost:8080'
  ];
  
  const allowOrigin = allowedOrigins.includes(origin) ? origin : '*';
  
  const headers: Record<string, string> = {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-H2S-Admin-Token',
  };
  
  if (allowOrigin !== '*') {
    headers['Access-Control-Allow-Credentials'] = 'true';
  }
  
  return headers;
}

function getConfiguredAdminToken(): string | null {
  const token = String(process.env.H2S_ADMIN_TOKEN || '').trim();
  return token ? token : null;
}

function requireAdminToken(request: Request): { ok: true } | { ok: false; status: number; error: string } {
  const configured = getConfiguredAdminToken();

  // If a token is configured, require it.
  if (configured) {
    const provided = String(request.headers.get('x-h2s-admin-token') || '').trim();
    if (!provided) {
      return { ok: false, status: 401, error: 'Missing admin token' };
    }

    if (provided !== configured) {
      return { ok: false, status: 403, error: 'Invalid admin token' };
    }

    return { ok: true };
  }

  // No token configured: allow only from allowlisted browser origins.
  // NOTE: CORS alone doesn't stop server-to-server calls; this is a minimal guard.
  const origin = String(request.headers.get('origin') || '').trim();
  const allowedOrigins = [
    'https://home2smart.com',
    'https://www.home2smart.com',
    'http://localhost:3000',
    'http://localhost:8080'
  ];

  if (!origin || !allowedOrigins.includes(origin)) {
    return {
      ok: false,
      status: 403,
      error: 'Unauthorized: missing/invalid Origin (set H2S_ADMIN_TOKEN to use token auth)'
    };
  }

  return { ok: true };
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function normalizePathPattern(raw: unknown): string | null {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s) return null;

  let path = s;
  if (/^https?:\/\//i.test(path)) {
    try {
      path = new URL(path).pathname || '';
    } catch {
      return null;
    }
  }

  path = path.split('?')[0].split('#')[0].trim();
  if (!path) return null;
  if (!path.startsWith('/')) path = `/${path}`;
  return path.toLowerCase();
}

function normalizeMatchType(raw: unknown): 'exact' | 'prefix' {
  const s = String(raw || '').trim().toLowerCase();
  return s === 'prefix' ? 'prefix' : 'exact';
}

type PathRuleRow = {
  id: string;
  pattern: string;
  match_type: 'exact' | 'prefix' | string;
  is_blocked: boolean;
  reason?: string | null;
  created_at?: string;
  updated_at?: string;
};

// Cache for path rules to avoid DB query on every event check
let cachedPathRules: PathRuleRow[] | null = null;
let cacheExpiry: number = 0;
const CACHE_TTL_MS = 60000; // 1 minute cache

async function getCachedPathRules(): Promise<PathRuleRow[]> {
  const now = Date.now();
  if (cachedPathRules && now < cacheExpiry) {
    return cachedPathRules;
  }
  
  try {
    const db = getTrackingDb();
    const { data: rows } = await db
      .from('h2s_tracking_path_rules')
      .select('id,pattern,match_type,is_blocked,reason,created_at,updated_at')
      .eq('is_blocked', true)
      .limit(1000);
    
    cachedPathRules = (rows || []) as PathRuleRow[];
    cacheExpiry = now + CACHE_TTL_MS;
    return cachedPathRules;
  } catch (error) {
    console.error('Failed to load path rules:', error);
    return [];
  }
}

function pathMatchesRule(path: string, rule: PathRuleRow): boolean {
  const pattern = String(rule.pattern || '').trim().toLowerCase();
  if (!pattern) return false;
  if (rule.match_type === 'exact') return path === pattern;
  if (rule.match_type === 'prefix') {
    return path === pattern || path.startsWith(`${pattern}/`) || path.startsWith(pattern);
  }
  return false;
}

function getTrackingDb() {
  return getSupabaseDb1() || getSupabase();
}

function toInt(value: unknown, fallback: number): number {
  const n = typeof value === 'string' ? parseInt(value, 10) : typeof value === 'number' ? value : NaN;
  return Number.isFinite(n) ? n : fallback;
}

function toEventType(event: TrackingEventRow): string {
  return String(event.event_type || event.event_name || '').trim() || 'unknown';
}

function safeFloat(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function normalizeRevenueAmount(value: unknown): number {
  // Production data can contain either dollars (e.g. 249.00) or cents (e.g. 24900).
  // Heuristic: treat large integer-ish values as cents and convert to dollars.
  const rawString = typeof value === 'string' ? value.trim() : '';
  const n = safeFloat(value);
  if (!Number.isFinite(n) || n <= 0) return 0;

  const looksIntegerString = rawString ? /^\d+$/.test(rawString) : false;
  const looksIntegerNumber = typeof n === 'number' && Number.isInteger(n);
  const looksLikeCents = (looksIntegerString || looksIntegerNumber) && n >= 10000;

  return looksLikeCents ? n / 100 : n;
}

function normalizeTrackingEventType(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s) return 'unknown';

  const normalized = s
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[\s-]+/g, '_');

  // Meta Pixel canonical names + common variants
  const metaPixelMap: Record<string, string> = {
    pageview: 'page_view',
    page_view: 'page_view',
    viewcontent: 'view_content',
    view_content: 'view_content',
    addtocart: 'add_to_cart',
    initiatecheckout: 'initiate_checkout',
    completeregistration: 'complete_registration',
    lead: 'lead',
    purch: 'purchase',
    purchase: 'purchase'
  };
  if (metaPixelMap[normalized]) return metaPixelMap[normalized];

  if (normalized === 'complete_registration') return 'complete_registration';
  if (normalized === 'add_to_cart') return 'add_to_cart';
  if (normalized === 'initiate_checkout') return 'initiate_checkout';
  if (normalized === 'click') return 'click';
  if (normalized.endsWith('_click') || normalized.includes('click')) return 'click';

  if (normalized === 'form_submit') return 'form_submit';
  if (normalized.includes('form') && normalized.includes('submit')) return 'form_submit';

  if (normalized === 'outbound_click') return 'outbound_click';

  return normalized;
}

function isAllowedTrackingEventType(eventType: string): boolean {
  // Keep explicit: only accept events we intentionally track.
  const allowed = new Set([
    'page_view',
    'view_content',
    'lead',
    'complete_registration',
    'add_to_cart',
    'initiate_checkout',
    'purchase',
    'click',
    'form_submit',
    'outbound_click'
  ]);
  return allowed.has(eventType);
}

function numOrZero(value: unknown): number {
  const n = typeof value === 'string' ? parseFloat(value) : typeof value === 'number' ? value : NaN;
  return Number.isFinite(n) ? n : 0;
}

function extractOrderMeta(order: any): any {
  return parseMaybeJson(order?.metadata_json) || parseMaybeJson(order?.metadata) || {};
}

function computeRevenueFromItems(items: any[]): number {
  let subtotal = 0;
  for (const it of items || []) {
    if (!it || it.type === 'product') continue;
    const line = numOrZero(it.line_total ?? it.lineTotal ?? it.line_customer_total ?? it.lineCustomerTotal);
    if (line > 0) {
      subtotal += normalizeRevenueAmount(line);
      continue;
    }
    const qty = numOrZero(it.qty ?? it.quantity) || 1;
    const unit = numOrZero(it.unit_price ?? it.unitPrice ?? it.price);
    if (unit > 0) subtotal += qty * normalizeRevenueAmount(unit);
  }
  return subtotal;
}

function computeOrderRevenueAmount(order: any): number {
  const meta = extractOrderMeta(order);

  const direct =
    numOrZero(order?.total) ||
    numOrZero(order?.order_total) ||
    numOrZero(order?.total_amount) ||
    numOrZero(order?.amount_paid) ||
    numOrZero(order?.subtotal) ||
    numOrZero(order?.order_subtotal) ||
    numOrZero(meta?.total) ||
    numOrZero(meta?.order_total) ||
    numOrZero(meta?.total_amount) ||
    numOrZero(meta?.subtotal) ||
    numOrZero(meta?.order_subtotal);

  if (direct > 0) return normalizeRevenueAmount(direct);

  const items =
    Array.isArray(meta?.items_json) ? meta.items_json : Array.isArray(parseMaybeJson(meta?.items_json)) ? parseMaybeJson(meta?.items_json) : null;
  if (Array.isArray(items)) {
    const fromItems = computeRevenueFromItems(items);
    if (fromItems > 0) return fromItems;
  }

  return 0;
}

function isTestOrderRow(order: any): boolean {
  const meta = extractOrderMeta(order);
  const email = normalizeMaybeString(order?.customer_email || meta?.customer_email || meta?.email);
  const phone = normalizeMaybeString(order?.customer_phone || meta?.customer_phone || meta?.phone);
  const orderId = normalizeMaybeString(order?.order_id || meta?.order_id || order?.id);

  if (email && TEST_KEYWORDS.some((k) => email.includes(k))) return true;
  if (orderId && TEST_KEYWORDS.some((k) => orderId.includes(k))) return true;
  if (phone && (TEST_KEYWORDS.some((k) => phone.includes(k)) || looksLikeTestPhone(phone))) return true;
  return false;
}

async function fetchAllRows<T>(
  // Supabase's Postgrest builders are thenables but not typed as Promise in TS.
  // Accept any and await it.
  queryPage: (rangeFrom: number, rangeTo: number) => any,
  pageSize = 1000,
  maxRows = 100000
): Promise<T[]> {
  const all: T[] = [];
  for (let offset = 0; offset < maxRows; offset += pageSize) {
    const res = await queryPage(offset, offset + pageSize - 1);
    const data = res?.data;
    const error = res?.error;
    if (error) throw error;
    const rows: T[] = Array.isArray(data) ? data : [];
    all.push(...rows);
    if (rows.length < pageSize) break;
  }
  return all;
}

const TEST_KEYWORDS = ['test', 'demo', 'sample', 'fake', 'example', 'asdf', 'qwer', 'zzz', 'xxx'];

function normalizeMaybeString(value: unknown): string {
  if (value == null) return '';
  return String(value).toLowerCase().trim();
}

function parseMaybeJson(value: unknown): any {
  if (!value) return null;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function looksLikeTestPhone(phone: string): boolean {
  const digits = phone.replace(/\D/g, '');
  if (!digits) return false;
  if (digits.includes('555')) return true;
  if (/^(0{7,}|1{7,}|2{7,}|3{7,}|4{7,}|5{7,}|6{7,}|7{7,}|8{7,}|9{7,})$/.test(digits)) return true;
  if (digits.includes('0000') || digits.includes('1234')) return true;
  return false;
}

function isTestTrackingEvent(event: any): boolean {
  const email = normalizeMaybeString(event?.customer_email);
  const phone = normalizeMaybeString(event?.customer_phone);
  const orderId = normalizeMaybeString(event?.order_id);

  if (email && TEST_KEYWORDS.some((k) => email.includes(k))) return true;
  if (orderId && TEST_KEYWORDS.some((k) => orderId.includes(k))) return true;
  if (phone && (TEST_KEYWORDS.some((k) => phone.includes(k)) || looksLikeTestPhone(phone))) return true;

  const metadata = parseMaybeJson(event?.metadata);
  if (metadata && typeof metadata === 'object') {
    const metaText = normalizeMaybeString(
      [
        metadata.name,
        metadata.full_name,
        metadata.customer_name,
        metadata.email,
        metadata.customer_email,
        metadata.phone,
        metadata.customer_phone
      ]
        .filter(Boolean)
        .join(' ')
    );
    if (metaText && TEST_KEYWORDS.some((k) => metaText.includes(k))) return true;
    if (metaText && looksLikeTestPhone(metaText)) return true;
  }

  return false;
}

function toPathFromEvent(event: any): string {
  const raw = typeof event?.page_path === 'string' ? event.page_path : '';
  if (raw && raw.trim()) return raw.trim();
  const url = typeof event?.page_url === 'string' ? event.page_url : '';
  if (!url) return '';
  try {
    return new URL(url).pathname || '';
  } catch {
    return '';
  }
}

function normalizePathForInternalCheck(path: string): string {
  const p = String(path || '').trim();
  if (!p) return '';
  const normalized = p.startsWith('/') ? p : `/${p}`;
  return normalized.toLowerCase();
}

function isInternalTrackingPathFromEvent(event: any, customRules?: PathRuleRow[]): boolean {
  const p = normalizePathForInternalCheck(toPathFromEvent(event));
  if (!p) return false;
  
  // Check hardcoded internal paths
  const blockedRoots = ['/funnels', '/dashboard', '/portal', '/dispatch', '/funnel-track'];
  const isHardcodedInternal = blockedRoots.some((root) => p === root || p.startsWith(`${root}/`));
  if (isHardcodedInternal) return true;
  
  // Check custom database rules if provided
  if (customRules && customRules.length > 0) {
    return customRules.some(rule => rule.is_blocked && pathMatchesRule(p, rule));
  }
  
  return false;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderAiInsightsToHtml(payload: any): string {
  const title = escapeHtml(payload?.executive_summary?.headline || 'AI Funnel Insights');
  const summaryBullets: string[] = Array.isArray(payload?.executive_summary?.top_priorities)
    ? payload.executive_summary.top_priorities
    : [];

  const windowLabel = (() => {
    const start = payload?.meta?.start;
    const end = payload?.meta?.end;
    if (start && end) {
      // Keep this simple and deterministic: show ISO timestamps as returned.
      return `${start} to ${end}`;
    }
    const days = payload?.meta?.days;
    return `Last ${escapeHtml(String(days || 30))} days`;
  })();

  const kpis = payload?.kpis || {};
  const recs: any[] = Array.isArray(payload?.recommendations) ? payload.recommendations : [];
  const experiments: any[] = Array.isArray(payload?.experiments) ? payload.experiments : [];
  const risks: string[] = Array.isArray(payload?.diagnostics?.data_quality_issues)
    ? payload.diagnostics.data_quality_issues
    : [];

  const kpiTable = [
    ['Events', kpis.total_events],
    ['Unique visitors', kpis.unique_visitors],
    ['Unique sessions', kpis.unique_sessions],
    ['Leads', kpis.leads],
    ['Purchases', kpis.purchases],
    ['Revenue', kpis.total_revenue != null ? `$${Number(kpis.total_revenue).toFixed(2)}` : null],
    ['AOV', kpis.avg_order_value != null ? `$${Number(kpis.avg_order_value).toFixed(2)}` : null],
    ['Visitor→Lead', kpis.visitor_to_lead_rate != null ? `${Number(kpis.visitor_to_lead_rate).toFixed(2)}%` : null],
    ['Lead→Purchase', kpis.lead_to_purchase_rate != null ? `${Number(kpis.lead_to_purchase_rate).toFixed(2)}%` : null],
    ['Visitor→Purchase', kpis.visitor_to_purchase_rate != null ? `${Number(kpis.visitor_to_purchase_rate).toFixed(2)}%` : null]
  ]
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([k, v]) => `<tr><td style="padding:6px 10px;border-bottom:1px solid #e7eaf0;"><strong>${escapeHtml(String(k))}</strong></td><td style="padding:6px 10px;border-bottom:1px solid #e7eaf0;">${escapeHtml(String(v))}</td></tr>`)
    .join('');

  const bulletsHtml = summaryBullets.length
    ? `<ul>${summaryBullets.map((b) => `<li>${escapeHtml(String(b))}</li>`).join('')}</ul>`
    : '<p>No priorities returned.</p>';

  const recsHtml = recs.length
    ? `<ol>${recs
        .slice(0, 12)
        .map((r) => {
          const t = escapeHtml(String(r?.title || 'Recommendation'));
          const impact = escapeHtml(String(r?.impact || ''));
          const effort = escapeHtml(String(r?.effort || ''));
          const metric = escapeHtml(String(r?.metric_to_move || ''));
          const why = escapeHtml(String(r?.why || ''));
          const how = escapeHtml(String(r?.how || ''));
          const expected = escapeHtml(String(r?.expected_lift || ''));
          const metaBits = [
            impact ? `Impact: ${impact}` : '',
            effort ? `Effort: ${effort}` : '',
            metric ? `Metric: ${metric}` : '',
            expected ? `Expected lift: ${expected}` : ''
          ].filter(Boolean);
          const meta = metaBits.length ? `<div style="margin:6px 0;color:#5f6368;">${metaBits.join(' • ')}</div>` : '';
          return `<li style="margin:10px 0;"><strong>${t}</strong>${meta}${why ? `<div><em>Why:</em> ${why}</div>` : ''}${how ? `<div><em>How:</em> ${how}</div>` : ''}</li>`;
        })
        .join('')}</ol>`
    : '<p>No recommendations returned.</p>';

  const experimentsHtml = experiments.length
    ? `<ul>${experiments
        .slice(0, 10)
        .map((e) => `<li><strong>${escapeHtml(String(e?.title || 'Experiment'))}</strong>${e?.hypothesis ? ` — ${escapeHtml(String(e.hypothesis))}` : ''}</li>`)
        .join('')}</ul>`
    : '';

  const risksHtml = risks.length
    ? `<ul>${risks.slice(0, 10).map((r) => `<li>${escapeHtml(String(r))}</li>`).join('')}</ul>`
    : '';

  return `
    <div style="color:#0a2a5a;line-height:1.7;">
      <h2 style="margin:0 0 10px 0;">${title}</h2>
      <p style="margin:0 0 16px 0;color:#5f6368;">Generated ${escapeHtml(String(payload?.generated_at || ''))}</p>

      <h3 style="margin:18px 0 8px 0;">Key Priorities</h3>
      ${bulletsHtml}

      <h3 style="margin:18px 0 8px 0;">KPIs (${escapeHtml(windowLabel)})</h3>
      <table style="border-collapse:collapse;width:100%;max-width:720px;background:#fff;border:1px solid #e7eaf0;border-radius:12px;overflow:hidden;">
        <tbody>${kpiTable}</tbody>
      </table>

      <h3 style="margin:18px 0 8px 0;">Recommendations</h3>
      ${recsHtml}

      ${experimentsHtml ? `<h3 style="margin:18px 0 8px 0;">Suggested Experiments</h3>${experimentsHtml}` : ''}
      ${risksHtml ? `<h3 style="margin:18px 0 8px 0;">Data Quality / Tracking Notes</h3>${risksHtml}` : ''}
    </div>
  `;
}

async function buildAiReport(params: {
  request: Request;
  days: number;
  limit: number;
  startDate?: string;
  endDate?: string;
  minDate?: string;
}): Promise<{ status: 'success' | 'error'; report?: string; insights?: any; message?: string; timestamp: string }> {
  if (!openai) {
    return { status: 'error', message: 'OpenAI not configured', timestamp: new Date().toISOString() };
  }

  const { searchParams } = new URL(params.request.url);
  const excludeTest = ['1', 'true', 'yes', 'on'].includes(
    String(searchParams.get('exclude_test') || searchParams.get('excludeTest') || '').toLowerCase()
  );
  const includeInternal = ['1', 'true', 'yes', 'on'].includes(
    String(searchParams.get('include_internal') || searchParams.get('includeInternal') || '').toLowerCase()
  );
  const excludeInternal = !includeInternal;
  const customPathRules = excludeInternal ? await getCachedPathRules() : [];

  const days = Math.min(Math.max(params.days, 1), 365);
  const limit = Math.min(Math.max(params.limit, 200), 10000);

  // Use explicit date range if provided, otherwise calculate from days.
  // If only one side is provided, infer the other side.
  const inferredEnd = params.endDate || new Date().toISOString();
  const inferredStart = (() => {
    if (params.startDate) return params.startDate;
    const end = new Date(inferredEnd);
    if (isNaN(end.getTime())) {
      const start = new Date();
      start.setDate(start.getDate() - days);
      return start.toISOString();
    }
    const start = new Date(end.getTime());
    start.setDate(start.getDate() - days);
    return start.toISOString();
  })();

  const queryStart = inferredStart;
  const queryEnd = inferredEnd;

  const trackingDb = getTrackingDb();
  let query = trackingDb
    .from('h2s_tracking_events')
    .select('*')
    .order('occurred_at', { ascending: false });
  
  // Apply date filters
  if (params.minDate) {
    query = query.gte('occurred_at', params.minDate);
  }
  query = query.gte('occurred_at', queryStart).lte('occurred_at', queryEnd);
  
  // Prefetch more rows so in-memory filters (test/internal) don't starve the AI input.
  const prefilterLimit = Math.min(Math.max(limit * 4, limit), 20000);
  const { data: reportEvents, error } = await query.limit(prefilterLimit);

  if (error) {
    return { status: 'error', message: `Database error: ${error.message}`, timestamp: new Date().toISOString() };
  }

  let events: TrackingEventRow[] = (reportEvents || []) as any;
  if (excludeTest) {
    events = events.filter((e: any) => !isTestTrackingEvent(e));
  }
  if (excludeInternal) {
    events = events.filter((e: any) => !isInternalTrackingPathFromEvent(e, customPathRules));
  }
  if (events.length > limit) {
    events = events.slice(0, limit);
  }
  const uniqueVisitors = new Set(events.map((e) => e.visitor_id).filter(Boolean)).size;
  const uniqueSessions = new Set(events.map((e) => e.session_id).filter(Boolean)).size;

  const purchases = events.filter((e) => toEventType(e).toLowerCase() === 'purchase');
  const totalRevenue = purchases.reduce((sum, e) => sum + safeFloat(e.revenue_amount), 0);

  const leads = events.filter((e) => {
    const t = toEventType(e).toLowerCase();
    return t === 'lead' || t === 'complete_registration';
  });

  // Funnel counts (best-effort)
  const pageViews = events.filter((e) => {
    const t = toEventType(e).toLowerCase();
    return t === 'page_view' || t === 'pageview' || t === 'view_content' || t === 'viewcontent';
  }).length;

  const visitorToLeadRate = uniqueVisitors > 0 ? (leads.length / uniqueVisitors) * 100 : 0;
  const leadToPurchaseRate = leads.length > 0 ? (purchases.length / leads.length) * 100 : 0;
  const visitorToPurchaseRate = uniqueVisitors > 0 ? (purchases.length / uniqueVisitors) * 100 : 0;
  const avgOrderValue = purchases.length > 0 ? totalRevenue / purchases.length : 0;

  // UTM + page performance summaries
  const sourceBreakdown: Record<string, number> = {};
  const sourceMetrics: Record<string, { events: number; leads: number; purchases: number; revenue: number }> = {};
  const pageMetrics: Record<string, { views: number; engagement: number; leads: number; purchases: number; revenue: number }> = {};

  for (const e of events) {
    const source = (e.utm_source || 'direct') as string;
    sourceBreakdown[source] = (sourceBreakdown[source] || 0) + 1;
    sourceMetrics[source] ||= { events: 0, leads: 0, purchases: 0, revenue: 0 };
    sourceMetrics[source].events += 1;

    const t = toEventType(e).toLowerCase();
    if (t === 'lead' || t === 'complete_registration') sourceMetrics[source].leads += 1;
    if (t === 'purchase') {
      sourceMetrics[source].purchases += 1;
      sourceMetrics[source].revenue += safeFloat(e.revenue_amount);
    }

    const path = (e.page_path || '').trim();
    if (!path) continue;
    pageMetrics[path] ||= { views: 0, engagement: 0, leads: 0, purchases: 0, revenue: 0 };
    if (t === 'page_view' || t === 'pageview') pageMetrics[path].views += 1;
    if (t === 'view_content' || t === 'viewcontent') pageMetrics[path].engagement += 1;
    if (t === 'lead' || t === 'complete_registration') pageMetrics[path].leads += 1;
    if (t === 'purchase') {
      pageMetrics[path].purchases += 1;
      pageMetrics[path].revenue += safeFloat(e.revenue_amount);
    }
  }

  const scoredPages = Object.entries(pageMetrics)
    .map(([path, m]) => {
      const score = m.views * 1 + m.engagement * 2 + m.leads * 5 + m.purchases * 10 + m.revenue / 10;
      const conversionRate = m.views > 0 ? ((m.leads + m.purchases) / m.views) * 100 : 0;
      return {
        path,
        score: Math.round(score),
        views: m.views,
        engagement: m.engagement,
        leads: m.leads,
        purchases: m.purchases,
        revenue: m.revenue,
        conversion_rate: Number(conversionRate.toFixed(2))
      };
    })
    .sort((a, b) => b.score - a.score);

  const topPages = scoredPages.slice(0, 8);
  const underperformingPages = scoredPages
    .filter((p) => p.views >= 50 && p.conversion_rate < 1 && p.purchases === 0)
    .slice(0, 8);

  const dataQualityIssues: string[] = [];
  const missingVisitorPct = events.length ? (events.filter((e) => !e.visitor_id).length / events.length) * 100 : 0;
  const missingPathPct = events.length ? (events.filter((e) => !e.page_path).length / events.length) * 100 : 0;
  if (missingVisitorPct > 2) dataQualityIssues.push(`High missing visitor_id rate: ${missingVisitorPct.toFixed(1)}%`);
  if (missingPathPct > 10) dataQualityIssues.push(`High missing page_path rate: ${missingPathPct.toFixed(1)}%`);

  const aiInput = {
    window: { days, start: queryStart, end: queryEnd },
    filters: {
      exclude_test: excludeTest,
      exclude_internal: excludeInternal,
      min_date: params.minDate || null
    },
    kpis: {
      total_events: events.length,
      unique_visitors: uniqueVisitors,
      unique_sessions: uniqueSessions,
      page_views: pageViews,
      leads: leads.length,
      purchases: purchases.length,
      total_revenue: Number(totalRevenue.toFixed(2)),
      avg_order_value: Number(avgOrderValue.toFixed(2)),
      visitor_to_lead_rate: Number(visitorToLeadRate.toFixed(2)),
      lead_to_purchase_rate: Number(leadToPurchaseRate.toFixed(2)),
      visitor_to_purchase_rate: Number(visitorToPurchaseRate.toFixed(2))
    },
    sources: Object.entries(sourceMetrics)
      .map(([source, m]) => ({
        source,
        events: m.events,
        leads: m.leads,
        purchases: m.purchases,
        revenue: Number(m.revenue.toFixed(2))
      }))
      .sort((a, b) => b.events - a.events)
      .slice(0, 12),
    top_pages: topPages,
    underperforming_pages: underperformingPages,
    data_quality_issues: dataQualityIssues,
    notes: {
      source_breakdown: sourceBreakdown
    }
  };

  const prompt = `You are a senior growth analyst for Home2Smart.\n\nYou will receive funnel analytics (already aggregated). Your job is to: (1) diagnose the funnel, (2) find leverage points, (3) propose specific experiments and fixes, and (4) call out tracking/data-quality issues.\n\nReturn valid JSON ONLY (no markdown) in this exact shape:\n\n{\n  \"executive_summary\": {\n    \"headline\": \"string\",\n    \"what_changed\": [\"string\"],\n    \"top_priorities\": [\"string\"]\n  },\n  \"kpis\": {\n    \"total_events\": number,\n    \"unique_visitors\": number,\n    \"unique_sessions\": number,\n    \"page_views\": number,\n    \"leads\": number,\n    \"purchases\": number,\n    \"total_revenue\": number,\n    \"avg_order_value\": number,\n    \"visitor_to_lead_rate\": number,\n    \"lead_to_purchase_rate\": number,\n    \"visitor_to_purchase_rate\": number\n  },\n  \"insights\": {\n    \"what_worked\": [\"string\"],\n    \"what_didnt\": [\"string\"],\n    \"source_insights\": [\"string\"],\n    \"page_insights\": [\"string\"]\n  },\n  \"diagnostics\": {\n    \"data_quality_issues\": [\"string\"],\n    \"tracking_gaps\": [\"string\"],\n    \"notes\": [\"string\"]\n  },\n  \"recommendations\": [\n    {\n      \"title\": \"string\",\n      \"impact\": \"high|medium|low\",\n      \"effort\": \"low|medium|high\",\n      \"metric_to_move\": \"string\",\n      \"expected_lift\": \"string\",\n      \"why\": \"string\",\n      \"how\": \"string\",\n      \"owner\": \"marketing|product|engineering|ops\",\n      \"timeframe\": \"this week|this month\"\n    }\n  ],\n  \"experiments\": [\n    {\n      \"title\": \"string\",\n      \"hypothesis\": \"string\",\n      \"setup\": \"string\",\n      \"success_metric\": \"string\",\n      \"duration\": \"string\"\n    }\n  ],\n  \"questions\": [\"string\"],\n  \"confidence\": {\n    \"rating\": \"high|medium|low\",\n    \"reasons\": [\"string\"]\n  },\n  \"assumptions\": [\"string\"]\n}\n\nBe extremely concrete. Reference the provided top_pages and underperforming_pages in at least 3 recommendations. If purchases are low, focus on lead quality + checkout friction + retargeting.\n\nINPUT_JSON:\n${JSON.stringify(aiInput)}`;

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: 'You are a rigorous growth analyst. Always return valid JSON only.' },
      { role: 'user', content: prompt }
    ],
    temperature: 0.2,
    max_tokens: 1800,
    response_format: { type: 'json_object' }
  });

  let insights: any;
  try {
    insights = JSON.parse(completion.choices?.[0]?.message?.content || '{}');
  } catch {
    return { status: 'error', message: 'Failed to parse AI response', timestamp: new Date().toISOString() };
  }

  // Ensure the KPIs in the response match the computed truth (avoid hallucinated numbers)
  insights.kpis = aiInput.kpis;
  insights.meta = {
    days,
    limit,
    start: aiInput.window.start,
    end: aiInput.window.end,
    filters: aiInput.filters
  };
  insights.generated_at = new Date().toISOString();
  if (!insights.diagnostics) insights.diagnostics = {};
  if (!Array.isArray(insights.diagnostics.data_quality_issues)) insights.diagnostics.data_quality_issues = [];
  insights.diagnostics.data_quality_issues = Array.from(new Set([...(insights.diagnostics.data_quality_issues || []), ...dataQualityIssues]));

  const html = renderAiInsightsToHtml(insights);
  return { status: 'success', report: html, insights, timestamp: insights.generated_at };
}

export async function OPTIONS(request: Request) {
  return NextResponse.json({}, { headers: corsHeaders(request) });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  const excludeTest = ['1', 'true', 'yes', 'on'].includes(
    String(searchParams.get('exclude_test') || searchParams.get('excludeTest') || '').toLowerCase()
  );

  // Default: exclude internal/admin pages from analytics unless explicitly included.
  const includeInternal = ['1', 'true', 'yes', 'on'].includes(
    String(searchParams.get('include_internal') || searchParams.get('includeInternal') || '').toLowerCase()
  );
  const excludeInternal = !includeInternal;

  const debug = ['1', 'true', 'yes', 'on'].includes(String(searchParams.get('debug') || '').toLowerCase());
  
  // Parse date range filters
  const startDate = searchParams.get('start_date') || searchParams.get('startDate') || undefined;
  const endDate = searchParams.get('end_date') || searchParams.get('endDate') || undefined;
  const minDate = searchParams.get('min_date') || searchParams.get('minDate') || undefined;
  
  // Preload custom path exclusion rules (cached for 1 minute)
  const customPathRules = excludeInternal ? await getCachedPathRules() : [];
  
  // Force fresh build - v2
  try {
    let result;

    // Some features (training, candidates, tasks, hours, etc.) live in the Mgmt DB.
    // Prefer Mgmt creds when present, but don't hard-fail if they're not configured.
    const supabaseMgmt = (() => {
      try {
        return getSupabaseMgmt();
      } catch {
        return getSupabase();
      }
    })();

    switch (action) {
      case 'observed_paths':
        {
          const auth = requireAdminToken(request);
          if (!auth.ok) {
            return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status, headers: corsHeaders(request) });
          }

          const limit = toInt(searchParams.get('limit'), 2000);
          const includeRules = ['1', 'true', 'yes', 'on'].includes(String(searchParams.get('include_rules') || '').toLowerCase());

          const windowHours = Math.min(Math.max(toInt(searchParams.get('window_hours'), 24), 1), 168);
          const maxEvents = Math.min(Math.max(toInt(searchParams.get('max_events'), 50000), 1000), 200000);

          const windowEnd = endDate ? new Date(endDate) : new Date();
          const windowStart = startDate ? new Date(startDate) : new Date(windowEnd.getTime() - windowHours * 60 * 60 * 1000);
          const windowStartIso = isNaN(windowStart.getTime()) ? new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString() : windowStart.toISOString();
          const windowEndIso = isNaN(windowEnd.getTime()) ? new Date().toISOString() : windowEnd.toISOString();

          const db = getTrackingDb();

          const { data: observed, error: observedError } = await db
            .from('h2s_tracking_observed_paths')
            .select('path,first_seen_at,last_seen_at')
            .order('last_seen_at', { ascending: false })
            .limit(Math.min(Math.max(limit, 1), 5000));

          if (observedError) {
            return NextResponse.json(
              { ok: false, error: `Failed to load observed paths: ${observedError.message}` },
              { status: 500, headers: corsHeaders(request) }
            );
          }

          let rules: PathRuleRow[] = [];
          if (includeRules) {
            const { data: ruleRows, error: rulesError } = await db
              .from('h2s_tracking_path_rules')
              .select('id,pattern,match_type,is_blocked,reason,created_at,updated_at')
              .order('updated_at', { ascending: false })
              .limit(5000);
            if (rulesError) {
              return NextResponse.json(
                { ok: false, error: `Failed to load path rules: ${rulesError.message}` },
                { status: 500, headers: corsHeaders(request) }
              );
            }
            rules = (ruleRows || []) as PathRuleRow[];
          }

          const activeBlocked = rules.filter((r) => r.is_blocked);

          // Compute recent event counts for observed paths.
          // Note: counts are limited by maxEvents to keep query bounded.
          const pathsForCount = (observed || [])
            .map((p: any) => String(p.path || '').trim().toLowerCase())
            .filter(Boolean);

          const countMap: Record<string, number> = {};
          let countsTruncated = false;
          if (pathsForCount.length > 0) {
            const { data: recentRows, error: recentError } = await db
              .from('h2s_tracking_events')
              .select('page_path,occurred_at')
              .in('page_path', pathsForCount)
              .gte('occurred_at', windowStartIso)
              .lte('occurred_at', windowEndIso)
              .order('occurred_at', { ascending: false })
              .limit(maxEvents);

            if (recentError) {
              return NextResponse.json(
                { ok: false, error: `Failed to load recent events for path counts: ${recentError.message}` },
                { status: 500, headers: corsHeaders(request) }
              );
            }

            const rows = (recentRows || []) as any[];
            if (rows.length >= maxEvents) countsTruncated = true;

            for (const row of rows) {
              const key = String(row.page_path || '').trim().toLowerCase();
              if (!key) continue;
              countMap[key] = (countMap[key] || 0) + 1;
            }
          }

          const paths = (observed || []).map((p: any) => {
            const path = String(p.path || '').toLowerCase();
            const matched = activeBlocked
              .filter((r) => pathMatchesRule(path, r))
              .sort((a, b) => String(b.pattern || '').length - String(a.pattern || '').length)[0];

            return {
              path: p.path,
              first_seen_at: p.first_seen_at,
              last_seen_at: p.last_seen_at,
              recent_event_count: countMap[path] || 0,
              is_blocked: !!matched,
              matched_rule: matched
                ? {
                    id: matched.id,
                    match_type: matched.match_type,
                    pattern: matched.pattern,
                    reason: matched.reason || null
                  }
                : null
            };
          });

          const meta = {
            window_start: windowStartIso,
            window_end: windowEndIso,
            window_hours: windowHours,
            max_events: maxEvents,
            counts_truncated: countsTruncated
          };

          result = includeRules ? { paths, rules, meta } : { paths, meta };
        }
        break;

      case 'path_rules':
        {
          const auth = requireAdminToken(request);
          if (!auth.ok) {
            return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status, headers: corsHeaders(request) });
          }

          const limit = toInt(searchParams.get('limit'), 2000);
          const db = getTrackingDb();
          const { data: rules, error } = await db
            .from('h2s_tracking_path_rules')
            .select('id,pattern,match_type,is_blocked,reason,created_at,updated_at')
            .order('updated_at', { ascending: false })
            .limit(Math.min(Math.max(limit, 1), 5000));

          if (error) {
            return NextResponse.json({ ok: false, error: `Failed to load path rules: ${error.message}` }, { status: 500, headers: corsHeaders(request) });
          }

          result = rules || [];
        }
        break;

      case 'candidates':
        const { data: candidates } = await getSupabase()
          .from('Candidate_Master')
          .select('*, AI_Candidate_Profiles(*)')
          .order('Updated_At', { ascending: false });
        result = candidates;
        break;

      case 'aiProfiles':
        // Return candidates with AI profiles for the Reports tab
        const { data: profileCandidates } = await getSupabase()
          .from('Candidate_Master')
          .select('*, AI_Candidate_Profiles(*)')
          .order('Updated_At', { ascending: false });
        
        // Transform to match Dashboard expectations, filter out candidates without profiles
        const profiles = profileCandidates
          ?.filter(c => c.AI_Candidate_Profiles && Object.keys(c.AI_Candidate_Profiles).length > 0)
          .map(c => ({
            ...c.AI_Candidate_Profiles,
            Candidate_ID: c.Candidate_ID,
            First_Name: c.First_Name,
            Last_Name: c.Last_Name,
            Phone: c.Phone,
            Email: c.Email,
            Current_Stage: c.Current_Stage,
            Interview_Date: c.Interview_Date
          })) || [];
        
        result = profiles;
        break;

      case 'tasks':
        const { data: tasks } = await getSupabase()
          .from('Tasks')
          .select('*')
          .neq('Status', 'ARCHIVED')
          .order('Priority', { ascending: true });
        result = tasks;
        break;

      case 'hours':
        const hoursVaName = searchParams.get('vaName');
        const requestId = `get_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        let hoursQuery = getSupabase()
          .from('VA_Hours_Log')
          .select('*')
          .order('Date', { ascending: false });
        
        // Only filter by vaName if it's provided and not 'all' or 'DEMO'
        if (hoursVaName && hoursVaName !== 'DEMO' && hoursVaName !== 'all') {
          hoursQuery = hoursQuery.eq('Logged_By', hoursVaName);
          // Limit to 50 for individual user view (recent entries)
          hoursQuery = hoursQuery.limit(50);
        }
        // For admin view (no vaName or vaName=all), get all hours - no limit

        const { data: hours, error: hoursError } = await hoursQuery;
        
        if (hoursError) {
          return NextResponse.json({ 
            ok: false, 
            error: `Failed to load hours: ${hoursError.message}` 
          }, { status: 500, headers: corsHeaders(request) });
        }
        
        result = hours || [];
        break;

      case 'training':
        const { data: training, error: trainingError } = await supabaseMgmt
          .from('Training_Resources')
          .select(`
            *,
            completions:Training_Completions(*)
          `)
          .order('Order', { ascending: true });

        if (trainingError) {
          return NextResponse.json({
            ok: false,
            error: `Failed to load training resources: ${trainingError.message}`
          }, { status: 500, headers: corsHeaders(request) });
        }
        result = training;
        break;
      
      case 'trainingCompletions':
        const vaName = searchParams.get('vaName') || 'ROSEL';
        const { data: completions, error: completionsError } = await supabaseMgmt
          .from('Training_Completions')
          .select('*, resource:Training_Resources(*)')
          .eq('Completed_By', vaName)
          .order('Completed_At', { ascending: false })
          .limit(50);
        
        if (completionsError) {
          return NextResponse.json({ 
            ok: false, 
            error: `Failed to load completions: ${completionsError.message}` 
          }, { status: 500, headers: corsHeaders(request) });
        }
        
        // Transform data to match frontend expectations - flatten resource relation
        const transformedCompletions = (completions || []).map(c => {
          const resource = c.resource || {};
          return {
            ...c,
            Training_Title: resource.Title || c.Title || 'Untitled Training',
            Title: resource.Title || c.Title || 'Untitled Training',
            Category: resource.Category || null,
            Skills_Taught: resource.Skills_Taught || null,
            // Keep resource for backward compatibility but also flatten main fields
            resource: resource
          };
        });
        
        result = transformedCompletions;
        break;
      
      case 'vaKnowledgeProfile':
        const profileVaName = searchParams.get('vaName') || 'ROSEL';
        const { data: profile } = await supabaseMgmt
          .from('VA_Knowledge_Profiles')
          .select('*')
          .eq('VA_Name', profileVaName)
          .single();
        
        // Create profile if doesn't exist
        if (!profile) {
          const { data: newProfile } = await supabaseMgmt
            .from('VA_Knowledge_Profiles')
            .insert({
              VA_Name: profileVaName,
              Skill_Competencies: {},
              Top_Skill_Gaps: [],
              Recommended_Trainings: []
            })
            .select()
            .single();
          result = newProfile;
        } else {
          result = profile;
        }
        break;
      
      case 'trainingAnalytics':
        const analyticsVaName = searchParams.get('vaName') || 'ROSEL';
        const category = searchParams.get('category');
        
        let analyticsQuery = supabaseMgmt
          .from('Training_Analytics')
          .select('*')
          .eq('VA_Name', analyticsVaName)
          .order('Analysis_Date', { ascending: false });
        
        if (category) {
          analyticsQuery = analyticsQuery.eq('Category', category);
        }
        
        const { data: analytics } = await analyticsQuery;
        result = analytics;
        break;
      
      case 'deliverables':
        const statusFilter = searchParams.get('status') || 'all';
        let deliverablesQuery = getSupabase()
          .from('Deliverables')
          .select('*')
          .order('Created_At', { ascending: false });
        
        if (statusFilter !== 'all') {
          deliverablesQuery = deliverablesQuery.eq('Status', statusFilter.toUpperCase());
        }
        
        const { data: deliverables, error: deliverablesError } = await deliverablesQuery;
        
        if (deliverablesError) {
          return NextResponse.json({ 
            ok: false, 
            error: `Failed to load deliverables: ${deliverablesError.message}` 
          }, { status: 500, headers: corsHeaders(request) });
        }
        
        result = deliverables || [];
        break;

      case 'offers':
      case 'getOffers': {
        // Job offers (legacy meaning): derive from dispatch jobs tables.
        // This matches the older portal_jobs behavior and EmployeeDashboard's "Job Offers" page.
        const dispatchClient = getSupabaseDispatch();
        if (!dispatchClient) {
          return NextResponse.json(
            { ok: false, error: 'Dispatch database not configured' },
            { status: 503, headers: corsHeaders(request) }
          );
        }

        const status = (searchParams.get('status') || 'pending').toLowerCase();
        const limit = Math.min(Math.max(Number(searchParams.get('limit') || 200) || 200, 1), 500);

        let offersQuery: any = (dispatchClient as any)
          .from('h2s_dispatch_jobs')
          .select('*')
          .limit(limit);

        // Map dashboard status values to dispatch job statuses.
        if (status === 'pending' || status === 'offers') {
          offersQuery = offersQuery.in('status', ['pending_assign', 'pending', 'open']);
        } else if (status === 'upcoming') {
          offersQuery = offersQuery.in('status', ['accepted', 'scheduled']);
        } else if (status === 'completed') {
          offersQuery = offersQuery.in('status', ['completed', 'paid']);
        } else if (status !== 'all') {
          offersQuery = offersQuery.eq('status', status);
        }

        // Prefer stable ordering if available.
        offersQuery = offersQuery.order('created_at', { ascending: false });

        const { data: jobs, error: jobsError } = await offersQuery;
        if (jobsError) {
          return NextResponse.json(
            { ok: false, error: `Failed to load offers: ${jobsError.message}` },
            { status: 500, headers: corsHeaders(request) }
          );
        }

        // Provide EmployeeDashboard-friendly aliases while preserving raw fields for other consumers.
        const offers = (jobs || []).map((j: any) => {
          const id = String(j.job_id || j.id || '');
          const payRate =
            (j.payout_estimated != null ? j.payout_estimated : undefined) ??
            (j.metadata && j.metadata.estimated_payout != null ? j.metadata.estimated_payout : undefined);
          const date = j.window || j.start_iso || (j.metadata && (j.metadata.window || j.metadata.start_iso)) || null;
          const jobTitle = j.service_name || j.description || j.customer_name || 'Job Offer';
          const description = j.description || j.service_name || null;
          return {
            ...j,
            id,
            jobTitle,
            date,
            payRate,
            description,
          };
        });

        return NextResponse.json({ ok: true, offers }, { headers: corsHeaders(request) });
      }

      case 'jobs': {
        // Minimal support for EmployeeDashboard counts/lists.
        const dispatchClient = getSupabaseDispatch();
        if (!dispatchClient) {
          return NextResponse.json(
            { ok: false, error: 'Dispatch database not configured' },
            { status: 503, headers: corsHeaders(request) }
          );
        }

        const status = (searchParams.get('status') || 'upcoming').toLowerCase();
        const limit = Math.min(Math.max(Number(searchParams.get('limit') || 200) || 200, 1), 500);

        let jobsQuery: any = (dispatchClient as any)
          .from('h2s_dispatch_jobs')
          .select('*')
          .limit(limit)
          .order('created_at', { ascending: false });

        if (status === 'upcoming') {
          jobsQuery = jobsQuery.in('status', ['accepted', 'scheduled']);
        } else if (status === 'completed') {
          jobsQuery = jobsQuery.in('status', ['completed', 'paid']);
        } else if (status !== 'all') {
          jobsQuery = jobsQuery.eq('status', status);
        }

        const { data: jobs, error: jobsError } = await jobsQuery;
        if (jobsError) {
          return NextResponse.json(
            { ok: false, error: `Failed to load jobs: ${jobsError.message}` },
            { status: 500, headers: corsHeaders(request) }
          );
        }

        const normalized = (jobs || []).map((j: any) => ({
          ...j,
          id: String(j.job_id || j.id || ''),
          title: j.service_name || j.description || 'Job',
          date: j.window || j.start_iso || null,
          location: [j.address, j.city, j.state].filter(Boolean).join(', ') || null,
          customer: j.customer_name || null,
        }));

        return NextResponse.json({ ok: true, jobs: normalized }, { headers: corsHeaders(request) });
      }

      case 'offer': {
        // Get single offer by ID
        const offerId = searchParams.get('id');
        if (!offerId) {
          return NextResponse.json({
            ok: false,
            error: 'Offer ID required'
          }, { status: 400, headers: corsHeaders(request) });
        }

        const { data: offer, error: offerError } = await getSupabase()
          .from('Offers')
          .select('*')
          .eq('Offer_ID', offerId)
          .single();

        if (offerError) {
          return NextResponse.json({
            ok: false,
            error: `Failed to load offer: ${offerError.message}`
          }, { status: 500, headers: corsHeaders(request) });
        }

        return NextResponse.json(
          { ok: true, offer },
          { headers: corsHeaders(request) }
        );
      }
        
      case 'updateTaskStatus':
        const taskId = searchParams.get('taskId');
        const status = searchParams.get('status');
        if (taskId && status) {
          const { data: updatedTask } = await getSupabase()
            .from('Tasks')
            .update({ 
              Status: status, 
              Completed_At: status === 'COMPLETED' ? new Date().toISOString() : null 
            })
            .eq('Task_ID', taskId)
            .select()
            .single();
          result = updatedTask;
        }
        break;

      case 'refineTask':
        const title = searchParams.get('title');
        const description = searchParams.get('description');
        if (title && description && openai) {
          // Call OpenAI
          const completion = await openai.chat.completions.create({
            messages: [
              { role: "system", content: "You are an expert SOP writer. Convert rough notes into a clear, step-by-step Standard Operating Procedure." },
              { role: "user", content: `Task: ${title}\nNotes: ${description}` }
            ],
            model: "gpt-4o",
          });
          result = { refinedDescription: completion.choices[0].message.content };
        } else if (!openai) {
          result = { error: 'OpenAI API not configured' };
        }
        break;

      case 'refineExistingTask':
        const refineTaskId = searchParams.get('taskId');
        const feedback = searchParams.get('feedback');
        
        if (refineTaskId && feedback && openai) {
          const { data: task } = await getSupabase()
            .from('Tasks')
            .select('*')
            .eq('Task_ID', refineTaskId)
            .single();
          if (!task) throw new Error('Task not found');

          const completion = await openai.chat.completions.create({
            messages: [
              { role: "system", content: "You are a Revenue Operations Director. Clarify tasks to ensure high performance." },
              { role: "user", content: `CURRENT TASK:\nTitle: ${task.Title}\nDescription: ${task.Description}\n\nFEEDBACK: ${feedback}\n\nRewrite the description.` }
            ],
            model: "gpt-4o",
          });
          
          const newDescription = completion.choices[0].message.content;
          await getSupabase()
            .from('Tasks')
            .update({ Description: newDescription })
            .eq('Task_ID', refineTaskId);
          
          result = { newDescription };
        } else if (!openai) {
          result = { error: 'OpenAI API not configured' };
        }
        break;

      case 'updateDecision':
        // Update manual decision for a candidate (PASS/FAIL) with optional notes
        const decisionCandidateId = searchParams.get('candidateId');
        const decisionValue = searchParams.get('decision'); // PASS or FAIL
        const decisionNotes = searchParams.get('notes') || '';
        
        if (!decisionCandidateId || !decisionValue) {
          return NextResponse.json({ 
            ok: false, 
            error: 'Missing candidateId or decision parameter' 
          }, { status: 400, headers: corsHeaders(request) });
        }
        
        if (decisionValue !== 'PASS' && decisionValue !== 'FAIL') {
          return NextResponse.json({ 
            ok: false, 
            error: 'Decision must be PASS or FAIL' 
          }, { status: 400, headers: corsHeaders(request) });
        }
        
        try {
          // Update AI_Candidate_Profiles table
          const updateData: any = {
            Manual_Decision: decisionValue,
            Decision_Date: new Date().toISOString(),
            Decision_By: 'ROSEL' // TODO: Get from auth/session
          };
          
          // Add Decision_Notes if provided (feedback loop)
          if (decisionNotes) {
            updateData.Decision_Notes = decisionNotes;
          }
          
          const { data: updatedProfile, error: profileError } = await getSupabase()
            .from('AI_Candidate_Profiles')
            .update(updateData)
            .eq('Candidate_ID', decisionCandidateId)
            .select()
            .single();
          
          if (profileError) {
            return NextResponse.json({ 
              ok: false, 
              error: `Failed to update profile: ${profileError.message}` 
            }, { status: 500, headers: corsHeaders(request) });
          }
          
          // If PASSED, update Candidate_Master to move them to HIRED stage
          if (decisionValue === 'PASS') {
            const { error: masterError } = await getSupabase()
              .from('Candidate_Master')
              .update({
                Current_Stage: 'HIRED',
                Interview_Outcome: 'PASSED - Hired',
                Updated_At: new Date().toISOString()
              })
              .eq('Candidate_ID', decisionCandidateId);
            
            if (masterError) {
              console.error('Failed to update Candidate_Master:', masterError);
              // Don't fail the request, just log the error
            }
          }
          
          result = { ok: true, profile: updatedProfile, message: 'Decision updated successfully' };
        } catch (error: any) {
          return NextResponse.json({ 
            ok: false, 
            error: `Failed to update decision: ${error.message}` 
          }, { status: 500, headers: corsHeaders(request) });
        }
        break;

      case 'generateTaskFromLearning':
        // Generate intelligent task from learning data
        if (!openai) {
          return NextResponse.json({ 
            ok: false, 
            error: 'OpenAI API not configured' 
          }, { status: 400, headers: corsHeaders(request) });
        }

        const concept = searchParams.get('concept') || '';
        const gap = searchParams.get('gap') || '';
        const resourceId = searchParams.get('resourceId') || '';
        const confidenceScore = parseInt(searchParams.get('confidenceScore') || '70', 10);
        const taskVaName = searchParams.get('vaName') || '';

        if (!concept && !gap) {
          return NextResponse.json({ 
            ok: false, 
            error: 'Either concept or gap must be provided' 
          }, { status: 400, headers: corsHeaders(request) });
        }

        try {
          // Get training resource if available
          let trainingContext = '';
          if (resourceId) {
            const { data: resource } = await getSupabase()
              .from('Training_Resources')
              .select('Title, Category, Skills_Taught, Description')
              .eq('Resource_ID', resourceId)
              .single();
            
            if (resource) {
              trainingContext = `\n\nTRAINING CONTEXT:\nTitle: ${resource.Title}\nCategory: ${resource.Category || 'General'}\nSkills Taught: ${resource.Skills_Taught || 'Not specified'}\nDescription: ${resource.Description || ''}`;
            }
          }

          const taskPrompt = `You are a Learning & Development specialist creating practice tasks for a Virtual Assistant.

${concept ? `CONCEPT LEARNED: ${concept}\nConfidence Level: ${confidenceScore}%` : ''}
${gap ? `KNOWLEDGE GAP IDENTIFIED: ${gap}` : ''}
${trainingContext}

Generate a professional, actionable task that:
1. Reinforces the learned concept OR addresses the identified gap
2. Has a clear, specific deliverable (what they will produce/create)
3. Includes step-by-step guidance
4. Defines success criteria
5. Is appropriate for confidence level ${confidenceScore}%

Return JSON with:
- "title": Clear, concise task title (max 60 chars)
- "description": Detailed task description with steps and context
- "deliverable": Specific output expected (e.g., "A 1-page SOP document", "A GoHighLevel workflow diagram", "3 completed customer onboarding sequences")
- "steps": Array of 3-5 specific action steps
- "successCriteria": Array of 2-3 measurable success criteria
- "estimatedTime": Estimated completion time in minutes
- "difficulty": "beginner", "intermediate", or "advanced" based on confidence

Format: JSON only, no markdown.`;

          const completion = await openai.chat.completions.create({
            messages: [
              { role: "system", content: "You are an expert Learning & Development specialist. Always respond with valid JSON." },
              { role: "user", content: taskPrompt }
            ],
            model: "gpt-4o",
            response_format: { type: "json_object" }
          });

          try {
            const taskData = JSON.parse(completion.choices[0].message.content || '{}');
            result = taskData;
          } catch (e) {
            result = { error: 'Failed to parse AI response' };
          }
        } catch (aiError: any) {
          result = { error: `AI generation failed: ${aiError.message}` };
        }
        break;

      case 'archiveCandidate':
        const candidateId = searchParams.get('candidateId');
        // In a real DB, we might just set a status flag instead of moving tables
        if (candidateId) {
          const { data: updatedCandidate } = await getSupabase()
            .from('Candidate_Master')
            .update({ Current_Stage: 'ARCHIVED' })
            .eq('Candidate_ID', candidateId)
            .select()
            .single();
          result = updatedCandidate;
        }
        break;

      case 'upcomingMeetings':
        // Get meetings scheduled in the future or today
        const nowUpdate = new Date().toISOString();
        const { data: upcomingMeetings } = await getSupabase()
          .from('Meetings')
          .select(`
            *,
            candidate:Candidate_Master(
              Candidate_ID,
              First_Name,
              Last_Name,
              Phone,
              Email
            ),
            attendees:Meeting_Attendees(*)
          `)
          .gte('Scheduled_At', new Date().toISOString())
          .in('Status', ['SCHEDULED', 'RESCHEDULED'])
          .order('Scheduled_At', { ascending: true })
          .limit(20);
        result = upcomingMeetings;
        break;

      case 'meetingHistory':
        // Get past/completed meetings
        const historyLimit = parseInt(searchParams.get('limit') || '50');
        const { data: meetingHistory } = await getSupabase()
          .from('Meetings')
          .select(`
            *,
            candidate:Candidate_Master(
              Candidate_ID,
              First_Name,
              Last_Name,
              Phone
            )
          `)
          .in('Status', ['COMPLETED', 'CANCELLED', 'NO_SHOW'])
          .order('Completed_At', { ascending: false })
          .limit(historyLimit);
        result = meetingHistory;
        break;

      case 'meeting':
        // Get single meeting by ID
        const meetingId = searchParams.get('meetingId');
        if (meetingId) {
          const { data: meeting } = await getSupabase()
            .from('Meetings')
            .select(`
              *,
              candidate:Candidate_Master(*),
              attendees:Meeting_Attendees(*)
            `)
            .eq('Meeting_ID', meetingId)
            .single();
          result = meeting;
        }
        break;

      case 'availableSlots':
        // Calculate next 5 available meeting slots
        // Simple implementation: suggest next 5 business days at 10am, 2pm, 4pm
        const availableSlots = [];
        const availableSlotsStartDate = new Date();
        availableSlotsStartDate.setDate(availableSlotsStartDate.getDate() + 1); // Tomorrow
        
        // Get existing meetings to avoid conflicts
        const { data: existingMeetings } = await getSupabase()
          .from('Meetings')
          .select('Scheduled_At, Duration_Minutes')
          .gte('Scheduled_At', availableSlotsStartDate.toISOString())
          .in('Status', ['SCHEDULED', 'RESCHEDULED']);
        
        const existingTimes = (existingMeetings || []).map(m => new Date(m.Scheduled_At).getTime());
        
        for (let day = 0; day < 7; day++) {
          const date = new Date(availableSlotsStartDate);
          date.setDate(date.getDate() + day);
          
          // Skip weekends
          if (date.getDay() === 0 || date.getDay() === 6) continue;
          
          // Morning slot (10 AM)
          const morning = new Date(date);
          morning.setHours(10, 0, 0, 0);
          if (!existingTimes.includes(morning.getTime())) {
            availableSlots.push({
              start: morning.toISOString(),
              end: new Date(morning.getTime() + 30 * 60000).toISOString()
            });
          }
          
          // Afternoon slot (2 PM)
          const afternoon = new Date(date);
          afternoon.setHours(14, 0, 0, 0);
          if (!existingTimes.includes(afternoon.getTime())) {
            availableSlots.push({
              start: afternoon.toISOString(),
              end: new Date(afternoon.getTime() + 30 * 60000).toISOString()
            });
          }
          
          // Evening slot (4 PM)
          const evening = new Date(date);
          evening.setHours(16, 0, 0, 0);
          if (!existingTimes.includes(evening.getTime())) {
            availableSlots.push({
              start: evening.toISOString(),
              end: new Date(evening.getTime() + 30 * 60000).toISOString()
            });
          }
          
          if (availableSlots.length >= 5) break;
        }
        
        result = { slots: availableSlots.slice(0, 5) };
        break;

      case 'submitTrainingCompletion':
        const s_resourceId = searchParams.get('resourceId');
        const s_vaName = searchParams.get('vaName');
        const s_notes = searchParams.get('notes');
        const s_rating = parseInt(searchParams.get('rating') || '0');
        const s_timeSpent = parseInt(searchParams.get('timeSpent') || '0');

        if (!s_resourceId || !s_vaName || !s_notes) {
          throw new Error('Missing required fields');
        }

        // 1. Fetch Resource Details
        const { data: resource } = await supabaseMgmt
          .from('Training_Resources')
          .select('*')
          .eq('Resource_ID', s_resourceId)
          .single();

        if (!resource) throw new Error('Resource not found');

        // 2. AI Analysis
        let aiAnalysis = {
          concepts: [],
          gaps: [],
          confidence: 0,
          raw: ''
        };

        if (openai) {
          const completion = await openai.chat.completions.create({
            messages: [
              { role: "system", content: "You are an expert Learning & Development Analyst. Analyze the student's notes against the training material to assess comprehension." },
              { role: "user", content: `
                TRAINING TITLE: ${resource.Title}
                EXPECTED SKILLS: ${resource.Skills_Taught || 'General Knowledge'}
                
                STUDENT NOTES:
                ${s_notes}
                
                Analyze the notes and return a JSON object with:
                1. "concepts": Array of specific skills/concepts demonstrated in the notes.
                2. "gaps": Array of missing concepts or misunderstandings.
                3. "confidence": Integer 0-100 representing mastery level.
                4. "feedback": Brief constructive feedback.
              ` }
            ],
            model: "gpt-4o",
            response_format: { type: "json_object" }
          });
          
          const content = completion.choices[0].message.content;
          if (content) {
            const parsed = JSON.parse(content);
            aiAnalysis = {
              concepts: parsed.concepts || [],
              gaps: parsed.gaps || [],
              confidence: parsed.confidence || 0,
              raw: content
            };
          }
        }

        // 3. Insert Completion
        const { data: newCompletion, error: insertError } = await supabaseMgmt
          .from('Training_Completions')
          .insert({
            Resource_ID: s_resourceId,
            Completed_By: s_vaName,
            Notes_Learned: s_notes,
            Comprehension_Rating: s_rating,
            Time_Spent_Minutes: s_timeSpent,
            AI_Extracted_Concepts: JSON.stringify(aiAnalysis.concepts),
            AI_Knowledge_Gaps: JSON.stringify(aiAnalysis.gaps),
            AI_Confidence_Score: aiAnalysis.confidence,
            AI_Analysis_Raw: aiAnalysis.raw
          })
          .select()
          .single();

        if (insertError) throw insertError;

        // 4. Update Profile (Simplified)
        // In a real app, we'd recalculate the whole profile here
        
        result = newCompletion;
        break;

      case 'addTrainingResource':
        const t_title = searchParams.get('title');
        const t_url = searchParams.get('url');
        const t_category = searchParams.get('category');
        const t_desc = searchParams.get('description');

        if (!t_title || !t_url) throw new Error('Missing title or URL');

        // AI Scan for Skills
        let t_skills = 'General';
        let t_difficulty = 'BEGINNER';
        let t_minutes = 15;

        if (openai && t_desc) {
           const completion = await openai.chat.completions.create({
            messages: [
              { role: "system", content: "Extract metadata from training description." },
              { role: "user", content: `Title: ${t_title}\nDescription: ${t_desc}\n\nReturn JSON: { "skills": "comma, separated, list", "difficulty": "BEGINNER/INTERMEDIATE/ADVANCED", "minutes": integer }` }
            ],
            model: "gpt-4o",
            response_format: { type: "json_object" }
          });
          const parsed = JSON.parse(completion.choices[0].message.content || '{}');
          t_skills = parsed.skills || t_skills;
          t_difficulty = parsed.difficulty || t_difficulty;
          t_minutes = parsed.minutes || t_minutes;
        }

        const { data: newResource } = await supabaseMgmt
          .from('Training_Resources')
          .insert({
            Title: t_title,
            URL: t_url,
            Category: t_category || 'General',
            Description: t_desc,
            Skills_Taught: t_skills,
            Difficulty_Level: t_difficulty,
            Estimated_Minutes: t_minutes
          })
          .select()
          .single();
        
        result = newResource;
        break;

      // Funnel Tracking Endpoints
      case 'stats':
        // Get overall stats from h2s_tracking_events
        const { data: events } = await getTrackingDb()
          .from('h2s_tracking_events')
          .select('session_id, visitor_id, occurred_at');

        let statsEvents = excludeTest ? (events || []).filter((e: any) => !isTestTrackingEvent(e)) : (events || []);
        if (excludeInternal) statsEvents = statsEvents.filter((e: any) => !isInternalTrackingPathFromEvent(e, customPathRules));
        
        const uniqueSessions = new Set(statsEvents.map((e: any) => e.session_id).filter(Boolean) || []).size;
        const uniqueUsers = new Set(statsEvents.map((e: any) => e.visitor_id).filter(Boolean) || []).size;
        const totalEvents = statsEvents.length || 0;
        
        // Last 24 hours activity
        const twentyFourHoursAgoStats = new Date();
        twentyFourHoursAgoStats.setHours(twentyFourHoursAgoStats.getHours() - 24);
        const recentEvents = statsEvents.filter((e: any) => new Date(e.occurred_at) >= twentyFourHoursAgoStats).length || 0;
        
        result = {
          unique_sessions: uniqueSessions,
          unique_users: uniqueUsers,
          total_events: totalEvents,
          events_last_24h: recentEvents
        };
        break;

      case 'revenue':
        // Revenue should come from Orders (source of truth), not inferred from tracking events.
        // This aligns with the “Orders tab” / business ledger and avoids event noise/duplication.
        const mainDb = getSupabase();
        if (!mainDb) {
          result = {
            total_revenue: 0,
            total_orders: 0,
            average_order_value: 0,
            revenue_last_30_days: 0,
            revenue_by_source: {},
            source: 'orders',
            warning: 'Main database client not configured',
          };
          break;
        }

        type OrderRow = {
          id?: any;
          order_id?: any;
          session_id?: any;
          created_at?: any;
          utm_source?: any;
          utm_campaign?: any;
          total?: any;
          subtotal?: any;
          order_total?: any;
          order_subtotal?: any;
          customer_email?: any;
          customer_phone?: any;
          metadata_json?: any;
          metadata?: any;
        };

        let orders: OrderRow[] = [];
        try {
          orders = await fetchAllRows<OrderRow>((from, to) =>
            mainDb
              .from('h2s_orders')
              .select('id,order_id,session_id,created_at,total,subtotal,order_total,order_subtotal,customer_email,customer_phone,metadata_json,metadata')
              .order('created_at', { ascending: false })
              .range(from, to)
          );
        } catch (e: any) {
          // In case some columns don't exist in the table yet, fall back to selecting *.
          try {
            orders = await fetchAllRows<OrderRow>((from, to) =>
              mainDb.from('h2s_orders').select('*').order('created_at', { ascending: false }).range(from, to)
            );
          } catch (e2: any) {
            result = {
              ok: false,
              error: e2?.message || e?.message || 'Failed to query h2s_orders',
              total_revenue: 0,
              total_orders: 0,
              average_order_value: 0,
              revenue_last_30_days: 0,
              revenue_by_source: {},
              source: 'orders',
            };
            break;
          }
        }

        let ordersFiltered = excludeTest ? orders.filter((o) => !isTestOrderRow(o)) : orders;

        // Only count orders that have positive revenue after normalization.
        const normalizedRows = ordersFiltered
          .map((o) => {
            const meta = extractOrderMeta(o);
            const utm_source =
              String(o?.utm_source ?? meta?.utm_source ?? meta?.utm?.source ?? meta?.source ?? 'direct') || 'direct';
            const created = o?.created_at || meta?.created_at || null;
            const amount = computeOrderRevenueAmount(o);
            return { amount, created_at: created, utm_source: utm_source || 'direct' };
          })
          .filter((r) => r.amount > 0);

        const totalRevenue = normalizedRows.reduce((sum, r) => sum + r.amount, 0);
        const transactionCount = normalizedRows.length;
        const avgTransaction = transactionCount > 0 ? totalRevenue / transactionCount : 0;

        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const revenueLast30Days = normalizedRows
          .filter((r) => {
            const t = r.created_at ? new Date(r.created_at).getTime() : NaN;
            return Number.isFinite(t) && t >= thirtyDaysAgo.getTime();
          })
          .reduce((sum, r) => sum + r.amount, 0);

        const revenueBySource: Record<string, number> = {};
        for (const r of normalizedRows) {
          const source = String(r.utm_source || 'direct').trim() || 'direct';
          revenueBySource[source] = (revenueBySource[source] || 0) + r.amount;
        }

        result = {
          total_revenue: totalRevenue,
          total_orders: transactionCount,
          average_order_value: avgTransaction,
          revenue_last_30_days: revenueLast30Days,
          revenue_by_source: revenueBySource,
          source: 'orders',
        };
        break;

      case 'revenue_events':
        // Optional/debug: revenue inferred from tracking purchase events.
        // Prefer action=revenue (orders) for business-truth reporting.
        const { data: purchaseEventsRevenue } = await getTrackingDb()
          .from('h2s_tracking_events')
          .select('revenue_amount, occurred_at, order_id, customer_email, utm_source, utm_campaign, page_path')
          .not('revenue_amount', 'is', null)
          .eq('event_type', 'purchase');

        let revenueEvents = excludeTest
          ? (purchaseEventsRevenue || []).filter((e: any) => !isTestTrackingEvent(e))
          : (purchaseEventsRevenue || []);
        if (excludeInternal) revenueEvents = revenueEvents.filter((e: any) => !isInternalTrackingPathFromEvent(e, customPathRules));

        const totalRevenueEvents =
          revenueEvents.reduce((sum: number, e: any) => sum + normalizeRevenueAmount(e.revenue_amount), 0) || 0;
        const transactionCountEvents = revenueEvents.length || 0;
        const avgTransactionEvents = transactionCountEvents > 0 ? totalRevenueEvents / transactionCountEvents : 0;

        const thirtyDaysAgoEvents = new Date();
        thirtyDaysAgoEvents.setDate(thirtyDaysAgoEvents.getDate() - 30);
        const recentPurchases = revenueEvents.filter((e: any) => new Date(e.occurred_at) >= thirtyDaysAgoEvents) || [];
        const revenueLast30DaysEvents = recentPurchases.reduce(
          (sum: number, e: any) => sum + normalizeRevenueAmount(e.revenue_amount),
          0
        );

        const revenueBySourceEvents: Record<string, number> = {};
        revenueEvents.forEach((e: any) => {
          const source = e.utm_source || 'direct';
          revenueBySourceEvents[source] = (revenueBySourceEvents[source] || 0) + normalizeRevenueAmount(e.revenue_amount);
        });

        result = {
          total_revenue: totalRevenueEvents,
          total_orders: transactionCountEvents,
          average_order_value: avgTransactionEvents,
          revenue_last_30_days: revenueLast30DaysEvents,
          revenue_by_source: revenueBySourceEvents,
          source: 'events',
        };
        break;

      case 'cohorts':
        // Calculate user cohorts from h2s_tracking_events
        const { data: cohortEvents } = await getTrackingDb()
          .from('h2s_tracking_events')
          .select('visitor_id, event_type, occurred_at, customer_email')
          .order('occurred_at', { ascending: false })
          .limit(10000);

        let cohortEventsFiltered = excludeTest ? (cohortEvents || []).filter((e: any) => !isTestTrackingEvent(e)) : (cohortEvents || []);
        if (excludeInternal) cohortEventsFiltered = cohortEventsFiltered.filter((e: any) => !isInternalTrackingPathFromEvent(e, customPathRules));
        
        // Group by visitor and determine their stage
        const visitorCohorts = new Map<string, any>();
        
        cohortEventsFiltered.forEach((event: any) => {
          // Use email as canonical identifier if available, else visitor_id
          // This ensures same user across devices is counted once
          const canonicalUserId = event.customer_email 
            ? `email:${event.customer_email.toLowerCase().trim()}` 
            : event.visitor_id 
            ? `visitor:${event.visitor_id}` 
            : null;
          
          if (!canonicalUserId) return;
          
          if (!visitorCohorts.has(canonicalUserId)) {
            visitorCohorts.set(canonicalUserId, {
              visitor_id: event.visitor_id,
              customer_email: event.customer_email || null,
              first_seen: event.occurred_at,
              last_seen: event.occurred_at,
              stage: 'visitor',
              event_count: 0
            });
          }
          
          const cohort = visitorCohorts.get(canonicalUserId);
          cohort.event_count += 1;
          
          // Update stage based on event type
          if (event.event_type === 'purchase') {
            cohort.stage = 'customer';
          } else if ((event.event_type === 'lead' || event.event_type === 'complete_registration') && cohort.stage !== 'customer') {
            cohort.stage = 'lead';
          } else if (event.event_type === 'view_content' && cohort.stage === 'visitor') {
            cohort.stage = 'browser';
          }
          
          const eventDate = new Date(event.occurred_at);
          if (eventDate > new Date(cohort.last_seen)) {
            cohort.last_seen = event.occurred_at;
          }
          if (eventDate < new Date(cohort.first_seen)) {
            cohort.first_seen = event.occurred_at;
          }
        });
        
        // Aggregate by stage
        const userCohorts: Record<string, number> = {
          visitor: 0,
          browser: 0,
          engaged: 0,
          lead: 0,
          customer: 0
        };
        
        visitorCohorts.forEach(cohort => {
          const stage = cohort.stage || 'visitor';
          if (userCohorts.hasOwnProperty(stage)) {
            userCohorts[stage] += 1;
          }
        });
        
        result = {
          total_users: visitorCohorts.size,
          user_cohorts: userCohorts,
          cohorts: Array.from(visitorCohorts.values()).slice(0, 100)
        };
        break;

      case 'meta_pixel_events':
        // Query Database 1 directly (h2s_tracking_events table)
        let allEvents;
        let totalEventsInDatabase = 0;
        const db1Client = getTrackingDb();
        
        if (db1Client) {
          // Build query with date filters
          let countQuery = db1Client
            .from('h2s_tracking_events')
            .select('*', { count: 'exact', head: true });
          
          // Apply date range filters at database level for accurate counts
          if (minDate) {
            countQuery = countQuery.gte('occurred_at', minDate);
          }
          if (startDate) {
            countQuery = countQuery.gte('occurred_at', startDate);
          }
          if (endDate) {
            countQuery = countQuery.lte('occurred_at', endDate);
          }
          
          // FIRST: Get filtered count
          const { count: dbCount, error: countError } = await countQuery;
          
          if (!countError && typeof dbCount === 'number') {
            totalEventsInDatabase = dbCount;
          }
          
          // THEN: Query events with same filters (limited for performance)
          let eventQuery = db1Client
            .from('h2s_tracking_events')
            .select('*')
            .order('occurred_at', { ascending: false });
          
          if (minDate) eventQuery = eventQuery.gte('occurred_at', minDate);
          if (startDate) eventQuery = eventQuery.gte('occurred_at', startDate);
          if (endDate) eventQuery = eventQuery.lte('occurred_at', endDate);
          
          const { data: events, error } = await eventQuery.limit(10000);
          
          if (!error && events) {
            allEvents = events;
          } else if (error) {
            console.error('Error querying Database 1:', error);
          }
        } else {
          console.warn('Database 1 client not available - cannot query h2s_tracking_events');
        }
        
        // If Database 1 query failed or unavailable, return empty result (don't fall back to Database 2)
        if (!allEvents) {
          allEvents = [];
          console.warn('No events found from Database 1 - returning empty result');
        }
        
        const eventTypes: Record<string, any> = {};
        // IMPORTANT:
        // FunnelTrack "Total Conversion Value" should be PURCHASE revenue only.
        // Keep a separate all-events tally for debugging/investigation.
        let totalValueAllEvents = 0;
        let totalValuePurchaseEvents = 0;
        let totalValuePurchaseEventsUnattributed = 0;
        const revenueEventsDebug: Array<any> = [];
        const uniqueSessionsSet = new Set<string>();
        const uniqueUsersSet = new Set<string>();
        const pagePaths: Record<string, number> = {};
        const referrers: Record<string, number> = {};
        const clickedElements: Record<string, number> = {};
        const byPageType: Record<string, number> = {};
        const byUtmSource: Record<string, number> = {};
        const byUtmMedium: Record<string, number> = {};
        const byUtmCampaign: Record<string, number> = {};
        const customerEmails = new Set<string>();
        const customerPhones = new Set<string>();
        
        if (excludeTest) {
          allEvents = (allEvents || []).filter((e: any) => !isTestTrackingEvent(e));
        }
        if (excludeInternal) {
          allEvents = (allEvents || []).filter((e: any) => !isInternalTrackingPathFromEvent(e, customPathRules));
        }

        // Filter to intentional/allowlisted event types.
        // Also normalize legacy variants (pageview/viewcontent/button_click) to canonical.
        const totalEventsBeforeAllowlist = (allEvents || []).length;
        const ignoredEventTypes: Record<string, number> = {};
        allEvents = (allEvents || []).filter((event: any) => {
          const rawEventType = event.event_type || event.event_name || '';
          const eventType = normalizeTrackingEventType(rawEventType);
          if (isAllowedTrackingEventType(eventType)) return true;
          if (debug) {
            const key = eventType || 'unknown';
            ignoredEventTypes[key] = (ignoredEventTypes[key] || 0) + 1;
          }
          return false;
        });

        // By default, only count purchase revenue when it is attributable.
        // Override for investigations with include_unattributed_purchases=1.
        const includeUnattributedPurchases = searchParams.get('include_unattributed_purchases') === '1';

        allEvents?.forEach((event: any) => {
          // Event type breakdown (support both event_type and event_name fields)
          // Normalize to lowercase for consistent matching across all event types
          const rawEventType = event.event_type || event.event_name || 'unknown';
          const eventType = normalizeTrackingEventType(rawEventType);
          if (!eventTypes[eventType]) {
            eventTypes[eventType] = { count: 0, revenue: 0 };
          }
          eventTypes[eventType].count++;

          // Only count conversion value from PURCHASE events.
          // Some rows may contain revenue_amount on non-purchase events due to historical bugs.
          const rev = normalizeRevenueAmount(event.revenue_amount);
          if (rev > 0) {
            totalValueAllEvents += rev;

            if (eventType === 'purchase') {
              const hasAttribution =
                !!(event.order_id && String(event.order_id).trim()) ||
                !!(event.job_id && String(event.job_id).trim()) ||
                !!(event.customer_email && String(event.customer_email).trim());

              if (includeUnattributedPurchases || hasAttribution) {
                eventTypes[eventType].revenue += rev;
                totalValuePurchaseEvents += rev;
              } else {
                totalValuePurchaseEventsUnattributed += rev;
              }
            }

            if (debug) {
              revenueEventsDebug.push({
                event_id: event.event_id,
                occurred_at: event.occurred_at,
                event_type: event.event_type,
                event_name: event.event_name,
                page_path: event.page_path,
                order_id: event.order_id,
                job_id: event.job_id,
                customer_email: event.customer_email,
                revenue_amount_raw: event.revenue_amount,
                revenue_amount_normalized: rev,
                counted_as_purchase: eventType === 'purchase',
                counted_in_total:
                  eventType !== 'purchase'
                    ? false
                    : includeUnattributedPurchases
                      ? true
                      : !!(
                          (event.order_id && String(event.order_id).trim()) ||
                          (event.job_id && String(event.job_id).trim()) ||
                          (event.customer_email && String(event.customer_email).trim())
                        )
              });
            }
          }
          
          // Sessions and users
          if (event.session_id) uniqueSessionsSet.add(event.session_id);
          if (event.visitor_id) uniqueUsersSet.add(event.visitor_id);
          
          // Page path analysis
          if (event.page_path) {
            pagePaths[event.page_path] = (pagePaths[event.page_path] || 0) + 1;
          }
          
          // Referrer tracking
          if (event.referrer && event.referrer !== '(direct)') {
            try {
              const referrerDomain = new URL(event.referrer).hostname;
              referrers[referrerDomain] = (referrers[referrerDomain] || 0) + 1;
            } catch {
              referrers[event.referrer] = (referrers[event.referrer] || 0) + 1;
            }
          } else if (event.referrer === '(direct)') {
            referrers['direct'] = (referrers['direct'] || 0) + 1;
          }
          
          // Click tracking (element_id/element_text)
          if (event.element_id || event.element_text) {
            const elementKey = event.element_id || event.element_text;
            clickedElements[elementKey] = (clickedElements[elementKey] || 0) + 1;
          }
          
          // Extract page_type from metadata if available
          // Handle both JSON string and object formats
          let metadata = event.metadata;
          if (metadata && typeof metadata === 'string') {
            try {
              metadata = JSON.parse(metadata);
            } catch (e) {
              // If parsing fails, skip metadata extraction
              metadata = null;
            }
          }
          if (metadata && typeof metadata === 'object') {
            const pageType = metadata.page_type || metadata.pageType;
            if (pageType) {
              byPageType[pageType] = (byPageType[pageType] || 0) + 1;
            }
          }
          
          // UTM tracking
          if (event.utm_source) {
            byUtmSource[event.utm_source] = (byUtmSource[event.utm_source] || 0) + 1;
          }
          if (event.utm_medium) {
            byUtmMedium[event.utm_medium] = (byUtmMedium[event.utm_medium] || 0) + 1;
          }
          if (event.utm_campaign) {
            byUtmCampaign[event.utm_campaign] = (byUtmCampaign[event.utm_campaign] || 0) + 1;
          }
          
          // Customer identification
          if (event.customer_email) customerEmails.add(event.customer_email);
          if (event.customer_phone) customerPhones.add(event.customer_phone);
        });
        
        // Calculate page path performance scores (views, engagement, conversions, revenue)
        const pagePathScores: Record<string, any> = {};
        
        allEvents?.forEach((event: any) => {
          if (event.page_path) {
            // Support both event_type and event_name fields
            // Normalize to lowercase for consistent matching
            const rawEventType = event.event_type || event.event_name || '';
            const eventType = normalizeTrackingEventType(rawEventType);
            
            if (!pagePathScores[event.page_path]) {
              pagePathScores[event.page_path] = {
                views: 0,
                engagement: 0,
                leads: 0,
                purchases: 0,
                revenue: 0
              };
            }
            
            if (eventType === 'page_view') {
              pagePathScores[event.page_path].views += 1;
            }
            if (eventType === 'view_content') {
              pagePathScores[event.page_path].engagement += 1;
            }
            if (eventType === 'lead' || eventType === 'complete_registration') {
              pagePathScores[event.page_path].leads += 1;
            }
            if (eventType === 'purchase') {
              pagePathScores[event.page_path].purchases += 1;
              const rev = normalizeRevenueAmount(event.revenue_amount);
              pagePathScores[event.page_path].revenue += rev;
            }
          }
        });
        
        // Score pages: weighted score = (views * 1) + (engagement * 2) + (leads * 5) + (purchases * 10) + (revenue / 10)
        const scoredPages = Object.entries(pagePathScores).map(([path, metrics]: [string, any]) => {
          const score = (metrics.views * 1) + 
                       (metrics.engagement * 2) + 
                       (metrics.leads * 5) + 
                       (metrics.purchases * 10) + 
                       (metrics.revenue / 10);
          const conversionRate = metrics.views > 0 ? ((metrics.leads + metrics.purchases) / metrics.views * 100) : 0;
          return {
            path,
            score: Math.round(score),
            views: metrics.views,
            engagement: metrics.engagement,
            leads: metrics.leads,
            purchases: metrics.purchases,
            revenue: metrics.revenue,
            conversion_rate: Number(conversionRate.toFixed(2))
          };
        }).sort((a, b) => b.score - a.score);
        
        // Get latest event timestamp (events are already sorted DESC by occurred_at)
        const latestEventTimestamp = allEvents && allEvents.length > 0 
          ? (allEvents[0].occurred_at || allEvents[0].created_at) 
          : null;
        
        // Sort top items
        const topPagePaths = Object.entries(pagePaths)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .reduce((acc, [path, count]) => ({ ...acc, [path]: count }), {});
        
        const topReferrers = Object.entries(referrers)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .reduce((acc, [ref, count]) => ({ ...acc, [ref]: count }), {});
        
        const topClickedElements = Object.entries(clickedElements)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .reduce((acc, [elem, count]) => ({ ...acc, [elem]: count }), {});
        
        // Generate insights
        const insights = [];
        if (scoredPages.length > 0) {
          const topPage = scoredPages[0];
          insights.push({
            type: 'top_performer',
            message: `"${topPage.path}" is your top performing page with ${topPage.views} views, ${topPage.leads} leads, and $${topPage.revenue.toFixed(2)} revenue.`,
            score: topPage.score
          });
        }
        
        const avgConversionRate = scoredPages.length > 0 
          ? scoredPages.reduce((sum, p) => sum + p.conversion_rate, 0) / scoredPages.length 
          : 0;
        if (avgConversionRate > 0) {
          insights.push({
            type: 'conversion_health',
            message: `Average conversion rate across all pages: ${avgConversionRate.toFixed(1)}%`,
            score: avgConversionRate
          });
        }
        
        const topSource = Object.entries(byUtmSource).sort((a, b) => b[1] - a[1])[0];
        if (topSource) {
          insights.push({
            type: 'traffic_source',
            message: `"${topSource[0]}" drives ${topSource[1]} events (${((topSource[1] / (allEvents?.length || 1)) * 100).toFixed(1)}% of total traffic)`,
            score: topSource[1]
          });
        }
        
        // Calculate TRUE unique users: use email as canonical identifier if available, else visitor_id
        // This prevents counting same user multiple times across devices/browsers
        const canonicalUsers = new Set<string>();
        allEvents?.forEach((event: any) => {
          if (event.customer_email) {
            // Use normalized email as canonical identifier
            canonicalUsers.add(`email:${event.customer_email.toLowerCase().trim()}`);
          } else if (event.visitor_id) {
            // Fall back to visitor_id if no email
            canonicalUsers.add(`visitor:${event.visitor_id}`);
          }
        });
        const uniqueUsersCanonical = canonicalUsers.size;
        
        // ENHANCED ANALYTICS: Time-based breakdowns and trends
        // When a custom end_date is provided, compute "recent" windows relative to that
        // so the context card stays consistent with the selected time range.
        const now = endDate ? new Date(endDate) : new Date();
        const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const thirtyDaysAgoAnalytics = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        
        // Track metrics by time period
        const eventsLast24h = (allEvents || []).filter((e: any) => new Date(e.occurred_at) >= oneDayAgo);
        const eventsLast7d = (allEvents || []).filter((e: any) => new Date(e.occurred_at) >= sevenDaysAgo);
        const eventsLast30d = (allEvents || []).filter((e: any) => new Date(e.occurred_at) >= thirtyDaysAgoAnalytics);
        
        // Unique users by time period
        const usersLast24h = new Set<string>();
        const usersLast7d = new Set<string>();
        const usersLast30d = new Set<string>();
        
        eventsLast24h.forEach((e: any) => {
          const id = e.customer_email ? `email:${e.customer_email.toLowerCase()}` : `visitor:${e.visitor_id}`;
          if (id) usersLast24h.add(id);
        });
        eventsLast7d.forEach((e: any) => {
          const id = e.customer_email ? `email:${e.customer_email.toLowerCase()}` : `visitor:${e.visitor_id}`;
          if (id) usersLast7d.add(id);
        });
        eventsLast30d.forEach((e: any) => {
          const id = e.customer_email ? `email:${e.customer_email.toLowerCase()}` : `visitor:${e.visitor_id}`;
          if (id) usersLast30d.add(id);
        });
        
        // Calculate daily averages and growth rates
        const oldestEventDate = allEvents && allEvents.length > 0 
          ? new Date(allEvents[allEvents.length - 1].occurred_at)
          : now;
        const daysSinceFirstEvent = Math.max(1, Math.floor((now.getTime() - oldestEventDate.getTime()) / (24 * 60 * 60 * 1000)));
        const avgEventsPerDay = (allEvents?.length || 0) / daysSinceFirstEvent;
        const avgUsersPerDay = uniqueUsersCanonical / daysSinceFirstEvent;
        
        // Session engagement metrics
        const sessionEngagement: Record<string, {events: number; duration_minutes?: number; converted: boolean}> = {};
        (allEvents || []).forEach((e: any) => {
          if (!e.session_id) return;
          if (!sessionEngagement[e.session_id]) {
            sessionEngagement[e.session_id] = { events: 0, converted: false };
          }
          sessionEngagement[e.session_id].events++;
          
          const eventType = normalizeTrackingEventType(e.event_type || e.event_name);
          if (eventType === 'purchase' || eventType === 'lead') {
            sessionEngagement[e.session_id].converted = true;
          }
        });
        
        // Calculate session stats
        const sessionEvents = Object.values(sessionEngagement).map(s => s.events);
        const avgEventsPerSession = sessionEvents.length > 0 
          ? sessionEvents.reduce((sum, n) => sum + n, 0) / sessionEvents.length 
          : 0;
        const convertedSessions = Object.values(sessionEngagement).filter(s => s.converted).length;
        const sessionConversionRate = uniqueSessionsSet.size > 0 
          ? (convertedSessions / uniqueSessionsSet.size) * 100 
          : 0;
        
        // Funnel analysis: page_view -> engagement -> lead -> purchase
        const funnelMetrics = {
          page_views: (eventTypes['page_view']?.count || 0),
          engagement_events: (eventTypes['view_content']?.count || 0) + (eventTypes['scroll_depth']?.count || 0),
          leads: (eventTypes['lead']?.count || 0) + (eventTypes['cta_click']?.count || 0),
          purchases: (eventTypes['purchase']?.count || 0)
        };
        
        // Calculate funnel drop-off rates
        const funnelDropoff = {
          view_to_engage: funnelMetrics.page_views > 0 
            ? ((funnelMetrics.page_views - funnelMetrics.engagement_events) / funnelMetrics.page_views * 100) 
            : 0,
          engage_to_lead: funnelMetrics.engagement_events > 0 
            ? ((funnelMetrics.engagement_events - funnelMetrics.leads) / funnelMetrics.engagement_events * 100) 
            : 0,
          lead_to_purchase: funnelMetrics.leads > 0 
            ? ((funnelMetrics.leads - funnelMetrics.purchases) / funnelMetrics.leads * 100) 
            : 0
        };
        
        // Top converting traffic sources
        const sourceConversions: Record<string, {events: number; conversions: number; revenue: number}> = {};
        (allEvents || []).forEach((e: any) => {
          const source = e.utm_source || 'direct';
          if (!sourceConversions[source]) {
            sourceConversions[source] = { events: 0, conversions: 0, revenue: 0 };
          }
          sourceConversions[source].events++;
          
          const eventType = normalizeTrackingEventType(e.event_type || e.event_name);
          if (eventType === 'purchase') {
            sourceConversions[source].conversions++;
            sourceConversions[source].revenue += normalizeRevenueAmount(e.revenue_amount);
          }
        });
        
        const topConvertingSources = Object.entries(sourceConversions)
          .map(([source, data]) => ({
            source,
            events: data.events,
            conversions: data.conversions,
            revenue: data.revenue,
            conversion_rate: data.events > 0 ? (data.conversions / data.events * 100) : 0,
            revenue_per_event: data.events > 0 ? data.revenue / data.events : 0
          }))
          .sort((a, b) => b.revenue - a.revenue)
          .slice(0, 10);
        
        const totalValue = totalValuePurchaseEvents;

        result = {
          summary: {
            // Core metrics
            total_events: allEvents?.length || 0,
            total_events_in_database: totalEventsInDatabase,
            unique_sessions: uniqueSessionsSet.size,
            unique_users: uniqueUsersCanonical,
            unique_users_by_visitor_id: uniqueUsersSet.size,
            unique_customers_with_email: customerEmails.size,
            unique_customers_with_phone: customerPhones.size,
            total_revenue: totalValue,
            
            // Time context
            tracking_period: {
              first_event_date: oldestEventDate.toISOString(),
              latest_event_date: latestEventTimestamp,
              days_tracked: daysSinceFirstEvent,
              time_range_label: daysSinceFirstEvent === 1 
                ? 'Last 24 hours' 
                : daysSinceFirstEvent <= 7 
                  ? `Last ${daysSinceFirstEvent} days` 
                  : daysSinceFirstEvent <= 30 
                    ? 'Last month' 
                    : `${daysSinceFirstEvent} days of data`
            },
            
            // Recent activity (context for "how recent")
            recent_activity: {
              events_last_24h: eventsLast24h.length,
              events_last_7d: eventsLast7d.length,
              events_last_30d: eventsLast30d.length,
              users_last_24h: usersLast24h.size,
              users_last_7d: usersLast7d.size,
              users_last_30d: usersLast30d.size
            },
            
            // Growth metrics
            growth_metrics: {
              avg_events_per_day: Number(avgEventsPerDay.toFixed(1)),
              avg_users_per_day: Number(avgUsersPerDay.toFixed(1)),
              user_acquisition_velocity: `${Number(avgUsersPerDay.toFixed(1))} users/day over ${daysSinceFirstEvent} days`
            },
            
            // Session engagement
            session_metrics: {
              total_sessions: uniqueSessionsSet.size,
              avg_events_per_session: Number(avgEventsPerSession.toFixed(1)),
              converted_sessions: convertedSessions,
              session_conversion_rate: Number(sessionConversionRate.toFixed(2)),
              engagement_quality: avgEventsPerSession >= 5 ? 'High' : avgEventsPerSession >= 3 ? 'Medium' : 'Low'
            },
            
            // Funnel performance
            funnel: {
              page_views: funnelMetrics.page_views,
              engagement_events: funnelMetrics.engagement_events,
              leads: funnelMetrics.leads,
              purchases: funnelMetrics.purchases,
              dropoff_rates: {
                view_to_engage_pct: Number(funnelDropoff.view_to_engage.toFixed(1)),
                engage_to_lead_pct: Number(funnelDropoff.engage_to_lead.toFixed(1)),
                lead_to_purchase_pct: Number(funnelDropoff.lead_to_purchase.toFixed(1))
              },
              overall_conversion_rate: funnelMetrics.page_views > 0 
                ? Number(((funnelMetrics.purchases / funnelMetrics.page_views) * 100).toFixed(2))
                : 0
            },
            
            // Traffic source performance
            top_converting_sources: topConvertingSources,
            
            by_event_type: eventTypes,
            latest_event_at: latestEventTimestamp
          },
          by_page_path: topPagePaths,
          by_referrer: topReferrers,
          by_page_type: byPageType,
          by_utm_source: byUtmSource,
          by_utm_medium: byUtmMedium,
          by_utm_campaign: byUtmCampaign,
          top_clicked_elements: topClickedElements,
          page_performance: scoredPages.slice(0, 10), // Top 10 performing pages
          insights: insights,
          events: allEvents?.slice(0, 100) || [], // Return sample for preview
          ...(debug
            ? {
                debug: {
                  total_events_before_allowlist: totalEventsBeforeAllowlist,
                  total_events_after_allowlist: allEvents?.length || 0,
                  ignored_event_types: ignoredEventTypes,
                  total_revenue_purchase_events: totalValuePurchaseEvents,
                  total_revenue_purchase_events_unattributed: totalValuePurchaseEventsUnattributed,
                  total_revenue_all_events: totalValueAllEvents,
                  include_unattributed_purchases: includeUnattributedPurchases,
                  top_revenue_events: revenueEventsDebug
                    .sort((a, b) => (b.revenue_amount_normalized || 0) - (a.revenue_amount_normalized || 0))
                    .slice(0, 100)
                }
              }
            : {})
        };
        break;

      case 'recent_purchases':
        {
          const auth = requireAdminToken(request);
          if (!auth.ok) {
            return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status, headers: corsHeaders(request) });
          }

          const limit = Math.max(1, Math.min(toInt(searchParams.get('limit'), 25), 100));
          const scanLimit = Math.max(limit, 250);

          const db1Client = getTrackingDb();
          const { data: events, error } = await db1Client
            .from('h2s_tracking_events')
            .select('*')
            .order('occurred_at', { ascending: false })
            .limit(Math.min(2000, scanLimit * 10));

          if (error) {
            return NextResponse.json(
              { ok: false, error: `Failed to load recent purchases: ${error.message}` },
              { status: 500, headers: corsHeaders(request) }
            );
          }

          let rows: any[] = events || [];
          if (excludeTest) rows = rows.filter((e: any) => !isTestTrackingEvent(e));
          if (excludeInternal) rows = rows.filter((e: any) => !isInternalTrackingPathFromEvent(e, customPathRules));

          const purchases = rows
            .filter((e: any) => normalizeTrackingEventType(e.event_type || e.event_name) === 'purchase')
            .slice(0, limit)
            .map((e: any) => {
              const revenue = normalizeRevenueAmount(e.revenue_amount);
              const hasAttribution =
                !!(e.order_id && String(e.order_id).trim()) ||
                !!(e.job_id && String(e.job_id).trim()) ||
                !!(e.customer_email && String(e.customer_email).trim());

              return {
                event_id: e.event_id,
                occurred_at: e.occurred_at,
                page_path: e.page_path,
                visitor_id: e.visitor_id,
                session_id: e.session_id,
                order_id: e.order_id,
                job_id: e.job_id,
                customer_email: e.customer_email,
                revenue_amount: revenue,
                has_attribution: hasAttribution
              };
            });

          result = {
            purchases,
            meta: {
              limit,
              returned: purchases.length,
              exclude_test: excludeTest,
              exclude_internal: excludeInternal
            }
          };
        }
        break;

      case 'funnel':
        // Calculate funnel stages from h2s_tracking_events based on event_type
        const { data: funnelEvents } = await getTrackingDb()
          .from('h2s_tracking_events')
          .select('event_type, event_name, visitor_id, session_id, occurred_at, customer_email, metadata');

        let funnelEventsFiltered = excludeTest ? (funnelEvents || []).filter((e: any) => !isTestTrackingEvent(e)) : (funnelEvents || []);
        if (excludeInternal) funnelEventsFiltered = funnelEventsFiltered.filter((e: any) => !isInternalTrackingPathFromEvent(e, customPathRules));
        
        const uniqueVisitors = new Set<string>();
        const visitorsWithViewContent = new Set<string>();
        const engagedVisitors = new Set<string>();
        const leadVisitors = new Set<string>();
        const customerVisitors = new Set<string>();
        const sessionEventCounts: Record<string, number> = {};
        
        funnelEventsFiltered.forEach((event: any) => {
          // Use email as canonical identifier if available, else visitor_id
          // This ensures same user across devices is counted once in funnel
          const canonicalUserId = (event as any).customer_email 
            ? `email:${(event as any).customer_email.toLowerCase().trim()}` 
            : event.visitor_id 
            ? `visitor:${event.visitor_id}` 
            : null;
          
          if (!canonicalUserId) return;
          
          const sessionId = event.session_id;
          
          // Support both event_type and event_name fields
          const eventType = (event as any).event_type || (event as any).event_name || '';
          const eventTypeLower = eventType.toLowerCase();
          
          // Visitor: anyone with page_view
          if (eventType === 'page_view' || eventType === 'PageView' || eventTypeLower === 'pageview') {
            uniqueVisitors.add(canonicalUserId);
            sessionEventCounts[sessionId] = (sessionEventCounts[sessionId] || 0) + 1;
          }
          
          // Browser: view_content events (engaged viewing)
          if (eventType === 'view_content' || eventType === 'ViewContent' || eventTypeLower === 'viewcontent') {
            visitorsWithViewContent.add(canonicalUserId);
          }
          
          // Engaged: multiple page views or interaction events
          const interactionEvents = ['add_to_cart', 'addtocart', 'initiate_checkout', 'initiatecheckout', 'click'];
          if (sessionEventCounts[sessionId] >= 2 || interactionEvents.includes(eventTypeLower)) {
            engagedVisitors.add(canonicalUserId);
          }
          
          // Lead: lead or complete_registration events
          if (eventType === 'lead' || eventType === 'Lead' || 
              eventType === 'complete_registration' || eventType === 'CompleteRegistration' ||
              eventTypeLower === 'lead' || eventTypeLower === 'completeregistration') {
            leadVisitors.add(canonicalUserId);
          }
          
          // Customer: purchase events
          if (eventType === 'purchase' || eventType === 'Purchase' || eventTypeLower === 'purchase') {
            customerVisitors.add(canonicalUserId);
          }
        });
        
        const visitorCount = uniqueVisitors.size;
        const browserCount = visitorsWithViewContent.size;
        const engagedCount = engagedVisitors.size;
        const leadCount = leadVisitors.size;
        const customerCount = customerVisitors.size;
        
        result = {
          stage_distribution: {
            visitor: visitorCount,
            browser: browserCount,
            engaged: engagedCount,
            lead: leadCount,
            customer: customerCount
          },
          totals: {
            leads: leadCount,
            customers: customerCount
          },
          conversion_rates: {
            visitor_to_browser: visitorCount > 0 ? `${((browserCount / visitorCount) * 100).toFixed(1)}%` : '0%',
            browser_to_engaged: browserCount > 0 ? `${((engagedCount / browserCount) * 100).toFixed(1)}%` : '0%',
            engaged_to_lead: engagedCount > 0 ? `${((leadCount / engagedCount) * 100).toFixed(1)}%` : '0%',
            lead_to_customer: leadCount > 0 ? `${((customerCount / leadCount) * 100).toFixed(1)}%` : '0%'
          }
        };
        break;

      case 'users':
        // Get top users from h2s_tracking_events based on purchase events
        const limit = parseInt(searchParams.get('limit') || '10');
        const { data: userEvents } = await getTrackingDb()
          .from('h2s_tracking_events')
          .select('visitor_id, customer_email, customer_phone, revenue_amount, occurred_at, order_id')
          .eq('event_type', 'purchase')
          .not('revenue_amount', 'is', null)
          .order('occurred_at', { ascending: false });

        let userEventsFiltered = excludeTest ? (userEvents || []).filter((e: any) => !isTestTrackingEvent(e)) : (userEvents || []);
        if (excludeInternal) userEventsFiltered = userEventsFiltered.filter((e: any) => !isInternalTrackingPathFromEvent(e, customPathRules));
        
        // Aggregate by customer (email or visitor_id as fallback)
        const userMap = new Map<string, any>();
        
        userEventsFiltered.forEach((event: any) => {
          // Use email as canonical identifier if available, else visitor_id
          // This prevents counting same customer multiple times across devices
          const userKey = event.customer_email 
            ? `email:${event.customer_email.toLowerCase().trim()}` 
            : event.visitor_id 
            ? `visitor:${event.visitor_id}` 
            : null;
          
          if (!userKey) return;
          
          if (!userMap.has(userKey)) {
            userMap.set(userKey, {
              Email: event.customer_email || null,
              Visitor_ID: event.visitor_id,
              Total_Orders: 0,
              Lifetime_Revenue: 0,
              Last_Purchase_Date: null,
              Current_Funnel_Stage: 'customer'
            });
          }
          
          const user = userMap.get(userKey);
          user.Total_Orders += 1;
          user.Lifetime_Revenue += parseFloat(event.revenue_amount) || 0;
          
          // Update email if we get it later (link visitor_id to email)
          if (event.customer_email && !user.Email) {
            user.Email = event.customer_email;
          }
          
          const eventDate = new Date(event.occurred_at);
          if (!user.Last_Purchase_Date || eventDate > new Date(user.Last_Purchase_Date)) {
            user.Last_Purchase_Date = event.occurred_at;
          }
        });
        
        // Convert to array and sort by revenue
        const topUsers = Array.from(userMap.values())
          .sort((a, b) => b.Lifetime_Revenue - a.Lifetime_Revenue)
          .slice(0, limit);
        
        result = {
          top_users: topUsers,
          total_customers: userMap.size
        };
        break;

      case 'ai_report':
        {
          const days = toInt(searchParams.get('days'), 30);
          const limit = toInt(searchParams.get('limit'), 1500);
          result = await buildAiReport({ 
            request, 
            days, 
            limit, 
            startDate: startDate || undefined,
            endDate: endDate || undefined,
            minDate: minDate || undefined
          });
        }
        break;

      case 'ai-insights':
        // Back-compat for FunnelTrack.html (it uses action=ai-insights)
        {
          const days = toInt(searchParams.get('days'), 30);
          const limit = toInt(searchParams.get('limit'), 1500);
          result = await buildAiReport({ 
            request, 
            days, 
            limit,
            startDate: startDate || undefined,
            endDate: endDate || undefined,
            minDate: minDate || undefined
          });
        }
        break;

      case 'tracking_health':
        // Get tracking system health from h2s_tracking_events
        const { data: recentTrackingEvents } = await getTrackingDb()
          .from('h2s_tracking_events')
          .select('occurred_at')
          .order('occurred_at', { ascending: false })
          .limit(1);
        
        const lastEventTime = recentTrackingEvents?.[0]?.occurred_at;
        const hoursSinceLastEvent = lastEventTime 
          ? (Date.now() - new Date(lastEventTime).getTime()) / (1000 * 60 * 60)
          : null;
        
        // Count events in last 24 hours
        const twentyFourHoursAgoHealth = new Date();
        twentyFourHoursAgoHealth.setHours(twentyFourHoursAgoHealth.getHours() - 24);
        const { count: events24h } = await getTrackingDb()
          .from('h2s_tracking_events')
          .select('*', { count: 'exact', head: true })
          .gte('occurred_at', twentyFourHoursAgoHealth.toISOString());
        
        const healthStatus = hoursSinceLastEvent === null 
          ? 'no_data'
          : hoursSinceLastEvent < 1 
          ? 'healthy'
          : hoursSinceLastEvent < 24 
          ? 'degraded'
          : 'down';
        
        result = {
          ok: true,
          healthy: healthStatus === 'healthy',
          last_event_time: lastEventTime,
          last_event_mins: hoursSinceLastEvent ? Math.round(hoursSinceLastEvent * 60) : null,
          hours_since_last_event: hoursSinceLastEvent,
          total_events_24h: events24h || 0,
          status: healthStatus
        };
        break;

      case 'estimateEquipmentCost':
        // AI-powered equipment cost estimation
        const equipServiceName = searchParams.get('serviceName');
        const equipServiceDescription = searchParams.get('serviceDescription') || '';
        const equipCategory = searchParams.get('category') || '';
        
        if (!equipServiceName) {
          return NextResponse.json({ ok: false, error: 'Service name is required' }, { status: 400, headers: corsHeaders(request) });
        }
        
        if (!openai) {
          return NextResponse.json({ ok: false, error: 'AI service not configured' }, { status: 503, headers: corsHeaders(request) });
        }
        
        try {
          const prompt = `You are an expert in home services and smart home installation equipment costs. Estimate the equipment cost per unit for the following service.

Service Name: ${equipServiceName}
${equipCategory ? `Category: ${equipCategory}` : ''}
${equipServiceDescription ? `Description: ${equipServiceDescription}` : ''}

Provide a realistic equipment cost estimate in USD per unit. Consider:
- Standard quality equipment (not premium, not budget)
- Typical installation equipment needs
- Hardware, materials, and any necessary accessories
- Industry average costs for similar services

Return ONLY a JSON object with this exact structure:
{
  "estimatedCost": 150.00,
  "costRange": {
    "min": 100.00,
    "max": 200.00
  },
  "confidence": "high|medium|low",
  "notes": "Brief explanation of what equipment is typically needed (1-2 sentences)",
  "equipmentItems": ["Item 1", "Item 2", "Item 3"]
}

Be realistic and conservative. If unsure, use medium confidence.`;

          const completion = await openai.chat.completions.create({
            model: 'gpt-4o',
            messages: [
              {
                role: 'system',
                content: 'You are an expert equipment cost estimator for home services. Always return valid JSON only.'
              },
              {
                role: 'user',
                content: prompt
              }
            ],
            temperature: 0.3,
            max_tokens: 300,
            response_format: { type: 'json_object' }
          });
          
          const aiResponse = JSON.parse(completion.choices[0].message.content || '{}');
          
          // Validate and structure response
          result = {
            serviceName: equipServiceName,
            estimatedCost: aiResponse.estimatedCost || 0,
            costRange: aiResponse.costRange || { min: 0, max: 0 },
            confidence: aiResponse.confidence || 'medium',
            notes: aiResponse.notes || '',
            equipmentItems: aiResponse.equipmentItems || [],
            timestamp: new Date().toISOString()
          };
        } catch (error: any) {
          console.error('Equipment cost estimation error:', error);
          return NextResponse.json({ ok: false, error: error.message || 'Failed to estimate equipment cost' }, { status: 500, headers: corsHeaders(request) });
        }
        break;

      case 'offer_performance':
        // Get offer performance data from h2s_tracking_events
        // Use the EXACT SAME query and processing as meta_pixel_events endpoint (which works in funnel-track.html)
        const offerNameFilter = searchParams.get('offerName');
        const daysBackOffer = parseInt(searchParams.get('days') || '30');
        const debugMode = searchParams.get('debug') === 'true';
        
        // Calculate date range (optional filter)
        const endDateOffer = new Date();
        const startDateOffer = new Date();
        startDateOffer.setDate(startDateOffer.getDate() - daysBackOffer);
        
        // Use the EXACT SAME query as meta_pixel_events - with date filtering
        let offerQuery = getTrackingDb()
          .from('h2s_tracking_events')
          .select('*')
          .order('occurred_at', { ascending: false });
        
        // Apply date filters
        if (minDate) offerQuery = offerQuery.gte('occurred_at', minDate);
        if (startDate) offerQuery = offerQuery.gte('occurred_at', startDate);
        if (endDate) offerQuery = offerQuery.lte('occurred_at', endDate);
        
        const { data: allEventsOffer, error: queryError } = await offerQuery.limit(10000);
        
        // Log raw query results for debugging
        console.log('🔍 offer_performance - Raw query results:', {
          eventCount: allEventsOffer?.length || 0,
          error: queryError,
          sampleEvents: allEventsOffer?.slice(0, 5).map((e: any) => ({
            event_type: e.event_type,
            event_name: e.event_name,
            occurred_at: e.occurred_at,
            page_path: e.page_path,
            visitor_id: e.visitor_id?.substring(0, 8) + '...'
          }))
        });
        
        // Filter by date range in memory (optional - only if days parameter specified)
        let dateFilteredEvents = allEventsOffer || [];
        if (daysBackOffer && daysBackOffer > 0 && daysBackOffer < 9999) {
          const beforeFilter = dateFilteredEvents.length;
          dateFilteredEvents = allEventsOffer?.filter((e: any) => {
            if (!e.occurred_at) return true; // Include events without timestamp
            try {
              const eventDate = new Date(e.occurred_at);
              const inRange = eventDate >= startDateOffer && eventDate <= endDateOffer;
              return inRange;
            } catch (err) {
              console.warn('Date parsing error for event:', e.occurred_at, err);
              return true; // Include if date parsing fails
            }
          }) || [];
          console.log('📅 Date filter applied:', {
            daysBack: daysBackOffer,
            dateRange: { start: startDateOffer.toISOString(), end: endDateOffer.toISOString() },
            beforeFilter,
            afterFilter: dateFilteredEvents.length
          });
        } else {
          console.log('📅 No date filter applied (daysBackOffer:', daysBackOffer, ')');
        }
        
        // Filter by offer name if specified (via utm_campaign or metadata)
        const filteredEvents = offerNameFilter 
          ? dateFilteredEvents.filter((e: any) => {
              const campaign = e.utm_campaign || '';
              const metadataOffer = e.metadata && typeof e.metadata === 'object' 
                ? e.metadata.offer_name 
                : (typeof e.metadata === 'string' ? JSON.parse(e.metadata || '{}').offer_name : null);
              return campaign.toLowerCase().includes(offerNameFilter.toLowerCase()) ||
                     (metadataOffer && metadataOffer.toLowerCase().includes(offerNameFilter.toLowerCase()));
            })
          : dateFilteredEvents;
        
        // Debug: Get sample of event types and structure
        const eventTypeBreakdown: Record<string, number> = {};
        const sampleEvents: any[] = [];
        const utmCampaigns = new Set<string>();
        const pagePathsDebug = new Set<string>();
        
        filteredEvents?.forEach((e: any) => {
          // Count event types (support both event_type and event_name - SAME as meta_pixel_events)
          const eventType = e.event_type || e.event_name || 'unknown';
          eventTypeBreakdown[eventType] = (eventTypeBreakdown[eventType] || 0) + 1;
          
          // Collect UTM campaigns
          if (e.utm_campaign) utmCampaigns.add(e.utm_campaign);
          
          // Collect page paths
          if (e.page_path) pagePathsDebug.add(e.page_path);
          
          // Store first 10 events as samples (increased to see more variety)
          if (sampleEvents.length < 10) {
            sampleEvents.push({
              event_type: e.event_type || e.event_name,
              occurred_at: e.occurred_at,
              visitor_id: e.visitor_id ? e.visitor_id.substring(0, 8) + '...' : null,
              utm_campaign: e.utm_campaign,
              page_path: e.page_path,
              metadata: e.metadata ? (typeof e.metadata === 'string' ? e.metadata.substring(0, 100) : JSON.stringify(e.metadata).substring(0, 100)) : null
            });
          }
        });
        
        // Calculate metrics (support both event_type and event_name fields)
        // Include both page_view and view_content as "page views" (view_content = engaged viewing)
        const pageViewsOffer = filteredEvents?.filter((e: any) => {
          const eventType = e.event_type || e.event_name;
          return eventType === 'page_view' || 
                 eventType === 'PageView' || 
                 eventType === 'view_content' || 
                 eventType === 'ViewContent';
        }).length || 0;
        const leadsOffer = filteredEvents?.filter((e: any) => {
          const eventType = e.event_type || e.event_name;
          return eventType === 'lead' || 
            eventType === 'Lead' || 
            eventType === 'complete_registration' ||
            eventType === 'CompleteRegistration';
        }).length || 0;
        const purchasesOffer = filteredEvents?.filter((e: any) => {
          const eventType = e.event_type || e.event_name;
          return eventType === 'purchase' || eventType === 'Purchase';
        }).length || 0;
        const uniqueVisitorsOffer = new Set(filteredEvents?.map((e: any) => e.visitor_id).filter(Boolean) || []).size;
        const totalRevenueOffer = filteredEvents?.filter((e: any) => e.revenue_amount).reduce((sum: number, e: any) => sum + (parseFloat(e.revenue_amount) || 0), 0) || 0;
        
        // Calculate conversion rates
        const visitorToLeadRateOffer = uniqueVisitorsOffer > 0 ? (leadsOffer / uniqueVisitorsOffer) * 100 : 0;
        const leadToPurchaseRateOffer = leadsOffer > 0 ? (purchasesOffer / leadsOffer) * 100 : 0;
        const visitorToPurchaseRateOffer = uniqueVisitorsOffer > 0 ? (purchasesOffer / uniqueVisitorsOffer) * 100 : 0;
        
        // Average order value
        const avgOrderValueOffer = purchasesOffer > 0 ? totalRevenueOffer / purchasesOffer : 0;
        
        // Revenue per visitor
        const revenuePerVisitorOffer = uniqueVisitorsOffer > 0 ? totalRevenueOffer / uniqueVisitorsOffer : 0;
        
        // Get event breakdown by type (support both event_type and event_name fields)
        const eventBreakdownOffer: Record<string, number> = {};
        filteredEvents?.forEach((event: any) => {
          const eventType = event.event_type || event.event_name || 'unknown';
          eventBreakdownOffer[eventType] = (eventBreakdownOffer[eventType] || 0) + 1;
        });
        
        // Get top sources (UTM)
        const sourceBreakdownOffer: Record<string, number> = {};
        filteredEvents?.forEach((event: any) => {
          const source = event.utm_source || 'direct';
          sourceBreakdownOffer[source] = (sourceBreakdownOffer[source] || 0) + 1;
        });
        
        result = {
          offer_name: offerNameFilter || 'all_offers',
          period_days: daysBackOffer,
          date_range: {
            start: startDateOffer.toISOString(),
            end: endDateOffer.toISOString()
          },
          summary: {
            total_events: filteredEvents?.length || 0,
            page_views: pageViewsOffer,
            unique_visitors: uniqueVisitorsOffer,
            leads: leadsOffer,
            purchases: purchasesOffer,
            total_revenue: totalRevenueOffer,
            avg_order_value: avgOrderValueOffer,
            revenue_per_visitor: revenuePerVisitorOffer
          },
          conversion_rates: {
            visitor_to_lead: parseFloat(visitorToLeadRateOffer.toFixed(2)),
            lead_to_purchase: parseFloat(leadToPurchaseRateOffer.toFixed(2)),
            visitor_to_purchase: parseFloat(visitorToPurchaseRateOffer.toFixed(2))
          },
          event_breakdown: eventBreakdownOffer,
          source_breakdown: sourceBreakdownOffer,
          has_data: (filteredEvents?.length || 0) > 0,
          // Debug information
          ...(debugMode ? {
            debug: {
              total_events_in_db: allEventsOffer?.length || 0,
              total_events_after_date_filter: dateFilteredEvents?.length || 0,
              total_events_found: filteredEvents?.length || 0,
              event_type_breakdown: eventTypeBreakdown,
              unique_utm_campaigns: Array.from(utmCampaigns),
              unique_page_paths: Array.from(pagePathsDebug).slice(0, 20),
              sample_events: sampleEvents,
              filter_applied: offerNameFilter || 'none',
              query_date_range: {
                start: startDateOffer.toISOString(),
                end: endDateOffer.toISOString(),
                days_back: daysBackOffer
              },
              raw_event_types_preview: allEventsOffer?.slice(0, 10).map((e: any) => ({
                event_type: e.event_type,
                event_name: e.event_name,
                occurred_at: e.occurred_at,
                page_path: e.page_path,
                visitor_id: e.visitor_id ? e.visitor_id.substring(0, 8) + '...' : null
              })) || []
            }
          } : {})
        };
        break;

      case 'database_stats':
        {
          const db = getTrackingDb();
          
          // Get total event count
          const { count: totalEvents, error: countError } = await db
            .from('h2s_tracking_events')
            .select('*', { count: 'exact', head: true });
          
          if (countError) {
            return NextResponse.json(
              { ok: false, error: `Failed to count events: ${countError.message}` },
              { status: 500, headers: corsHeaders(request) }
            );
          }
          
          // Get oldest and newest event dates
          const { data: dateRange, error: dateError } = await db
            .from('h2s_tracking_events')
            .select('occurred_at')
            .order('occurred_at', { ascending: true })
            .limit(1);
          
          const { data: dateRangeNewest, error: dateErrorNewest } = await db
            .from('h2s_tracking_events')
            .select('occurred_at')
            .order('occurred_at', { ascending: false })
            .limit(1);
          
          if (dateError || dateErrorNewest) {
            return NextResponse.json(
              { ok: false, error: 'Failed to fetch date range' },
              { status: 500, headers: corsHeaders(request) }
            );
          }
          
          const oldestDate = dateRange && dateRange.length > 0 
            ? new Date(dateRange[0].occurred_at).toLocaleDateString() 
            : 'N/A';
          
          const newestDate = dateRangeNewest && dateRangeNewest.length > 0 
            ? new Date(dateRangeNewest[0].occurred_at).toLocaleDateString() 
            : 'N/A';
          
          result = {
            total_events: totalEvents || 0,
            oldest_event_date: oldestDate,
            newest_event_date: newestDate
          };
        }
        break;

      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400, headers: corsHeaders(request) });
    }

    // Special cases for response key naming
    let responseKey: string = action;
    if (action === 'aiProfiles') responseKey = 'profiles';
    if (action === 'trainingCompletions') responseKey = 'completions';
    if (action === 'deliverables') responseKey = 'deliverables';
    if (action === 'ai_report') {
      // AI report returns its own structure
      return NextResponse.json(result, { headers: corsHeaders(request) });
    }
    if (action === 'ai-insights') {
      // Back-compat: return direct structure (same as ai_report)
      return NextResponse.json(result, { headers: corsHeaders(request) });
    }
    
    return NextResponse.json({ ok: true, [responseKey]: result }, { headers: corsHeaders(request) });

  } catch (error: any) {
    console.error('API Error:', error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500, headers: corsHeaders(request) });
  }
}

export async function POST(request: Request) {
  const body = await request.json();
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  try {
    let result;

    // Some features (training, candidates, tasks, hours, etc.) live in the Mgmt DB.
    // Prefer Mgmt creds when present, but don't hard-fail if they're not configured.
    const supabaseMgmt = (() => {
      try {
        return getSupabaseMgmt();
      } catch {
        return getSupabase();
      }
    })();

    switch (action) {
      case 'set_path_rule':
        {
          const auth = requireAdminToken(request);
          if (!auth.ok) {
            return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status, headers: corsHeaders(request) });
          }

          const pattern = normalizePathPattern(body?.pattern ?? body?.path ?? body?.page_path);
          const matchType = normalizeMatchType(body?.match_type ?? body?.matchType);
          const isBlocked = !['0', 'false', 'no', 'off'].includes(String(body?.is_blocked ?? body?.isBlocked ?? true).toLowerCase());
          const reason = typeof body?.reason === 'string' ? body.reason.trim() : null;

          if (!pattern) {
            return NextResponse.json({ ok: false, error: 'pattern is required (path or URL)' }, { status: 400, headers: corsHeaders(request) });
          }

          const db = getTrackingDb();
          const { data: rows, error } = await db
            .from('h2s_tracking_path_rules')
            .upsert(
              {
                pattern,
                match_type: matchType,
                is_blocked: isBlocked,
                reason
              },
              { onConflict: 'match_type,pattern' }
            )
            .select('id,pattern,match_type,is_blocked,reason,created_at,updated_at')
            .limit(1);

          if (error) {
            return NextResponse.json({ ok: false, error: `Failed to upsert path rule: ${error.message}` }, { status: 500, headers: corsHeaders(request) });
          }

          result = (rows || [])[0] || null;
        }
        break;

      case 'delete_path_rule':
        {
          const auth = requireAdminToken(request);
          if (!auth.ok) {
            return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status, headers: corsHeaders(request) });
          }

          const id = String(body?.id || '').trim();
          if (!id || !isUuid(id)) {
            return NextResponse.json({ ok: false, error: 'id (UUID) is required' }, { status: 400, headers: corsHeaders(request) });
          }

          const db = getTrackingDb();
          const { error } = await db.from('h2s_tracking_path_rules').delete().eq('id', id);
          if (error) {
            return NextResponse.json({ ok: false, error: `Failed to delete path rule: ${error.message}` }, { status: 500, headers: corsHeaders(request) });
          }
          result = { deleted: true, id };
        }
        break;

      case 'delete_purchase':
        {
          const auth = requireAdminToken(request);
          if (!auth.ok) {
            return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status, headers: corsHeaders(request) });
          }

          const eventId = String(body?.event_id || body?.eventId || '').trim();
          const dryRun = ['1', 'true', 'yes', 'on'].includes(String(body?.dry_run || body?.dryRun || '').toLowerCase());

          if (!eventId) {
            return NextResponse.json({ ok: false, error: 'event_id is required' }, { status: 400, headers: corsHeaders(request) });
          }
          if (!isUuid(eventId)) {
            return NextResponse.json({ ok: false, error: 'event_id must be a UUID' }, { status: 400, headers: corsHeaders(request) });
          }

          const db1Client = getTrackingDb();
          const { data: events, error: fetchError } = await db1Client
            .from('h2s_tracking_events')
            .select('*')
            .eq('event_id', eventId)
            .limit(1);

          if (fetchError) {
            return NextResponse.json(
              { ok: false, error: `Failed to fetch event: ${fetchError.message}` },
              { status: 500, headers: corsHeaders(request) }
            );
          }

          const event = (events || [])[0];
          if (!event) {
            return NextResponse.json({ ok: false, error: 'Purchase event not found' }, { status: 404, headers: corsHeaders(request) });
          }

          const eventType = normalizeTrackingEventType(event.event_type || event.event_name);
          if (eventType !== 'purchase') {
            return NextResponse.json(
              { ok: false, error: `Refusing to delete non-purchase event (type=${eventType})` },
              { status: 400, headers: corsHeaders(request) }
            );
          }

          const preview = {
            event_id: event.event_id,
            occurred_at: event.occurred_at,
            page_path: event.page_path,
            visitor_id: event.visitor_id,
            session_id: event.session_id,
            order_id: event.order_id,
            job_id: event.job_id,
            customer_email: event.customer_email,
            revenue_amount: normalizeRevenueAmount(event.revenue_amount)
          };

          if (dryRun) {
            result = { dry_run: true, purchase: preview };
            break;
          }

          const { data: deleted, error: deleteError } = await db1Client
            .from('h2s_tracking_events')
            .delete()
            .eq('event_id', eventId)
            .select('event_id');

          if (deleteError) {
            return NextResponse.json(
              { ok: false, error: `Failed to delete purchase: ${deleteError.message}` },
              { status: 500, headers: corsHeaders(request) }
            );
          }

          result = { deleted: (deleted || []).length, event_id: eventId, purchase: preview };
        }
        break;

      case 'ai-insights':
        // FunnelTrack compatibility: POST /api/v1?action=ai-insights with body.action='ai_report'
        // Returns the same contract FunnelTrack expects: { status: 'success', report: '<html>', timestamp }
        if (body?.action && body.action !== 'ai_report') {
          return NextResponse.json({ ok: false, error: `Unsupported ai-insights action: ${body.action}` }, { status: 400, headers: corsHeaders(request) });
        }

        {
          const days = toInt(body?.days ?? searchParams.get('days'), 30);
          const limit = toInt(body?.limit ?? searchParams.get('limit'), 1500);
          const startDate = body?.start_date || body?.startDate || searchParams.get('start_date') || searchParams.get('startDate') || undefined;
          const endDate = body?.end_date || body?.endDate || searchParams.get('end_date') || searchParams.get('endDate') || undefined;
          const minDate = body?.min_date || body?.minDate || searchParams.get('min_date') || searchParams.get('minDate') || undefined;
          const report = await buildAiReport({ request, days, limit, startDate, endDate, minDate });
          // Keep response shape stable for FunnelTrack
          return NextResponse.json(report, { headers: corsHeaders(request) });
        }

      case 'logHours':
        // Server-side validation
        if (!body.date || body.hours === undefined || body.hours === null || !body.tasks || !body.vaName) {
          const missing = [];
          if (!body.date) missing.push('date');
          if (body.hours === undefined || body.hours === null) missing.push('hours');
          if (!body.tasks) missing.push('tasks');
          if (!body.vaName) missing.push('vaName');
          
          return NextResponse.json({ 
            ok: false, 
            error: `Missing required fields: ${missing.join(', ')}` 
          }, { status: 400, headers: corsHeaders(request) });
        }
        
        // Validate hours is a positive number
        const hoursNum = parseFloat(body.hours);
        if (isNaN(hoursNum) || hoursNum <= 0 || hoursNum > 24) {
          return NextResponse.json({ 
            ok: false, 
            error: `Invalid hours value: must be between 0 and 24` 
          }, { status: 400, headers: corsHeaders(request) });
        }
        
        // Validate date format
        const dateObj = new Date(body.date);
        if (isNaN(dateObj.getTime())) {
          return NextResponse.json({ 
            ok: false, 
            error: `Invalid date format` 
          }, { status: 400, headers: corsHeaders(request) });
        }
        
        // Normalize date to start of day for duplicate check
        const normalizedDate = new Date(dateObj);
        normalizedDate.setHours(0, 0, 0, 0);
        const dateISO = normalizedDate.toISOString();
        const dateOnly = dateISO.split('T')[0];
        
        // Check for existing entry (idempotency: one entry per user per day)
        const dayStart = `${dateOnly}T00:00:00.000Z`;
        const dayEnd = `${dateOnly}T23:59:59.999Z`;
        
        const { data: existingEntry } = await getSupabase()
          .from('VA_Hours_Log')
          .select('Entry_ID, Date, Hours')
          .eq('Logged_By', body.vaName)
          .gte('Date', dayStart)
          .lte('Date', dayEnd)
          .maybeSingle();
        
        if (existingEntry) {
          return NextResponse.json({ 
            ok: false, 
            error: `Hours already logged for ${body.date}. Entry ID: ${existingEntry.Entry_ID}` 
          }, { status: 409, headers: corsHeaders(request) });
        }
        
        // AI Analysis only if OpenAI is configured
        let aiSummary = 'AI analysis not configured';
        
        if (openai) {
          try {
            const analysisPrompt = `Analyze this work log entry. Provide a structured analysis with exactly 4 sections, each formatted as:

**1. Specific Outcomes Achieved**
[Analyze what concrete results were delivered. Were revenue-generating tasks prioritized? What tangible value was created?]

**2. Learning and Skill Development Demonstrated**
[Identify what skills were learned or practiced. What knowledge gaps were addressed? What competencies were demonstrated?]

**3. Process Improvements or Blockers to Address**
[Note any blockers, inefficiencies, or areas needing support. What could be improved in the workflow?]

**4. Priorities for Tomorrow**
[Based on today's work, what should be prioritized next? Balance foundational work with immediate revenue tasks.]

Be direct, constructive, and actionable. Keep each section concise (2-3 sentences). Focus on value creation and growth.`;

            const systemPrompt = body.analysisPrompt 
              ? "You are a Revenue Operations Director. " + body.analysisPrompt
              : "You are a Revenue Operations Director focused on productivity, revenue generation, and team development. Provide clear, actionable insights.";
            
            const analysis = await openai.chat.completions.create({
              messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: `${analysisPrompt}\n\nWork Log:\n${body.tasks}` }
              ],
              model: "gpt-4o",
            });
            aiSummary = analysis.choices[0].message.content || '';
          } catch (aiError: any) {
            aiSummary = 'AI analysis failed: ' + (aiError.message || 'Unknown error');
          }
        }
        
        const loggedBy = body.vaName || 'ROSEL';
        
        // Insert into database
        try {
          const entryId = crypto.randomUUID();
          
          const { data: hoursLog, error: dbError } = await getSupabase()
            .from('VA_Hours_Log')
            .insert({
              Entry_ID: entryId,
              Date: dateISO,
              Hours: hoursNum,
              Tasks: body.tasks,
              Logged_By: loggedBy,
              AI_Summary: aiSummary
            })
            .select()
            .single();
          
          if (dbError) {
            return NextResponse.json({ 
              ok: false, 
              error: `Database error: ${dbError.message}` 
            }, { status: 500, headers: corsHeaders(request) });
          }
          
          result = hoursLog;
        } catch (insertError: any) {
          return NextResponse.json({ 
            ok: false, 
            error: `Insert failed: ${insertError.message}` 
          }, { status: 500, headers: corsHeaders(request) });
        }
        break;

      case 'parseForecast':
        // AI-powered forecast metric extraction with location context awareness
        if (!openai) {
          return NextResponse.json({ 
            ok: false, 
            error: 'OpenAI API not configured' 
          }, { status: 500, headers: corsHeaders(request) });
        }

        const forecastText = body.text || '';
        const forecastContext = body.context || { location: null, previousInputs: null };

        if (!forecastText) {
          return NextResponse.json({ 
            ok: false, 
            error: 'Missing text input' 
          }, { status: 400, headers: corsHeaders(request) });
        }

        try {
          // REBUILT: Intelligent extraction that understands context, vague statements, and implied information
          const systemPrompt = `You are an intelligent business metric extractor with deep context understanding. Your job is to:
1. Extract EXPLICIT values (numbers, locations, services mentioned)
2. UNDERSTAND IMPLIED information from vague statements
3. RECOGNIZE context clues that indicate existence vs. quantity

CRITICAL EXTRACTION RULES:

1. LOCATION EXTRACTION - MUST BE EXACT (HIGHEST PRIORITY):
   - "Greenville, South Carolina" → "Greenville, South Carolina" (EXACT match)
   - "Dallas, TX" → "Dallas, TX" (EXACT match)
   - "in Greenville" + previous context "Greenville, SC" → use context location
   - NEVER change state/province - if text says "South Carolina", return "South Carolina" (NOT "TX")
   - Scan for: "in [city]", "for [city]", "[city], [state/province]", "[city], [ST]"

2. NUMERIC EXTRACTION - BE SMART ABOUT FORMATS:
   - "$20/day", "$20 a day", "about $20", "spending $20" → 20 (extract number, ignore "about")
   - "three creatives", "3 creatives", "have 3 running" → 3 (handle word numbers)
   - "25%", "25 percent" → 25 (remove % sign)
   - Handle: "approximately", "around", "about", "roughly"

3. SERVICES - EXTRACT EXACTLY AS WRITTEN:
   - "TV mounting and camera mounting jobs" → ["TV mounting", "camera mounting"]
   - "for TV mounting" → ["TV mounting"]
   - Look for: "jobs", "services", "offering", "doing", "installing", "work"

4. VAGUE STATEMENTS - UNDERSTAND CONTEXT:
   - "we have technicians on standby" → techs: null (technicians EXIST but quantity unknown)
   - "techs available" → techs: null (team exists, no number)
   - "have technicians" → techs: null (team exists, no number)
   - "looking to acquire the first customers" → early stage (rates unknown, return null)
   - "getting started" → most operational metrics null (just starting out)
   - "ready to scale" → infrastructure exists, metrics unknown

5. CONTEXT CLUES - RECOGNIZE THESE PATTERNS:
   - Team existence: "on standby", "available", "have [type]", "we have" = exists but number unknown → null
   - Early stage: "first customers", "getting started", "looking to acquire" = operational metrics null
   - Active operations: "running", "doing", "handling" = extract numbers if stated

6. EXTRACTION LOGIC:
   - If explicit number stated → extract it
   - If vague mention ("technicians on standby") → return null (exists but quantity unknown)
   - If metric not mentioned at all → return null
   - NEVER guess numbers - if quantity unknown, return null
   - NEVER return 0, empty string, or defaults`;
          
          let userPrompt = `Analyze this business scenario and extract metrics intelligently. Understand both EXPLICIT values and IMPLIED context.

INPUT TEXT TO ANALYZE:
"${forecastText}"

${forecastContext.location ? `\n📍 LOCATION CONTEXT: Previously mentioned "${forecastContext.location}". If current text says "${forecastContext.location.split(',')[0]}" without state, use "${forecastContext.location}".` : ''}

${forecastContext.previousInputs ? `\n📋 PREVIOUS CONTEXT:\n${forecastContext.previousInputs.substring(0, 300)}` : ''}

ANALYSIS EXAMPLES - Understand the intelligence level needed:

Example 1: "spending about $20 a day on ads in Greenville, South Carolina"
→ dailyAdSpend: 20, market: "Greenville, South Carolina"
(Extracts number despite "about", location exactly as stated)

Example 2: "have three creatives running for TV mounting and camera mounting jobs"
→ creatives: 3, services: ["TV mounting", "camera mounting"]
(Extracts number and all services mentioned)

Example 3: "we have 2 techs available"
→ techs: 2
(Explicit number stated)

Example 4: "we have technicians on standby"
→ techs: null
(Understands: technicians EXIST but quantity is NOT stated. This is vague - team exists but number unknown, so return null for the number field)

Example 5: "looking to acquire the first customers"
→ leadToBookingRate: null, bookingToCompletedRate: null
(Understands: early stage business, no operational data yet)

YOUR TASK - Analyze the INPUT TEXT above:
1. ✅ Find explicit numbers ("$20", "three", "3") and extract them
2. ✅ Find location ("Greenville, South Carolina") and extract EXACTLY as written
3. ✅ Find services ("TV mounting", "camera mounting") and extract as array
4. 🧠 Understand vague statements:
   - "technicians on standby" = team exists, number unknown → techs: null
   - "looking to acquire customers" = early stage → rates: null
   - "have [type]" without number = exists but quantity unknown → return null

Return ONLY valid JSON (no markdown, no code blocks):

{
  "dailyAdSpend": number or null,
  "services": array of strings or [],
  "market": string with EXACT location ("City, State") or null,
  "techs": number or null (null if vague like "on standby" without number),
  "jobsPerTechPerDay": number or null,
  "aov": number or null,
  "cpc": number or null,
  "leadToBookingRate": number or null,
  "bookingToCompletedRate": number or null,
  "cities": number or null,
  "creatives": number or null
}

CHECKLIST:
✓ Location EXACT (including state - don't change "South Carolina" to anything else)
✓ Numbers extracted (handle "about", "around", word numbers)
✓ Services exact phrases from text
✓ Vague statements ("on standby") = null (team exists, quantity unknown)
✓ Early stage mentions = null for operational rates`;

          const completion = await openai.chat.completions.create({
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt }
            ],
            model: "gpt-4o",
            response_format: { type: "json_object" },
            temperature: 0.0  // Zero temperature for maximum precision and consistency
          });

          const content = completion.choices[0].message.content;
          if (!content) {
            throw new Error('Empty response from OpenAI');
          }

          const extracted = JSON.parse(content);
          
          // REBUILT: Strict validation with location verification
          const normalizeNumber = (val: any): number | null => {
            if (val === null || val === undefined || val === '') return null;
            const num = typeof val === 'string' ? parseFloat(val.replace(/[^0-9.-]/g, '')) : parseFloat(val);
            return isNaN(num) ? null : num;
          };
          
          const normalizeInteger = (val: any): number | null => {
            if (val === null || val === undefined || val === '') return null;
            const num = typeof val === 'string' ? parseInt(val.replace(/[^0-9-]/g, ''), 10) : parseInt(val, 10);
            return isNaN(num) ? null : num;
          };
          
          // CRITICAL: Verify location matches what was mentioned in the text
          let verifiedMarket = null;
          if (extracted.market && typeof extracted.market === 'string') {
            const marketStr = extracted.market.trim();
            const lowerText = forecastText.toLowerCase();
            const lowerMarket = marketStr.toLowerCase();
            
            // Check if the extracted location actually appears in the input text
            const cityMatch = marketStr.split(',')[0].toLowerCase();
            const stateMatch = marketStr.split(',')[1]?.trim().toLowerCase();
            
            // Verify the state/province mentioned in text matches what was extracted
            if (stateMatch) {
              // Check if the state appears in the text
              const stateInText = lowerText.includes(stateMatch) || 
                                 lowerText.includes(stateMatch.substring(0, 2)); // Check abbreviation
              
              if (stateInText || forecastContext.location?.toLowerCase() === lowerMarket) {
                verifiedMarket = marketStr;
              } else {
                // State doesn't match - check if we have context
                if (forecastContext.location && cityMatch === forecastContext.location.split(',')[0].toLowerCase()) {
                  verifiedMarket = forecastContext.location; // Use context location
                  console.warn(`Location mismatch: extracted "${marketStr}" but using context "${forecastContext.location}"`);
                } else {
                  // Try to find the actual location mentioned in text
                  const locationPatterns = [
                    new RegExp(`(${cityMatch}[^,]*,\\s*[A-Z][a-zA-Z]+)`, 'i'),
                    new RegExp(`(${cityMatch}[^,]*,\\s*[A-Z]{2})`, 'i')
                  ];
                  
                  for (const pattern of locationPatterns) {
                    const match = forecastText.match(pattern);
                    if (match) {
                      verifiedMarket = match[1].trim();
                      console.warn(`Corrected location from "${marketStr}" to "${verifiedMarket}" based on text`);
                      break;
                    }
                  }
                  
                  if (!verifiedMarket) {
                    verifiedMarket = marketStr; // Fallback to extracted (but log warning)
                    console.warn(`Could not verify location "${marketStr}" in text`);
                  }
                }
              }
            } else {
              verifiedMarket = marketStr; // No state, use as-is
            }
          }
          
          const normalized = {
            dailyAdSpend: normalizeNumber(extracted.dailyAdSpend),
            services: Array.isArray(extracted.services) 
              ? extracted.services
                  .filter((s: any) => s && typeof s === 'string' && s.trim().length > 0)
                  .map((s: string) => s.trim())
              : [],
            market: verifiedMarket,
            techs: normalizeInteger(extracted.techs),
            jobsPerTechPerDay: normalizeNumber(extracted.jobsPerTechPerDay),
            aov: normalizeNumber(extracted.aov),
            cpc: normalizeNumber(extracted.cpc),
            leadToBookingRate: normalizeNumber(extracted.leadToBookingRate),
            bookingToCompletedRate: normalizeNumber(extracted.bookingToCompletedRate),
            cities: normalizeInteger(extracted.cities),
            creatives: normalizeInteger(extracted.creatives)
          };
          
          // Validate percentages are in valid range
          if (normalized.leadToBookingRate !== null && (normalized.leadToBookingRate < 0 || normalized.leadToBookingRate > 100)) {
            normalized.leadToBookingRate = Math.max(0, Math.min(100, normalized.leadToBookingRate));
          }
          if (normalized.bookingToCompletedRate !== null && (normalized.bookingToCompletedRate < 0 || normalized.bookingToCompletedRate > 100)) {
            normalized.bookingToCompletedRate = Math.max(0, Math.min(100, normalized.bookingToCompletedRate));
          }
          
          // Log extraction for debugging
          console.log('[parseForecast] Extraction result:', {
            input: forecastText.substring(0, 100),
            extractedMarket: extracted.market,
            verifiedMarket: normalized.market,
            contextLocation: forecastContext.location
          });

          result = { extracted: normalized };
        } catch (error: any) {
          console.error('parseForecast error:', error);
          return NextResponse.json({ 
            ok: false, 
            error: `Failed to parse forecast: ${error.message}` 
          }, { status: 500, headers: corsHeaders(request) });
        }
        break;

      case 'addTask':
        // Validation
        if (!body.title || !body.title.trim()) {
          return NextResponse.json({ 
            ok: false, 
            error: 'Task title is required' 
          }, { status: 400, headers: corsHeaders(request) });
        }
        
        // Handle due date - support both date string and ISO datetime
        let dueDateValue = null;
        if (body.dueDate) {
          try {
            // If it's already an ISO string with time, use it directly
            if (body.dueDate.includes('T')) {
              dueDateValue = new Date(body.dueDate).toISOString();
            } else {
              // If it's just a date, combine with time if provided
              if (body.dueTime) {
                dueDateValue = new Date(`${body.dueDate}T${body.dueTime}:00`).toISOString();
              } else {
                // Just date, set to end of day
                dueDateValue = new Date(`${body.dueDate}T23:59:59`).toISOString();
              }
            }
          } catch (e) {
            return NextResponse.json({ 
              ok: false, 
              error: 'Invalid date format' 
            }, { status: 400, headers: corsHeaders(request) });
          }
        }
        
        // Generate Task_ID
        const taskId = crypto.randomUUID();
        const nowUpdate = new Date().toISOString();
        
        // Insert task
        const { data: newTask, error: taskError } = await getSupabase()
          .from('Tasks')
          .insert({
            Task_ID: taskId,
            Title: body.title.trim(),
            Description: body.description || null,
            Priority: body.priority || 'MEDIUM',
            Due_Date: dueDateValue,
            Status: 'PENDING',
            Category: body.category || null,
            Assigned_To: body.assignedTo || null,
            Type: body.type || null,
            URL: body.url || null,
            Content: body.content || null,
            Created_At: nowUpdate,
            Updated_At: nowUpdate
          })
          .select()
          .single();
        
        if (taskError) {
          return NextResponse.json({ 
            ok: false, 
            error: `Failed to create task: ${taskError.message}` 
          }, { status: 500, headers: corsHeaders(request) });
        }
        
        result = newTask;
        break;
      
      case 'completeTraining':
        // Validation
        if (!body.resourceId || !body.completedBy || !body.notesLearned) {
          const missing = [];
          if (!body.resourceId) missing.push('resourceId');
          if (!body.completedBy) missing.push('completedBy');
          if (!body.notesLearned) missing.push('notesLearned');
          
          return NextResponse.json({ 
            ok: false, 
            error: `Missing required fields: ${missing.join(', ')}` 
          }, { status: 400, headers: corsHeaders(request) });
        }
        
        // Validate rating if provided
        if (body.comprehensionRating !== undefined && (body.comprehensionRating < 1 || body.comprehensionRating > 5)) {
          return NextResponse.json({ 
            ok: false, 
            error: `Invalid comprehension rating: must be between 1 and 5` 
          }, { status: 400, headers: corsHeaders(request) });
        }
        
        // Verify resource exists
        const { data: trainingResource, error: resourceError } = await supabaseMgmt
          .from('Training_Resources')
          .select('*')
          .eq('Resource_ID', body.resourceId)
          .single();
        
        if (resourceError || !trainingResource) {
          return NextResponse.json({ 
            ok: false, 
            error: `Training resource not found: ${body.resourceId}` 
          }, { status: 404, headers: corsHeaders(request) });
        }
        
        // AI Analysis of learnings
        let aiAnalysis = null;
        if (openai && body.notesLearned) {
          try {
            const analysisPrompt = `
You are an expert training analyst. A VA just completed a training video and wrote notes about what they learned.

TRAINING: ${trainingResource?.Title || 'Unknown'}
CATEGORY: ${trainingResource?.Category || 'General'}
SKILLS TAUGHT: ${trainingResource?.Skills_Taught || 'Not specified'}

VA'S LEARNING NOTES:
${body.notesLearned}

Provide a JSON response with:
1. "extractedConcepts": Array of key concepts the VA successfully learned (each as object: {"skill": "concept name", "pillar": "category"})
2. "knowledgeGaps": Array of topics they might still be weak on or didn't mention (each as object: {"skill": "gap name", "pillar": "category"})
3. "confidenceScore": 0-100 assessment of their mastery based on their notes
4. "recommendations": Array of suggested next steps with:
   - "type": "practice" or "learn"
   - "title": Brief recommendation title
   - "description": What they should do
   - "deliverable": Specific output expected (e.g., "Create a workflow diagram", "Draft a 1-page SOP")
   - "reason": Why this recommendation matters

Format: JSON only, no markdown.
`;

            const completion = await openai.chat.completions.create({
              messages: [
                { role: "system", content: "You are a training effectiveness analyst. Always respond with valid JSON." },
                { role: "user", content: analysisPrompt }
              ],
              model: "gpt-4o",
              response_format: { type: "json_object" }
            });
            
            try {
              aiAnalysis = JSON.parse(completion.choices[0].message.content || '{}');
            } catch (e) {
              aiAnalysis = { error: 'Failed to parse AI response' };
            }
          } catch (aiError: any) {
            // Don't block on AI failure
          }
        }
        
        // Generate Completion_ID
        const completionId = crypto.randomUUID();
        
        // Create completion record
        try {
          const { data: trainingCompletion, error: dbError } = await supabaseMgmt
            .from('Training_Completions')
            .insert({
              Completion_ID: completionId,
              Resource_ID: body.resourceId,
              Completed_By: body.completedBy,
              Notes_Learned: body.notesLearned,
              Comprehension_Rating: body.comprehensionRating || null,
              Time_Spent_Minutes: body.timeSpentMinutes || null,
              AI_Extracted_Concepts: aiAnalysis?.extractedConcepts ? JSON.stringify(aiAnalysis.extractedConcepts) : null,
              AI_Knowledge_Gaps: aiAnalysis?.knowledgeGaps ? JSON.stringify(aiAnalysis.knowledgeGaps) : null,
              AI_Confidence_Score: aiAnalysis?.confidenceScore || null,
              AI_Analysis_Raw: aiAnalysis ? JSON.stringify(aiAnalysis) : null
            })
            .select('*, resource:Training_Resources(*)')
            .single();
          
          if (dbError) {
            return NextResponse.json({ 
              ok: false, 
              error: `Database error: ${dbError.message}` 
            }, { status: 500, headers: corsHeaders(request) });
          }
          
          result = trainingCompletion;
          
          // Update VA Knowledge Profile (don't block on this)
          try {
            await updateVaKnowledgeProfile(body.completedBy, body.resourceId, aiAnalysis);
          } catch (profileError: any) {
            // Don't fail the request if profile update fails
          }
        } catch (insertError: any) {
          return NextResponse.json({ 
            ok: false, 
            error: `Insert failed: ${insertError.message}` 
          }, { status: 500, headers: corsHeaders(request) });
        }
        
        break;

      case 'scheduleMeeting':
        // body: { candidateId, meetingType, scheduledAt, durationMinutes, notes, scheduledBy }
        const meetingData: any = {
          Candidate_ID: body.candidateId || null,
          Meeting_Type: body.meetingType,
          Scheduled_At: new Date(body.scheduledAt).toISOString(),
          Duration_Minutes: body.durationMinutes || 30,
          Scheduled_By: body.scheduledBy || 'ROSEL',
          Meeting_Notes: body.notes || null,
          Provider: body.provider || 'MANUAL',
          Status: 'SCHEDULED'
        };
        
        // If Calendly is configured, create event there
        if (body.provider === 'CALENDLY' && process.env.CALENDLY_API_KEY) {
          // TODO: Implement Calendly API integration
          // For now, just create a placeholder URL
          meetingData.Meeting_URL = `https://calendly.com/home2smart/interview-${Date.now()}`;
          meetingData.Join_URL = meetingData.Meeting_URL;
        }
        
        const { data: scheduledMeeting } = await getSupabase()
          .from('Meetings')
          .insert(meetingData)
          .select('*, candidate:Candidate_Master(*)')
          .single();
        result = scheduledMeeting;
        
        // Update candidate's next action if meeting is for a candidate
        if (body.candidateId) {
          await getSupabase()
            .from('Candidate_Master')
            .update({
              Next_Action: `${body.meetingType} scheduled`,
              Next_Action_Date: new Date(body.scheduledAt).toISOString()
            })
            .eq('Candidate_ID', body.candidateId);
        }
        break;

      case 'completeMeeting':
        // body: { meetingId, outcome, outcomeNotes, updateCandidateStage }
        const { data: completedMeeting } = await getSupabase()
          .from('Meetings')
          .update({
            Status: 'COMPLETED',
            Outcome: body.outcome,
            Outcome_Notes: body.outcomeNotes,
            Completed_At: new Date().toISOString()
          })
          .eq('Meeting_ID', body.meetingId)
          .select('*, candidate:Candidate_Master(*)')
          .single();
        result = completedMeeting;
        
        // Update candidate pipeline stage if requested
        if (body.updateCandidateStage && completedMeeting?.Candidate_ID) {
          await getSupabase()
            .from('Candidate_Master')
            .update({
              Current_Stage: body.updateCandidateStage,
              Interview_Outcome: body.outcome
            })
            .eq('Candidate_ID', completedMeeting.Candidate_ID);
        }
        break;

      case 'rescheduleMeeting':
        // body: { meetingId, newScheduledAt, reason }
        const { data: rescheduledMeeting } = await getSupabase()
          .from('Meetings')
          .update({
            Scheduled_At: new Date(body.newScheduledAt).toISOString(),
            Status: 'RESCHEDULED',
            Cancelled_Reason: body.reason
          })
          .eq('Meeting_ID', body.meetingId)
          .select('*, candidate:Candidate_Master(*)')
          .single();
        result = rescheduledMeeting;
        break;

      case 'cancelMeeting':
        // body: { meetingId, reason }
        const { data: cancelledMeeting } = await getSupabase()
          .from('Meetings')
          .update({
            Status: 'CANCELLED',
            Cancelled_At: new Date().toISOString(),
            Cancelled_Reason: body.reason
          })
          .eq('Meeting_ID', body.meetingId)
          .select()
          .single();
        result = cancelledMeeting;
        break;

      case 'createTraining':
        // body: { title, type, url, description, category, skillsTaught, difficultyLevel, estimatedMinutes, createdBy }
        const { data: newTraining } = await supabaseMgmt
          .from('Training_Resources')
          .insert({
            Resource_ID: crypto.randomUUID(),
            Title: body.title,
            Type: body.type || 'Video',
            URL: body.url,
            Description: body.description || null,
            Category: body.category || 'General',
            Skills_Taught: body.skillsTaught || null,
            Difficulty_Level: body.difficultyLevel || 'BEGINNER',
            Estimated_Minutes: body.estimatedMinutes || null,
            Created_By: body.createdBy || 'ADMIN',
            Order: body.order || 0
          })
          .select()
          .single();
        result = newTraining;
        break;

      case 'updateTraining':
        // body: { resourceId, ...updates }
        const updateData: any = {};
        if (body.title) updateData.Title = body.title;
        if (body.type) updateData.Type = body.type;
        if (body.url) updateData.URL = body.url;
        if (body.description !== undefined) updateData.Description = body.description;
        if (body.category) updateData.Category = body.category;
        if (body.skillsTaught !== undefined) updateData.Skills_Taught = body.skillsTaught;
        if (body.difficultyLevel) updateData.Difficulty_Level = body.difficultyLevel;
        if (body.estimatedMinutes !== undefined) updateData.Estimated_Minutes = body.estimatedMinutes;
        if (body.order !== undefined) updateData.Order = body.order;

        const { data: updatedTraining } = await supabaseMgmt
          .from('Training_Resources')
          .update(updateData)
          .eq('Resource_ID', body.resourceId)
          .select()
          .single();
        result = updatedTraining;
        break;

      case 'deleteTraining':
        // body: { resourceId }
        const { data: deletedTraining } = await supabaseMgmt
          .from('Training_Resources')
          .delete()
          .eq('Resource_ID', body.resourceId)
          .select()
          .single();
        result = deletedTraining;
        break;

      case 'getVaProfile':
        // body: { vaName }
        const { data: vaProfile } = await getSupabase()
          .from('VaKnowledgeProfile')
          .select('*')
          .eq('VA_Name', body.vaName || 'ROSEL')
          .single();
        result = vaProfile;
        break;

      case 'submitDeliverable':
        if (!body.title || !body.description || !body.submittedBy) {
          return NextResponse.json({ 
            ok: false, 
            error: 'Missing required fields: title, description, submittedBy' 
          }, { status: 400, headers: corsHeaders(request) });
        }
        
        // AI Analysis - Enhanced with document content extraction
        let deliverableAiAnalysis = null;
        if (openai && (body.description || body.fileLink)) {
          try {
            // Extract file information and prepare for analysis
            let fileContent = '';
            let fileTypes: string[] = [];
            let documentText = '';
            
            if (body.fileLink) {
              try {
                const files = JSON.parse(body.fileLink);
                if (Array.isArray(files)) {
                  fileTypes = files.map((f: any) => f.type || 'unknown');
                  // For PDFs and text files, we'll extract text using OpenAI vision API
                  // For now, note the file types for context
                  const pdfFiles = files.filter((f: any) => f.type === 'application/pdf' || f.name?.endsWith('.pdf'));
                  const textFiles = files.filter((f: any) => f.type?.startsWith('text/') || f.name?.match(/\.(txt|md|docx?)$/i));
                  
                  if (pdfFiles.length > 0 || textFiles.length > 0) {
                    documentText = `[${pdfFiles.length} PDF file(s) and ${textFiles.length} text file(s) attached. Content will be analyzed.]`;
                  }
                }
              } catch (e) {
                // Legacy format - single URL string
                if (typeof body.fileLink === 'string' && body.fileLink.includes('data:')) {
                  documentText = '[File attached - content will be analyzed]';
                }
              }
            }
            
            const analysisPrompt = `
You are an expert quality analyst and content strategist reviewing a work deliverable submission. Your job is to provide comprehensive, actionable analysis.

DELIVERABLE TITLE: ${body.title}
DESCRIPTION: ${body.description || 'No description provided'}
${documentText ? `ATTACHED FILES: ${documentText}` : ''}
${fileTypes.length > 0 ? `FILE TYPES: ${fileTypes.join(', ')}` : ''}

ANALYSIS REQUIREMENTS:
1. **Content Synopsis**: Provide a clear 3-4 sentence summary of what this deliverable contains and its purpose
2. **Key Information Extracted**: List the most important facts, data points, or insights from the content (5-7 bullet points)
3. **Quality Assessment**: Evaluate completeness, clarity, professionalism, and readiness
4. **Actionable Insights**: What can be done with this deliverable? What decisions can be made?
5. **Gaps & Missing Elements**: What's incomplete or could be strengthened?
6. **Recommendations**: Specific next steps or improvements

For Offer Briefs specifically, check for:
- All 9 sections present and complete
- Unit economics calculations
- Clear value proposition
- Competitive positioning
- Operational readiness

Respond with valid JSON in this exact format:
{
  "synopsis": "2-3 sentence overview of what this deliverable is and contains",
  "keyPoints": ["Point 1", "Point 2", "Point 3", "Point 4", "Point 5"],
  "qualityScore": 85,
  "strengths": ["Strength 1", "Strength 2", "Strength 3"],
  "improvements": ["Improvement 1", "Improvement 2", "Improvement 3"],
  "actionableInsights": ["Insight 1", "Insight 2"],
  "missingElements": ["Missing element 1", "Missing element 2"],
  "recommendations": ["Recommendation 1", "Recommendation 2"],
  "summary": "Brief executive summary (2-3 sentences) of overall assessment",
  "documentType": "Detected type (Offer Brief, Content Piece, SOP, etc.)",
  "readinessLevel": "ready|needs_revision|incomplete"
}

Be thorough, specific, and constructive. Focus on what makes this deliverable valuable and what needs work.
`;
            
            // Use vision API if PDFs are attached, otherwise standard chat
            const messages: any[] = [
              { 
                role: "system", 
                content: "You are a professional quality analyst and content strategist. You analyze deliverables for completeness, quality, and actionable value. Always respond with valid JSON." 
              },
              { 
                role: "user", 
                content: analysisPrompt 
              }
            ];
            
            // If PDFs are attached, try to extract text using vision API
            // Note: OpenAI vision API works with images, so we'd need to convert PDF pages to images first
            // For now, we'll enhance the prompt to work with the description and file metadata
            
            const completion = await openai.chat.completions.create({
              messages,
              model: "gpt-4o",
              response_format: { type: "json_object" },
              temperature: 0.3,
              max_tokens: 2000
            });
            
            try {
              deliverableAiAnalysis = JSON.parse(completion.choices[0].message.content || '{}');
              
              // Ensure all fields exist with defaults
              deliverableAiAnalysis = {
                synopsis: deliverableAiAnalysis.synopsis || deliverableAiAnalysis.summary || 'No synopsis available',
                keyPoints: deliverableAiAnalysis.keyPoints || [],
                qualityScore: deliverableAiAnalysis.qualityScore || deliverableAiAnalysis.quality_score || 50,
                strengths: deliverableAiAnalysis.strengths || [],
                improvements: deliverableAiAnalysis.improvements || [],
                actionableInsights: deliverableAiAnalysis.actionableInsights || deliverableAiAnalysis.actionable_insights || [],
                missingElements: deliverableAiAnalysis.missingElements || deliverableAiAnalysis.missing_elements || [],
                recommendations: deliverableAiAnalysis.recommendations || [],
                summary: deliverableAiAnalysis.summary || deliverableAiAnalysis.synopsis || 'Analysis complete',
                documentType: deliverableAiAnalysis.documentType || deliverableAiAnalysis.document_type || 'General Deliverable',
                readinessLevel: deliverableAiAnalysis.readinessLevel || deliverableAiAnalysis.readiness_level || 'needs_revision'
              };
            } catch (e) {
              deliverableAiAnalysis = { 
                error: 'Failed to parse AI response',
                summary: 'AI analysis completed but response format was invalid'
              };
            }
          } catch (aiError: any) {
            console.error('AI analysis error:', aiError);
            // Don't block on AI failure - deliverable can still be submitted
            deliverableAiAnalysis = {
              error: aiError.message || 'AI analysis failed',
              summary: 'AI analysis could not be completed, but deliverable was submitted successfully'
            };
          }
        }
        
        const deliverableId = crypto.randomUUID();
        const { data: newDeliverable, error: deliverableError } = await getSupabase()
          .from('Deliverables')
          .insert({
            Deliverable_ID: deliverableId,
            Title: body.title,
            Description: body.description,
            File_Link: body.fileLink || null,
            Submitted_By: body.submittedBy,
            Status: 'PENDING',
            AI_Quality_Score: deliverableAiAnalysis?.qualityScore || null,
            AI_Strengths: deliverableAiAnalysis?.strengths ? JSON.stringify(deliverableAiAnalysis.strengths) : null,
            AI_Improvements: deliverableAiAnalysis?.improvements ? JSON.stringify(deliverableAiAnalysis.improvements) : null,
            AI_Summary: deliverableAiAnalysis?.summary || deliverableAiAnalysis?.synopsis || null,
            AI_Analysis_Raw: deliverableAiAnalysis ? JSON.stringify(deliverableAiAnalysis) : null
          })
          .select()
          .single();
        
        if (deliverableError) {
          return NextResponse.json({ 
            ok: false, 
            error: `Database error: ${deliverableError.message}` 
          }, { status: 500, headers: corsHeaders(request) });
        }
        
        result = newDeliverable;
        break;

      case 'deliverables':
        const statusFilter = searchParams.get('status') || 'all';
        let deliverablesQuery = getSupabase()
          .from('Deliverables')
          .select('*')
          .order('Created_At', { ascending: false });
        
        if (statusFilter !== 'all') {
          deliverablesQuery = deliverablesQuery.eq('Status', statusFilter.toUpperCase());
        }
        
        const { data: deliverables, error: deliverablesError } = await deliverablesQuery;
        
        if (deliverablesError) {
          return NextResponse.json({ 
            ok: false, 
            error: `Failed to load deliverables: ${deliverablesError.message}` 
          }, { status: 500, headers: corsHeaders(request) });
        }
        
        result = deliverables || [];
        break;

      case 'approveDeliverable':
      case 'rejectDeliverable':
        if (!body.deliverableId || !body.reviewedBy) {
          return NextResponse.json({ 
            ok: false, 
            error: 'Missing required fields: deliverableId, reviewedBy' 
          }, { status: 400, headers: corsHeaders(request) });
        }
        
        const newStatus = action === 'approveDeliverable' ? 'APPROVED' : 'REJECTED';
        const deliverableUpdateData: any = {
          Status: newStatus,
          Reviewed_By: body.reviewedBy,
          Reviewed_At: new Date().toISOString()
        };
        
        if (body.reviewNotes) {
          deliverableUpdateData.Review_Notes = body.reviewNotes;
        }
        
        const { data: updatedDeliverable, error: updateError } = await getSupabase()
          .from('Deliverables')
          .update(deliverableUpdateData)
          .eq('Deliverable_ID', body.deliverableId)
          .select()
          .single();
        
        if (updateError) {
          return NextResponse.json({ 
            ok: false, 
            error: `Database error: ${updateError.message}` 
          }, { status: 500, headers: corsHeaders(request) });
        }
        
        result = updatedDeliverable;
        break;

      case 'publishDeliverable':
        if (!body.deliverableId) {
          return NextResponse.json({ 
            ok: false, 
            error: 'Missing required field: deliverableId' 
          }, { status: 400, headers: corsHeaders(request) });
        }
        
        const { data: publishedDeliverable, error: publishError } = await getSupabase()
          .from('Deliverables')
          .update({
            Status: 'PUBLISHED',
            Published_At: new Date().toISOString()
          })
          .eq('Deliverable_ID', body.deliverableId)
          .select()
          .single();
        
        if (publishError) {
          return NextResponse.json({ 
            ok: false, 
            error: `Database error: ${publishError.message}` 
          }, { status: 500, headers: corsHeaders(request) });
        }
        
        result = publishedDeliverable;
        break;

      case 'offers':
        // List all offers for current user
        const offersVaName = searchParams.get('vaName') || searchParams.get('createdBy');
        let offersQuery = getSupabase()
          .from('Offers')
          .select('*')
          .order('Created_At', { ascending: false })
          .limit(100);
        
        if (offersVaName) {
          offersQuery = offersQuery.eq('Created_By', offersVaName);
        }
        
        const { data: offers, error: offersError } = await offersQuery;
        
        if (offersError) {
          return NextResponse.json({ 
            ok: false, 
            error: `Failed to load offers: ${offersError.message}` 
          }, { status: 500, headers: corsHeaders(request) });
        }
        
        result = offers || [];
        break;

      case 'offer':
        // Get single offer by ID
        const offerId = searchParams.get('id');
        if (!offerId) {
          return NextResponse.json({ 
            ok: false, 
            error: 'Offer ID required' 
          }, { status: 400, headers: corsHeaders(request) });
        }
        
        const { data: offer, error: offerError } = await getSupabase()
          .from('Offers')
          .select('*')
          .eq('Offer_ID', offerId)
          .single();
        
        if (offerError) {
          return NextResponse.json({ 
            ok: false, 
            error: `Failed to load offer: ${offerError.message}` 
          }, { status: 500, headers: corsHeaders(request) });
        }
        
        result = offer;
        break;

      case 'saveOffer':
        // Save or update an offer
        if (!body.offerData) {
          return NextResponse.json({ 
            ok: false, 
            error: 'Offer data required' 
          }, { status: 400, headers: corsHeaders(request) });
        }

        const offerData = body.offerData;
        const offerIdSave = offerData.offer_id || crypto.randomUUID();
        const nowOffer = new Date().toISOString();
        const createdBy = body.createdBy || offerData.created_by || 'UNKNOWN';

        // Prepare offer record
        const offerRecord: any = {
          Offer_ID: offerIdSave,
          Created_By: createdBy,
          Created_At: offerData.created_at || nowOffer,
          Updated_At: nowOffer,
          SKU_ID: offerData.sku_id || null,
          Status: offerData.status || 'DRAFT',
          Guardrail_Status: offerData.guardrail_status || null,
          Profit_Per_Job: offerData.profit_per_job || null,
          Margin_Pct: offerData.margin_pct || null,
          Message_Context: offerData.messageContext || offerData.message_context || {},
          Economics: offerData.economics || {},
          AI_Analysis: offerData.ai_analysis || null,
          Performance_Data: offerData.performance_data || null
        };

        // Check if offer exists
        const { data: existingOffer } = await getSupabase()
          .from('Offers')
          .select('Offer_ID')
          .eq('Offer_ID', offerIdSave)
          .maybeSingle();

        let savedOffer;
        if (existingOffer) {
          // Update existing
          const { data: updated, error: updateError } = await getSupabase()
            .from('Offers')
            .update(offerRecord)
            .eq('Offer_ID', offerIdSave)
            .select()
            .single();

          if (updateError) {
            return NextResponse.json({ 
              ok: false, 
              error: `Failed to update offer: ${updateError.message}` 
            }, { status: 500, headers: corsHeaders(request) });
          }
          savedOffer = updated;
        } else {
          // Insert new
          const { data: inserted, error: insertError } = await getSupabase()
            .from('Offers')
            .insert(offerRecord)
            .select()
            .single();

          if (insertError) {
            return NextResponse.json({ 
              ok: false, 
              error: `Failed to save offer: ${insertError.message}` 
            }, { status: 500, headers: corsHeaders(request) });
          }
          savedOffer = inserted;
        }

        result = savedOffer;
        break;

      case 'deleteOffer':
        // Delete an offer
        if (!body.offerId) {
          return NextResponse.json({ 
            ok: false, 
            error: 'Offer ID required' 
          }, { status: 400, headers: corsHeaders(request) });
        }

        const { error: deleteError } = await getSupabase()
          .from('Offers')
          .delete()
          .eq('Offer_ID', body.offerId);

        if (deleteError) {
          return NextResponse.json({ 
            ok: false, 
            error: `Failed to delete offer: ${deleteError.message}` 
          }, { status: 500, headers: corsHeaders(request) });
        }

        result = { deleted: true, offerId: body.offerId };
        break;

      case 'purge_old_data':
        {
          const auth = requireAdminToken(request);
          if (!auth.ok) {
            return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status, headers: corsHeaders(request) });
          }

          const minDate = body?.min_date;
          if (!minDate) {
            return NextResponse.json(
              { ok: false, error: 'min_date is required (format: YYYY-MM-DD)' },
              { status: 400, headers: corsHeaders(request) }
            );
          }

          // Validate date format
          const dateObj = new Date(minDate);
          if (isNaN(dateObj.getTime())) {
            return NextResponse.json(
              { ok: false, error: 'Invalid date format. Use YYYY-MM-DD' },
              { status: 400, headers: corsHeaders(request) }
            );
          }

          const db = getTrackingDb();
          
          // First, count how many records will be deleted
          const { count: deleteCount, error: countError } = await db
            .from('h2s_tracking_events')
            .select('*', { count: 'exact', head: true })
            .lt('occurred_at', minDate);

          if (countError) {
            return NextResponse.json(
              { ok: false, error: `Failed to count old records: ${countError.message}` },
              { status: 500, headers: corsHeaders(request) }
            );
          }

          // Delete old records
          const { error: deleteError } = await db
            .from('h2s_tracking_events')
            .delete()
            .lt('occurred_at', minDate);

          if (deleteError) {
            return NextResponse.json(
              { ok: false, error: `Failed to purge old data: ${deleteError.message}` },
              { status: 500, headers: corsHeaders(request) }
            );
          }

          result = { 
            ok: true, 
            deleted_count: deleteCount || 0,
            min_date: minDate,
            purged_at: new Date().toISOString()
          };
        }
        break;

      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400, headers: corsHeaders(request) });
    }

    // Back-compat: keep `result`, but also return the named payload Dash.html expects.
    const payload: any = { ok: true, result };
    const responseAction = String(action || '');
    switch (responseAction) {
      case 'training':
        payload.training = result;
        break;
      case 'trainingCompletions':
        payload.trainingCompletions = result;
        break;
      case 'vaKnowledgeProfile':
        payload.vaKnowledgeProfile = result;
        break;
      case 'trainingAnalytics':
        payload.trainingAnalytics = result;
        break;
      case 'tasks':
        payload.tasks = result;
        break;
      case 'candidates':
        payload.candidates = result;
        break;
      case 'hours':
        payload.hours = result;
        break;
      case 'deliverables':
        payload.deliverables = result;
        break;
      default:
        break;
    }

    return NextResponse.json(payload, { headers: corsHeaders(request) });

  } catch (error: any) {
    console.error('API Error:', error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500, headers: corsHeaders(request) });
  }
}

/**
 * Update VA's knowledge profile based on training completion
 */
async function updateVaKnowledgeProfile(vaName: string, resourceId: string, aiAnalysis: any) {
  try {
    const supabaseMgmt = (() => {
      try {
        return getSupabaseMgmt();
      } catch {
        return getSupabase();
      }
    })();

    // Get or create profile
    const { data: existingProfile } = await supabaseMgmt
      .from('VA_Knowledge_Profiles')
      .select('*')
      .eq('VA_Name', vaName)
      .single();
    
    let profile = existingProfile;
    if (!profile) {
      const { data: newProfile } = await supabaseMgmt
        .from('VA_Knowledge_Profiles')
        .insert({
          VA_Name: vaName,
          Skill_Competencies: {},
          Top_Skill_Gaps: [],
          Recommended_Trainings: []
        })
        .select()
        .single();
      profile = newProfile;
    }
    
    // Get training resource to extract skills
    const { data: resource } = await supabaseMgmt
      .from('Training_Resources')
      .select('*')
      .eq('Resource_ID', resourceId)
      .single();
    
    // Parse existing competencies
    const competencies = profile?.Skill_Competencies || {};
    
    // Update skills from this training
    if (resource?.Skills_Taught) {
      const skills = resource.Skills_Taught.split(',').map((s: string) => s.trim());
      const confidenceScore = aiAnalysis?.confidenceScore || 70;
      
      skills.forEach((skill: string) => {
        if (!competencies[skill]) {
          competencies[skill] = {
            score: confidenceScore,
            lastUpdated: new Date().toISOString(),
            trainingCount: 1
          };
        } else {
          // Update existing skill (weighted average)
          const current = competencies[skill];
          competencies[skill] = {
            score: Math.round((current.score + confidenceScore) / 2),
            lastUpdated: new Date().toISOString(),
            trainingCount: current.trainingCount + 1
          };
        }
      });
    }
    
    // Calculate overall mastery score (average of all skills)
    const skillScores = Object.values(competencies).map((c: any) => c.score);
    const overallScore = skillScores.length > 0
      ? Math.round(skillScores.reduce((a: number, b: number) => a + b, 0) / skillScores.length)
      : 0;
    
    // Get total trainings count
    const { count: totalCount } = await supabaseMgmt
      .from('Training_Completions')
      .select('*', { count: 'exact', head: true })
      .eq('Completed_By', vaName);
    
    // Get total learning hours
    const { data: completions } = await supabaseMgmt
      .from('Training_Completions')
      .select('Time_Spent_Minutes')
      .eq('Completed_By', vaName);
    const totalMinutes = (completions || []).reduce((sum, c) => sum + (c.Time_Spent_Minutes || 0), 0);
    
    // Extract skill gaps from AI analysis
    const skillGaps = aiAnalysis?.knowledgeGaps || [];
    
    // Update profile
    await supabaseMgmt
      .from('VA_Knowledge_Profiles')
      .update({
        Skill_Competencies: competencies,
        Total_Trainings_Completed: totalCount || 0,
        Total_Learning_Hours: totalMinutes / 60,
        Overall_Mastery_Score: overallScore,
        Top_Skill_Gaps: skillGaps,
        Last_Analyzed_At: new Date().toISOString()
      })
      .eq('VA_Name', vaName);
    
  } catch (error) {
    console.error('Error updating VA knowledge profile:', error);
  }
}

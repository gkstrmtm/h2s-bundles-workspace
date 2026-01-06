import { NextResponse } from 'next/server';
import { getSupabase, getSupabaseDb1 } from '../../../lib/supabase';
import OpenAI from 'openai';

// Initialize OpenAI only if API key exists
const openai = process.env.OPENAI_API_KEY 
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

// Helper to handle CORS
const CORS_ALLOWED_ORIGINS = new Set([
  'https://home2smart.com',
  'https://www.home2smart.com',
]);

function isAllowedOrigin(origin: string): boolean {
  const o = origin.trim();
  if (!o) return false;
  if (CORS_ALLOWED_ORIGINS.has(o)) return true;

  // Allow subdomains of home2smart.com
  if (/^https:\/\/([a-z0-9-]+\.)*home2smart\.com$/i.test(o)) return true;

  // Local dev
  if (/^http:\/\/localhost:\d+$/i.test(o)) return true;

  return false;
}

function corsHeaders(request?: Request) {
  const originHeader = request?.headers.get('origin') || '';
  const allowOrigin = isAllowedOrigin(originHeader) ? originHeader : '*';
  const requestedHeaders = request?.headers.get('access-control-request-headers');

  const headers: Record<string, string> = {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': requestedHeaders || 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };

  // Only allow credentials when we echo a specific origin.
  if (allowOrigin !== '*') {
    headers['Access-Control-Allow-Credentials'] = 'true';
  }

  return headers;
}

export async function OPTIONS(request: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request) });
}

export async function GET(request: Request) {
  // STEP 1: Always return 200 - route proof
  const buildMarker = process.env.VERCEL_GIT_COMMIT_SHA || 
                      process.env.VERCEL_GIT_COMMIT_REF || 
                      `build-${new Date().toISOString()}`;
  
  console.log('[TRACK_ROUTE_HIT] GET /api/track', { build: buildMarker });
  
  return NextResponse.json({
    ok: true,
    route: 'api/track',
    build: buildMarker
  }, { 
    status: 200,
    headers: corsHeaders(request)
  });
}

// Helper: Normalize email/phone for identity linking
function normalizeIdentity(type: 'email' | 'phone', value: string | null | undefined): string | null {
  if (!value) return null;
  if (type === 'email') {
    return value.toLowerCase().trim();
  } else if (type === 'phone') {
    // Remove all non-digit characters
    return value.replace(/\D/g, '');
  }
  return null;
}

function normalizePhoneDigits(raw: unknown): string | null {
  const s = typeof raw === 'string' ? raw.trim() : typeof raw === 'number' ? String(raw) : '';
  if (!s) return null;

  let candidate = s;
  const telIdx = candidate.toLowerCase().indexOf('tel:');
  if (telIdx >= 0) {
    candidate = candidate.slice(telIdx + 4);
  }

  const digits = candidate.replace(/\D/g, '');
  if (!digits) return null;

  // US-centric normalization: strip leading country code 1 when present.
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);

  // Accept typical 10-digit numbers; keep longer digit strings if they look valid.
  if (digits.length < 10) return null;
  return digits;
}

function extractPhoneFromTrackingPayload(payload: any): string | null {
  const candidates: unknown[] = [
    payload?.customer_phone,
    payload?.Customer_Phone,
    payload?.phone,
    payload?.phone_number,
    payload?.phoneNumber,
    payload?.tel,
    payload?.element_href,
    payload?.element_url,
    payload?.outbound_url,
    payload?.metadata?.customer_phone,
    payload?.metadata?.phone,
    payload?.metadata?.phone_number,
    payload?.properties?.customer_phone,
    payload?.properties?.phone,
    payload?.properties?.phone_number,
  ];

  for (const c of candidates) {
    const digits = normalizePhoneDigits(c);
    if (digits) return digits;
  }

  return null;
}

// Helper: Generate or validate UUID
function ensureUUID(value: string | null | undefined): string | null {
  if (!value) return null;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (uuidRegex.test(value)) {
    return value;
  }
  return null;
}

function normalizeRevenueInput(value: unknown): number | null {
  if (value == null) return null;
  const rawString = typeof value === 'string' ? value.trim() : '';
  const n = typeof value === 'number' ? value : typeof value === 'string' ? parseFloat(value) : NaN;
  if (!Number.isFinite(n) || n <= 0) return null;

  const looksIntegerString = rawString ? /^\d+$/.test(rawString) : false;
  const looksIntegerNumber = Number.isInteger(n);
  const looksLikeCents = (looksIntegerString || looksIntegerNumber) && n >= 10000;

  return looksLikeCents ? n / 100 : n;
}

function buildVisitorCookie(params: { request: Request; visitorId: string }): string {
  const rawHost =
    params.request.headers.get('x-forwarded-host') ||
    params.request.headers.get('host') ||
    '';
  const host = String(rawHost).split(',')[0].trim().toLowerCase();

  // Share visitor_id across home2smart.com and www.home2smart.com.
  // Only set Domain when we're actually on home2smart.* to avoid breaking other hosts.
  const domainAttr = host === 'home2smart.com' || host.endsWith('.home2smart.com') ? '; Domain=.home2smart.com' : '';

  return `visitor_id=${params.visitorId}; Path=/; Max-Age=31536000; SameSite=Lax; Secure${domainAttr}`;
}

function parseCookies(request: Request): Record<string, string> {
  const header = request.headers.get('cookie') || '';
  if (!header) return {};

  const entries = header
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const idx = part.indexOf('=');
      if (idx <= 0) return null;
      const key = part.slice(0, idx).trim();
      const value = part.slice(idx + 1).trim();
      if (!key) return null;
      return [key, value] as const;
    })
    .filter(Boolean) as Array<readonly [string, string]>;

  return Object.fromEntries(entries);
}

function buildSessionCookie(params: { request: Request; sessionId: string }): string {
  const rawHost =
    params.request.headers.get('x-forwarded-host') ||
    params.request.headers.get('host') ||
    '';
  const host = String(rawHost).split(',')[0].trim().toLowerCase();

  const domainAttr = host === 'home2smart.com' || host.endsWith('.home2smart.com') ? '; Domain=.home2smart.com' : '';
  // 30-minute rolling session
  return `session_id=${params.sessionId}; Path=/; Max-Age=1800; SameSite=Lax; Secure${domainAttr}`;
}

function normalizePathForCheck(path: unknown): string {
  const raw = typeof path === 'string' ? path.trim() : '';
  if (!raw) return '';
  // Accept either "/foo" or "foo"; normalize to "/foo".
  const normalized = raw.startsWith('/') ? raw : `/${raw}`;
  return normalized.toLowerCase();
}

function isInternalTrackingPath(path: unknown): boolean {
  const p = normalizePathForCheck(path);
  if (!p) return false;

  // Block internal/admin pages from polluting marketing analytics.
  // Keep this list tight and explicit.
  const blockedRoots = ['/funnels', '/dashboard', '/portal', '/dispatch', '/funnel-track'];
  return blockedRoots.some((root) => p === root || p.startsWith(`${root}/`));
}

function normalizeEventType(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s) return 'page_view';

  // Normalize spaces, hyphens, and Meta Pixel camelCase into snake_case.
  // Examples: "PageView" -> "page_view", "InitiateCheckout" -> "initiate_checkout".
  const normalized = s
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[\s-]+/g, '_');

  // Meta Pixel canonical names
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
    purchase: 'purchase',
  };
  if (metaPixelMap[normalized]) return metaPixelMap[normalized];

  // Common tracking names
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

function isAllowedEventType(eventType: string): boolean {
  // Keep this explicit: only accept events that we intentionally track.
  // This prevents random/typo events from inflating counts.
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
    'outbound_click',
  ]);
  return allowed.has(eventType);
}

function normalizePagePathFromPayload(payload: any): string | null {
  const rawPath = typeof payload?.page_path === 'string' ? payload.page_path.trim() : '';
  const rawUrl = typeof payload?.page_url === 'string' ? payload.page_url.trim() : '';

  let path = '';

  if (rawPath) {
    // Sometimes clients accidentally send full URL in page_path.
    // Prefer parsing it as a URL if it looks like one.
    if (/^https?:\/\//i.test(rawPath)) {
      try {
        path = new URL(rawPath).pathname || '';
      } catch {
        path = '';
      }
    } else {
      path = rawPath;
    }
  } else if (rawUrl) {
    try {
      path = new URL(rawUrl).pathname || '';
    } catch {
      // If page_url isn't a valid URL, don't store it as a path.
      path = '';
    }
  }

  if (!path) return null;

  // Strip query/hash if any slipped in.
  path = path.split('?')[0].split('#')[0].trim();
  if (!path) return null;

  // Normalize to leading slash + lowercase.
  if (!path.startsWith('/')) path = `/${path}`;
  return path.toLowerCase();
}

async function upsertObservedPath(params: {
  client: any;
  pagePath: string;
  eventTs: string;
  requestId: string;
}) {
  try {
    const { error } = await params.client
      .from('h2s_tracking_observed_paths')
      .upsert(
        {
          path: params.pagePath,
          last_seen_at: params.eventTs
        },
        { onConflict: 'path' }
      );
    if (error) {
      console.warn('[TRACK_OBSERVED_PATH_UPSERT_FAILED]', {
        request_id: params.requestId,
        page_path: params.pagePath,
        error_code: error.code,
        error_message: error.message
      });
    }
  } catch (e: any) {
    console.warn('[TRACK_OBSERVED_PATH_UPSERT_EXCEPTION]', {
      request_id: params.requestId,
      page_path: params.pagePath,
      error: e?.message || String(e)
    });
  }
}

type PathRuleRow = {
  id: string;
  pattern: string;
  match_type: 'exact' | 'prefix' | string;
  is_blocked: boolean;
  reason?: string | null;
};

async function findBlockingPathRule(params: {
  client: any;
  pagePath: string;
  requestId: string;
}): Promise<PathRuleRow | null> {
  // Best-effort: if the table doesn't exist yet, do not block ingestion.
  try {
    const { data: exactRules, error: exactError } = await params.client
      .from('h2s_tracking_path_rules')
      .select('id,pattern,match_type,is_blocked,reason')
      .eq('is_blocked', true)
      .eq('match_type', 'exact')
      .eq('pattern', params.pagePath)
      .limit(1);

    if (exactError) {
      console.warn('[TRACK_PATH_RULES_EXACT_QUERY_FAILED]', {
        request_id: params.requestId,
        error_code: exactError.code,
        error_message: exactError.message
      });
    } else {
      const rule = (exactRules || [])[0] as PathRuleRow | undefined;
      if (rule?.is_blocked) return rule;
    }

    const { data: prefixRules, error: prefixError } = await params.client
      .from('h2s_tracking_path_rules')
      .select('id,pattern,match_type,is_blocked,reason')
      .eq('is_blocked', true)
      .eq('match_type', 'prefix')
      .limit(500);

    if (prefixError) {
      console.warn('[TRACK_PATH_RULES_PREFIX_QUERY_FAILED]', {
        request_id: params.requestId,
        error_code: prefixError.code,
        error_message: prefixError.message
      });
      return null;
    }

    const candidates = (prefixRules || []) as PathRuleRow[];
    let best: PathRuleRow | null = null;
    for (const r of candidates) {
      const p = String(r.pattern || '').trim().toLowerCase();
      if (!p) continue;
      if (params.pagePath === p || params.pagePath.startsWith(`${p}/`) || params.pagePath.startsWith(p)) {
        if (!best || p.length > String(best.pattern).length) best = r;
      }
    }
    return best;
  } catch (e: any) {
    console.warn('[TRACK_PATH_RULES_QUERY_EXCEPTION]', {
      request_id: params.requestId,
      error: e?.message || String(e)
    });
    return null;
  }
}

export async function POST(request: Request) {
  // PART 3: Deterministic backend contract
  const requestId = crypto.randomUUID();
  const startTime = Date.now();
  
  // PART 5: Observability - log request start
  console.log('[TRACK_POST_START]', {
    request_id: requestId,
    method: 'POST',
    route: '/api/track',
    timestamp: new Date().toISOString()
  });

  let body: any;
  try {
    body = await request.json();
  } catch (error: any) {
    console.error('[TRACK_POST_ERROR]', {
      request_id: requestId,
      error: 'Invalid JSON',
      message: error.message
    });
    // Just accept empty body and generate defaults
    body = {};
  }

  // PART 5: Log payload keys
  console.log('[TRACK_POST_PAYLOAD]', {
    request_id: requestId,
    payload_keys: Object.keys(body),
    has_visitor_id: !!body.visitor_id,
    has_customer_email: !!body.customer_email,
    has_customer_phone: !!body.customer_phone
  });

  try {
    // Get database client
    const db1Client = getSupabaseDb1();
    const mainClient = getSupabase();
    const client = db1Client || mainClient;

    if (!client) {
      console.error('[TRACK_POST_ERROR]', {
        request_id: requestId,
        error: 'NO_DATABASE_CLIENT',
        message: 'No database client available'
      });
      return NextResponse.json({
        ok: false,
        code: 'SUPABASE_ERROR',
        request_id: requestId,
        message: 'Database connection not available',
        details: {}
      }, { status: 500, headers: corsHeaders(request) });
    }

    const cookies = parseCookies(request);

    // STEP 1: Ensure visitor_id exists (generate if not provided or invalid)
    let visitorId = ensureUUID(body.visitor_id || body.user_id || body.Visitor_ID || body.User_ID);
    
    if (!visitorId) {
      visitorId = crypto.randomUUID();
      console.log('[TRACK_POST_VISITOR_GENERATED]', {
        request_id: requestId,
        visitor_id: visitorId,
        reason: 'No valid visitor_id provided'
      });
    } else {
      console.log('[TRACK_POST_VISITOR_VALID]', {
        request_id: requestId,
        visitor_id: visitorId.substring(0, 20) + '...'
      });
    }

    // Extract + normalize event type
    const eventNameRaw = body.event_name || body.event_type || body.Event_Type || 'page_view';
    const eventName = normalizeEventType(eventNameRaw);
    const eventTs = body.occurred_at || body.event_time || body.Event_Time || new Date().toISOString();
    
    // Ensure session_id exists (prefer payload, then cookie) - required by analytics for true session counts
    let sessionId = ensureUUID(body.session_id || body.Session_ID) || ensureUUID(cookies.session_id);
    if (!sessionId) {
      sessionId = crypto.randomUUID();
      console.log('[TRACK_POST_SESSION_GENERATED]', {
        request_id: requestId,
        session_id: sessionId.substring(0, 20) + '...',
        reason: 'No valid session_id provided (payload/cookie)'
      });
    }
    
    // Extract customer identity (for linking)
    const customerEmail = normalizeIdentity('email', body.customer_email || body.Customer_Email || body?.metadata?.customer_email || body?.metadata?.email);
    const customerPhone = extractPhoneFromTrackingPayload(body) || null;

    // STEP 2: Upsert visitor row (last_seen_at)
    const visitorData: any = {
      visitor_id: visitorId,
      last_seen_at: eventTs,
      user_agent: body.user_agent || body.User_Agent || null,
      last_utm_source: body.utm_source || body.UTM_Source || null,
      last_utm_medium: body.utm_medium || body.UTM_Medium || null,
      last_utm_campaign: body.utm_campaign || body.UTM_Campaign || null,
      last_utm_term: body.utm_term || body.UTM_Term || null,
      last_utm_content: body.utm_content || body.UTM_Content || null,
      last_referrer: body.referrer || null,
      device_type: body.device_type || body.Device_Type || null
    };

    // Set first_seen_at only if this is a new visitor
    const { data: existingVisitor } = await client
      .from('h2s_tracking_visitors')
      .select('visitor_id, first_seen_at')
      .eq('visitor_id', visitorId)
      .maybeSingle();

    if (!existingVisitor) {
      visitorData.first_seen_at = eventTs;
      visitorData.first_utm_source = body.utm_source || body.UTM_Source || null;
      visitorData.first_utm_medium = body.utm_medium || body.UTM_Medium || null;
      visitorData.first_utm_campaign = body.utm_campaign || body.UTM_Campaign || null;
      visitorData.first_utm_term = body.utm_term || body.UTM_Term || null;
      visitorData.first_utm_content = body.utm_content || body.UTM_Content || null;
      visitorData.first_referrer = body.referrer || null;
    }

    const { error: visitorError } = await client
      .from('h2s_tracking_visitors')
      .upsert(visitorData, {
        onConflict: 'visitor_id'
      });

    if (visitorError) {
      console.error('[TRACK_POST_VISITOR_ERROR]', {
        request_id: requestId,
        visitor_id: visitorId.substring(0, 20) + '...',
        error_code: visitorError.code,
        error_message: visitorError.message,
        error_details: visitorError.details,
        error_hint: visitorError.hint
      });
      return NextResponse.json({
        ok: false,
        code: 'SUPABASE_ERROR',
        request_id: requestId,
        message: 'Failed to upsert visitor',
        details: {
          code: visitorError.code,
          message: visitorError.message,
          details: visitorError.details,
          hint: visitorError.hint
        }
      }, { status: 500, headers: corsHeaders(request) });
    }

    console.log('[TRACK_POST_VISITOR_SUCCESS]', {
      request_id: requestId,
      visitor_id: visitorId.substring(0, 20) + '...',
      is_new: !existingVisitor
    });

    // STEP 3: Insert event row
    // If the client retries, they should resend the same event_id; we treat duplicates as success.
    const eventId =
      ensureUUID(body.event_id || body.Event_ID || body.EventId) ||
      crypto.randomUUID();
    
    // Normalize page_path (do NOT store page_url)
    const pagePath = normalizePagePathFromPayload(body);

    // HARD BLOCK: ignore events with non-allowlisted event types.
    if (!isAllowedEventType(eventName)) {
      const res = NextResponse.json(
        {
          ok: true,
          request_id: requestId,
          visitor_id: visitorId,
          session_id: sessionId,
          ignored: true,
          reason: 'event_type_not_allowlisted',
          event_type: eventName
        },
        { status: 200, headers: corsHeaders(request) }
      );

      if (process.env.NODE_ENV === 'production') {
        res.headers.append('Set-Cookie', buildVisitorCookie({ request, visitorId }));
        res.headers.append('Set-Cookie', buildSessionCookie({ request, sessionId }));
      }

      return res;
    }

    // HARD BLOCK: ignore events with no usable page_path.
    if (!pagePath) {
      const res = NextResponse.json(
        {
          ok: true,
          request_id: requestId,
          visitor_id: visitorId,
          session_id: sessionId,
          ignored: true,
          reason: 'missing_or_invalid_page_path',
          event_type: eventName
        },
        { status: 200, headers: corsHeaders(request) }
      );

      if (process.env.NODE_ENV === 'production') {
        res.headers.append('Set-Cookie', buildVisitorCookie({ request, visitorId }));
        res.headers.append('Set-Cookie', buildSessionCookie({ request, sessionId }));
      }

      return res;
    }

    // Track every observed path (including ones we later ignore) so admins can discover + block paths.
    await upsertObservedPath({ client, pagePath, eventTs, requestId });

    // HARD BLOCK: ignore events for dynamically blocked paths.
    const blockingRule = await findBlockingPathRule({ client, pagePath, requestId });
    if (blockingRule) {
      const res = NextResponse.json(
        {
          ok: true,
          request_id: requestId,
          visitor_id: visitorId,
          session_id: sessionId,
          ignored: true,
          reason: 'dynamic_page_path_blocked',
          page_path: pagePath,
          rule: {
            id: blockingRule.id,
            match_type: blockingRule.match_type,
            pattern: blockingRule.pattern,
            reason: blockingRule.reason || null
          }
        },
        {
          status: 200,
          headers: corsHeaders(request)
        }
      );

      if (process.env.NODE_ENV === 'production') {
        res.headers.append('Set-Cookie', buildVisitorCookie({ request, visitorId }));
        res.headers.append('Set-Cookie', buildSessionCookie({ request, sessionId }));
      }

      return res;
    }

    // HARD BLOCK: do not store tracking events for internal/admin pages.
    // This prevents /funnels, /dashboard, /portal, /dispatch from inflating KPIs.
    // NOTE: We still recorded the page_path above in h2s_tracking_observed_paths.
    if (isInternalTrackingPath(pagePath)) {
      const res = NextResponse.json(
        {
          ok: true,
          request_id: requestId,
          visitor_id: visitorId,
          session_id: sessionId,
          ignored: true,
          reason: 'internal_page_path_blocked',
          page_path: pagePath
        },
        {
          status: 200,
          headers: corsHeaders(request)
        }
      );

      if (process.env.NODE_ENV === 'production') {
        res.headers.append('Set-Cookie', buildVisitorCookie({ request, visitorId }));
        res.headers.append('Set-Cookie', buildSessionCookie({ request, sessionId }));
      }

      return res;
    }
    
    const eventData: any = {
      id: eventId,
      event_id: eventId,
      visitor_id: visitorId,
      event_type: eventName,  // Database requires event_type (NOT NULL)
      event_name: eventName,  // Also populate event_name for compatibility
      event_ts: eventTs,
      session_id: sessionId,
      // Intentionally do NOT persist raw page_url (too noisy; can include query params).
      page_url: null,
      page_path: pagePath,
      referrer: body.referrer || null,
      user_agent: body.user_agent || body.User_Agent || null,
      utm_source: body.utm_source || body.UTM_Source || null,
      utm_medium: body.utm_medium || body.UTM_Medium || null,
      utm_campaign: body.utm_campaign || body.UTM_Campaign || null,
      utm_term: body.utm_term || body.UTM_Term || null,
      utm_content: body.utm_content || body.UTM_Content || null,
      revenue_amount: normalizeRevenueInput(body.revenue_amount ?? body.revenue ?? body.Value),
      order_id: ensureUUID(body.order_id || body.Order_ID) || null,
      customer_email: customerEmail,
      customer_phone: customerPhone
    };

    // Build properties JSONB from metadata
    const properties: any = {};
    if (body.metadata) {
      Object.assign(properties, typeof body.metadata === 'string' ? JSON.parse(body.metadata) : body.metadata);
    }
    if (body.element_id) properties.element_id = body.element_id;
    if (body.element_text) properties.element_text = body.element_text;
    if (body.element_href) properties.element_href = body.element_href;
    if (body.outbound_url) properties.outbound_url = body.outbound_url;
    if (customerPhone) properties.customer_phone_normalized = customerPhone;
    if (Object.keys(properties).length > 0) {
      eventData.properties = properties;
    }

    const { data: insertedEvent, error: eventError } = await client
      .from('h2s_tracking_events')
      .insert(eventData)
      .select('id')
      .single();

    if (eventError) {
      // Graceful de-dupe: if the event_id already exists, treat as success.
      // Postgres unique violation is 23505.
      if (eventError.code === '23505') {
        console.warn('[TRACK_POST_EVENT_DUPLICATE]', {
          request_id: requestId,
          event_id: eventId,
          visitor_id: visitorId.substring(0, 20) + '...'
        });

        const res = NextResponse.json(
          {
            ok: true,
            request_id: requestId,
            visitor_id: visitorId,
            customer_id: null,
            inserted_event_id: eventId,
            duplicate: true
          },
          { status: 200, headers: corsHeaders(request) }
        );

        if (process.env.NODE_ENV === 'production') {
          res.headers.append('Set-Cookie', buildVisitorCookie({ request, visitorId }));
          res.headers.append('Set-Cookie', buildSessionCookie({ request, sessionId }));
        }

        return res;
      }

      console.error('[TRACK_POST_EVENT_ERROR]', {
        request_id: requestId,
        visitor_id: visitorId.substring(0, 20) + '...',
        error_code: eventError.code,
        error_message: eventError.message,
        error_details: eventError.details,
        error_hint: eventError.hint
      });
      return NextResponse.json({
        ok: false,
        code: 'SUPABASE_ERROR',
        request_id: requestId,
        message: 'Failed to insert event',
        details: {
          code: eventError.code,
          message: eventError.message,
          details: eventError.details,
          hint: eventError.hint
        }
      }, { status: 500, headers: corsHeaders(request) });
    }

    console.log('[TRACK_POST_EVENT_SUCCESS]', {
      request_id: requestId,
      event_id: eventId,
      visitor_id: visitorId.substring(0, 20) + '...'
    });

    // STEP 4: Attempt identity linking (non-blocking)
    let customerId: string | null = null;
    const warnings: string[] = [];

    if (customerEmail || customerPhone) {
      try {
        // Check if identity exists
        const identityQueries = [];
        if (customerEmail) {
          identityQueries.push(
            client.from('h2s_customer_identities')
              .select('customer_id')
              .eq('identity_type', 'email')
              .eq('identity_value_normalized', customerEmail)
              .maybeSingle()
          );
        }
        if (customerPhone) {
          identityQueries.push(
            client.from('h2s_customer_identities')
              .select('customer_id')
              .eq('identity_type', 'phone')
              .eq('identity_value_normalized', customerPhone)
              .maybeSingle()
          );
        }

        const identityResults = await Promise.all(identityQueries);
        const foundIdentity = identityResults.find(r => r.data?.customer_id);

        if (foundIdentity?.data?.customer_id) {
          customerId = foundIdentity.data.customer_id;
          
          // Update event with customer_id
          await client
            .from('h2s_tracking_events')
            .update({ customer_id: customerId })
            .eq('id', eventId);

          console.log('[TRACK_POST_IDENTITY_LINKED]', {
            request_id: requestId,
            customer_id: customerId,
            identity_type: customerEmail ? 'email' : 'phone'
          });
        } else {
          warnings.push('Identity linking attempted but no customer_id found');
        }
      } catch (identityError: any) {
        warnings.push(`Identity linking failed: ${identityError.message}`);
        console.warn('[TRACK_POST_IDENTITY_WARNING]', {
          request_id: requestId,
          warning: identityError.message
        });
      }
    }

    // PART 5: Log completion
    const duration = Date.now() - startTime;
    console.log('[TRACK_POST_SUCCESS]', {
      request_id: requestId,
      visitor_id: visitorId.substring(0, 20) + '...',
      event_id: eventId,
      customer_id: customerId,
      duration_ms: duration
    });

    // Build response
    const response: any = {
      ok: true,
      request_id: requestId,
      visitor_id: visitorId,
      customer_id: customerId,
      inserted_event_id: eventId,
      warnings: warnings.length > 0 ? warnings : undefined
    };

    // PART 3: Set cookie fallback (in production)
    const res = NextResponse.json(response, {
      status: 200,
      headers: corsHeaders(request)
    });

    if (process.env.NODE_ENV === 'production') {
      res.headers.append('Set-Cookie', buildVisitorCookie({ request, visitorId }));
      res.headers.append('Set-Cookie', buildSessionCookie({ request, sessionId }));
    }

    return res;

  } catch (error: any) {
    // PART 5: Comprehensive error handling
    console.error('[TRACK_POST_FATAL_ERROR]', {
      request_id: requestId,
      error_type: error.constructor.name,
      error_message: error.message,
      error_stack: error.stack?.substring(0, 500)
    });

    return NextResponse.json({
      ok: false,
      code: 'INTERNAL_ERROR',
      request_id: requestId,
      message: error.message || 'Internal server error',
      details: {
        type: error.constructor.name,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      }
    }, { status: 500, headers: corsHeaders(request) });
  }
}

import { NextResponse } from 'next/server';
import { getSupabase, getSupabaseDispatch } from '@/lib/supabase';
import { verifyPortalToken } from '@/lib/portalTokens';
import { ensureDispatchOfferAssignmentForJob } from '@/lib/dispatchOfferAssignment';

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
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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

function safeParseJson(value: any): any {
  if (!value) return null;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function extractUsCityStateZip(input: string): { city?: string; state?: string; zip?: string } {
  const s = String(input || '').trim();
  if (!s) return {};
  const m = s.match(/(?:^|,\s*)([^,]{2,}?)\s*,\s*([A-Za-z]{2})\s*(\d{5}(?:-\d{4})?)?\s*$/);
  if (!m) return {};
  const city = String(m[1] || '').trim();
  const state = String(m[2] || '').trim().toUpperCase();
  const zip = String(m[3] || '').trim();
  return {
    ...(city ? { city } : {}),
    ...(state ? { state } : {}),
    ...(zip ? { zip } : {}),
  };
}

function parseTimeLabelTo24Hour(timeLabel: string): { hour: number; minute: number } | null {
  const match = String(timeLabel || '').trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const isPm = match[3].toUpperCase() === 'PM';
  if (Number.isNaN(hour) || Number.isNaN(minute)) return null;
  if (isPm && hour !== 12) hour += 12;
  if (!isPm && hour === 12) hour = 0;
  return { hour, minute };
}

function computeStartIsoFromWindow(deliveryDate: string, deliveryTime: string): string | null {
  const firstPart = String(deliveryTime || '').split('-')[0]?.trim();
  if (!firstPart) return null;
  const parsed = parseTimeLabelTo24Hour(firstPart);
  if (!parsed) return null;
  const hh = String(parsed.hour).padStart(2, '0');
  const mm = String(parsed.minute).padStart(2, '0');
  return `${deliveryDate}T${hh}:${mm}:00`;
}

function estimatePayout(order: any): number | null {
  const subtotal = Number(order?.subtotal ?? order?.order_subtotal ?? order?.total ?? 0);
  if (!Number.isFinite(subtotal) || subtotal <= 0) return null;
  let payout = Math.floor(subtotal * 0.35);
  const svc = String(order?.service_name || order?.service_id || '').toLowerCase();
  if (payout < 45 && svc.includes('mount')) payout = 45;
  const MIN = 35;
  const MAX_PCT = 0.45;
  payout = Math.max(MIN, payout);
  payout = Math.min(payout, subtotal * MAX_PCT);
  return Math.round(payout * 100) / 100;
}

async function handle(request: Request, token: string, options?: { limit?: number }) {
  if (!token) {
    return NextResponse.json({ ok: false, error: 'Missing token', error_code: 'bad_session' }, { status: 401, headers: corsHeaders(request) });
  }

  let payload;
  try {
    payload = verifyPortalToken(token);
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'Invalid token', error_code: 'bad_session' }, { status: 401, headers: corsHeaders(request) });
  }

  if (payload.role !== 'admin') {
    return NextResponse.json({ ok: false, error: 'Not an admin session', error_code: 'bad_session' }, { status: 401, headers: corsHeaders(request) });
  }

  const main = getSupabase();
  if (!main) {
    return NextResponse.json({ ok: false, error: 'Database not available', error_code: 'db_unavailable' }, { status: 503, headers: corsHeaders(request) });
  }

  const dispatch = getSupabaseDispatch() || main;

  const limit = Math.min(1000, Math.max(1, Number(options?.limit || 500)));

  // Pull latest orders; this is a backfill tool.
  const { data: orders, error: ordersError } = await main
    .from('h2s_orders')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (ordersError) {
    return NextResponse.json({ ok: false, error: ordersError.message }, { status: 500, headers: corsHeaders(request) });
  }

  const rows: any[] = Array.isArray(orders) ? orders : [];

  let created = 0;
  let skipped = 0;
  let errors = 0;

  for (const order of rows) {
    const canonicalOrderId = String(order?.id || '').trim();
    if (!canonicalOrderId) {
      skipped++;
      continue;
    }

    const orderIdText = String(order?.order_id || '').trim();
    const sessionId = String(order?.session_id || '').trim();

    // Skip if job already exists for this order.
    const lookupKeys = Array.from(new Set([canonicalOrderId, orderIdText, sessionId].filter(Boolean)));
    let existingJob: any = null;
    for (const k of lookupKeys) {
      try {
        const { data } = await dispatch.from('h2s_dispatch_jobs').select('job_id, order_id').eq('order_id', k).single();
        if (data) {
          existingJob = data;
          break;
        }
      } catch {
        // ignore
      }
    }

    if (existingJob?.job_id) {
      skipped++;
      continue;
    }

    const meta = safeParseJson(order?.metadata_json) || safeParseJson(order?.metadata) || {};

    const address = String(
      meta?.service_address ||
        meta?.address ||
        order?.service_address ||
        order?.address ||
        order?.shipping_address ||
        ''
    ).trim();

    const parsedTail = extractUsCityStateZip(address);

    const city = String(
      meta?.service_city ||
        meta?.city ||
        meta?.serviceCity ||
        order?.service_city ||
        order?.city ||
        order?.shipping_city ||
        parsedTail.city ||
        ''
    ).trim();

    const state = String(
      meta?.service_state ||
        meta?.state ||
        meta?.state_code ||
        meta?.serviceState ||
        order?.service_state ||
        order?.state ||
        order?.shipping_state ||
        parsedTail.state ||
        ''
    ).trim();

    const zip = String(
      meta?.service_zip ||
        meta?.zip ||
        meta?.zip_code ||
        meta?.postal_code ||
        meta?.serviceZip ||
        order?.service_zip ||
        order?.zip ||
        order?.shipping_zip ||
        order?.zip_code ||
        parsedTail.zip ||
        ''
    ).trim();

    const customerName = String(order?.customer_name || meta?.customer_name || order?.name || '').trim();
    const customerEmail = String(order?.customer_email || meta?.customer_email || '').trim();
    const customerPhone = String(order?.customer_phone || order?.phone || meta?.customer_phone || '').trim();

    const serviceId = String(order?.service_id || meta?.service_id || order?.service_name || meta?.service_name || '').trim() || null;
    let serviceName = String(order?.service_name || meta?.service_name || '').trim() || null;
    
    // 🔧 ENRICHMENT: Build better service name from items if generic/missing
    if (!serviceName || serviceName.match(/^\d+\s*(tv|TV|item)/i)) {
      const itemsForName = order?.items || meta?.items_json || meta?.items || meta?.cart_items_parsed;
      if (itemsForName) {
        try {
          const items = typeof itemsForName === 'string' ? JSON.parse(itemsForName) : itemsForName;
          if (Array.isArray(items) && items.length > 0) {
            // Build descriptive name from items (e.g., "2x TV Mounting, 1x Wire Concealment")
            const itemNames = items.map((item: any) => {
              const qty = item.qty || item.quantity || 1;
              const name = item.service_name || item.name || item.bundle_id || item.description || 'Service';
              return qty > 1 ? `${qty}x ${name}` : name;
            }).filter(Boolean);
            if (itemNames.length > 0) {
              serviceName = itemNames.slice(0, 3).join(', '); // Max 3 items in summary
              if (items.length > 3) serviceName += ` + ${items.length - 3} more`;
            }
          }
        } catch {
          // Keep existing serviceName if enrichment fails
        }
      }
    }

    const deliveryDate = String(order?.delivery_date || meta?.delivery_date || '').trim();
    const deliveryTime = String(order?.delivery_time || meta?.delivery_time || '').trim();

    const hasSchedule = /^\d{4}-\d{2}-\d{2}$/.test(deliveryDate) && !!deliveryTime;
    const startIso = hasSchedule ? computeStartIsoFromWindow(deliveryDate, deliveryTime) : null;

    const payout = estimatePayout(order);

    // Parse items from order for technician visibility
    let itemsJson = null;
    try {
      // Try multiple sources for items
      const itemsRaw = order?.items || meta?.items_json || meta?.items || meta?.cart_items_parsed || meta?.cart_items || order?.order_items;
      if (itemsRaw) {
        if (typeof itemsRaw === 'string') {
          itemsJson = JSON.parse(itemsRaw);
        } else if (Array.isArray(itemsRaw)) {
          itemsJson = itemsRaw;
        } else if (typeof itemsRaw === 'object') {
          // If it's an object, try to extract an array from it
          itemsJson = itemsRaw.items || [itemsRaw];
        }
      }
    } catch {
      // If items can't be parsed, leave as null
    }

    const jobPayload: any = {
      // Use dispatch-native statuses so portal/EmployeeDashboard sees these as offers.
      status: hasSchedule ? 'scheduled' : 'pending_assign',
      order_id: canonicalOrderId,
      service_id: serviceId,
      service_name: serviceName,
      customer_email: customerEmail || null,
      customer_name: customerName || null,
      customer_phone: customerPhone || null,
      service_address: address || null,
      service_city: city || null,
      service_state: state || null,
      service_zip: zip || null,
      start_iso: startIso,
      created_at: new Date().toISOString(),
      metadata: {
        ...(meta || {}),
        order_id_text: orderIdText || null,
        session_id: sessionId || null,
        estimated_payout: payout ?? meta?.estimated_payout ?? null,
        items_json: itemsJson,
        migrated_from_orders: true,
        // 🔧 ENRICHMENT: Preserve critical order details for tech reference
        order_subtotal: order?.subtotal || order?.order_subtotal || null,
        order_total: order?.total || order?.order_total || null,
        delivery_date: deliveryDate || null,
        delivery_time: deliveryTime || null,
        referral_code: meta?.referral_code || null,
        referrer_email: meta?.referrer_email || null,
        customer_notes: meta?.customer_notes || meta?.notes || meta?.special_instructions || null,
        source: meta?.source || meta?._source || 'shop',
        // Payment traceability
        stripe_session_id: sessionId || null,
        payment_status: order?.payment_status || order?.status || null,
      },
    };

    try {
      const { data: newJob, error: jobError } = await dispatch.from('h2s_dispatch_jobs').insert(jobPayload).select('job_id').single();
      if (jobError || !newJob?.job_id) {
        errors++;
        continue;
      }

      created++;

      // Optional: attempt auto-assign when we have scheduling info.
      if (hasSchedule) {
        try {
          const { data: assignedPro } = await dispatch.rpc('auto_assign_job_to_pro', {
            p_job_id: String(newJob.job_id),
            p_service_id: serviceId || serviceName || null,
            p_date: deliveryDate,
            p_time_slot: deliveryTime,
            p_customer_lat: 34.8526,
            p_customer_lng: -82.394,
          });

          await ensureDispatchOfferAssignmentForJob(dispatch, {
            jobId: String(newJob.job_id),
            proValue: assignedPro ? String(assignedPro) : null,
            state: 'offer_sent',
            status: 'offer_sent',
          });
        } catch {
          // non-fatal
        }
      }
    } catch {
      errors++;
    }
  }

  return NextResponse.json(
    {
      ok: true,
      total_orders: rows.length,
      created_jobs: created,
      skipped_orders: skipped,
      errors,
    },
    { headers: corsHeaders(request) }
  );
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get('token') || '';
    const limit = searchParams.get('limit');
    return await handle(request, token, { limit: limit ? Number(limit) : undefined });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || 'Internal error' }, { status: 500, headers: corsHeaders(request) });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const token = String(body?.token || '');
    const limit = body?.limit;
    return await handle(request, token, { limit: limit ? Number(limit) : undefined });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || 'Internal error' }, { status: 500, headers: corsHeaders(request) });
  }
}

import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { getSupabaseDispatch } from '@/lib/supabase';
import { ensureDispatchOfferAssignmentForJob } from '@/lib/dispatchOfferAssignment';
import { resolveDispatchRequiredIds } from '@/lib/dispatchRequiredIds';
import twilio from 'twilio';

// Initialize Twilio client for customer notifications
const twilioClient = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
  ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  : null;

/**
 * Calculates technician payout from order data
 * BUSINESS RULES:
 * - Base: 35% of subtotal
 * - Floor: $35 minimum ($45 for TV mounting)
 * - Cap: 45% of subtotal maximum
 */
function estimatePayout(order: any): number {
  const subtotal = Number(order?.order_subtotal || order?.subtotal || order?.order_total || order?.total || 0);
  if (!Number.isFinite(subtotal) || subtotal <= 0) return 35; // Return minimum if no valid subtotal
  
  let payout = Math.floor(subtotal * 0.35);
  
  // Apply floor
  const MIN = 35;
  payout = Math.max(MIN, payout);
  
  // Special rule: TV mounting minimum is $45
  const serviceId = String(order?.service_id || order?.service_name || '').toLowerCase();
  if (payout < 45 && (serviceId.includes('mount') || serviceId.includes('tv'))) {
    payout = 45;
  }
  
  // Apply cap
  const MAX_PCT = 0.45;
  if (subtotal > 0) {
    payout = Math.min(payout, subtotal * MAX_PCT);
  }
  
  return Math.round(payout * 100) / 100;
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
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

function formatDate(dateStr: string) {
  try {
    const d = new Date(`${dateStr}T00:00:00`);
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

function parseTimeLabelTo24Hour(timeLabel: string): { hour: number; minute: number } | null {
  // Accepts "2:00 PM" (case-insensitive)
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
  // "2:00 PM - 5:00 PM" -> 14:00; "2:00 PM" -> 14:00
  const firstPart = String(deliveryTime || '').split('-')[0]?.trim();
  if (!firstPart) return null;
  const parsed = parseTimeLabelTo24Hour(firstPart);
  if (!parsed) return null;
  const hh = String(parsed.hour).padStart(2, '0');
  const mm = String(parsed.minute).padStart(2, '0');
  // Keep it local-ish; legacy code often stores as "YYYY-MM-DDTHH:MM:SS".
  return `${deliveryDate}T${hh}:${mm}:00`;
}

function extractMissingColumnFromSupabaseError(err: any): string | null {
  const msg = String(err?.message || '');
  const m = msg.match(/Could not find the '([^']+)' column/i);
  if (m && m[1]) return m[1];
  return null;
}

function stripUndefinedKeys(obj: any) {
  if (!obj || typeof obj !== 'object') return obj;
  for (const k of Object.keys(obj)) {
    if (obj[k] === undefined) delete obj[k];
  }
  return obj;
}

function extractNotNullColumnFromSupabaseError(err: any): string | null {
  const msg = String(err?.message || '');
  // Examples:
  // - null value in column "recipient_id" violates not-null constraint
  // - null value in column "recipient_id" of relation "h2s_dispatch_jobs" violates not-null constraint
  const m = msg.match(/null value in column\s+"([^"]+)"(?:\s+of\s+relation\s+"[^"]+")?\s+violates not-null constraint/i);
  return m?.[1] || null;
}

async function computeNextSequenceId(dispatch: any): Promise<number | null> {
  try {
    const { data, error } = await dispatch
      .from('h2s_dispatch_jobs')
      .select('sequence_id')
      .order('sequence_id', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) return null;
    const current = (data as any)?.sequence_id;
    const n = typeof current === 'number' ? current : Number(current);
    if (!Number.isFinite(n)) return 1;
    return Math.max(1, Math.floor(n) + 1);
  } catch {
    return null;
  }
}

async function pickExistingRecipientIdFromJobs(dispatch: any): Promise<string | null> {
  try {
    const { data, error } = await dispatch
      .from('h2s_dispatch_jobs')
      .select('recipient_id')
      .order('created_at', { ascending: false })
      .limit(5);
    if (error || !Array.isArray(data)) return null;
    for (const row of data) {
      const rid = String((row as any)?.recipient_id ?? '').trim();
      if (rid) return rid;
    }
    return null;
  } catch {
    return null;
  }
}

async function pickDispatchRecipientId(dispatch: any): Promise<string | null> {
  const fromEnv = String(process.env.DEFAULT_DISPATCH_RECIPIENT_ID || '').trim();
  if (fromEnv) return fromEnv;

  if (!dispatch) return null;

  // Best-effort: reuse an existing valid recipient_id from any existing job.
  try {
    const { data } = await dispatch
      .from('h2s_dispatch_jobs')
      .select('recipient_id')
      .not('recipient_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const v = String((data as any)?.recipient_id || '').trim();
    if (v) return v;
  } catch {
    // ignore
  }

  // Fallback: try a recipients table if one exists.
  for (const table of ['h2s_dispatch_recipients', 'dispatch_recipients', 'recipients']) {
    try {
      const { data, error } = await dispatch.from(table).select('*').limit(1);
      if (error) continue;
      const row = Array.isArray(data) ? data[0] : null;
      if (!row) continue;
      const candidates = [row.recipient_id, row.id, row.uuid, row.user_id];
      for (const c of candidates) {
        const s = String(c || '').trim();
        if (s) return s;
      }
    } catch {
      // ignore
    }
  }

  return null;
}

async function pickFallbackRecipientId(dispatch: any, geoLat: number | null, geoLng: number | null): Promise<string | null> {
  try {
    // 1) Prefer reusing any existing recipient_id from recent jobs.
    try {
      const { data: recent, error: recentErr } = await dispatch
        .from('h2s_dispatch_jobs')
        .select('recipient_id, created_at')
        .not('recipient_id', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1);
      if (!recentErr && Array.isArray(recent) && recent.length) {
        const rid = String((recent[0] as any)?.recipient_id ?? '').trim();
        if (rid) return rid;
      }
    } catch {
      // ignore
    }

    // 2) Env override if configured.
    const envRid = String(
      process.env.DISPATCH_DEFAULT_RECIPIENT_ID ||
        process.env.DEFAULT_RECIPIENT_ID ||
        process.env.PORTAL_DEFAULT_RECIPIENT_ID ||
        ''
    ).trim();
    if (envRid) return envRid;

    // 3) Try dispatch pros.
    const { data: pros, error } = await dispatch.from('h2s_dispatch_pros').select('*').limit(200);
    if (error || !Array.isArray(pros) || pros.length === 0) {
      return null;
    }

    const active = pros.filter((p: any) => {
      const st = String(p?.status ?? '').toLowerCase();
      return !st || st === 'active' || st === 'available' || st === 'enabled';
    });

    const list = active.length ? active : pros;

    const toRad = (d: number) => (d * Math.PI) / 180;
    const haversineMiles = (aLat: number, aLng: number, bLat: number, bLng: number) => {
      const R = 3958.7613;
      const dLat = toRad(bLat - aLat);
      const dLng = toRad(bLng - aLng);
      const s1 = Math.sin(dLat / 2);
      const s2 = Math.sin(dLng / 2);
      const aa = s1 * s1 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * s2 * s2;
      return 2 * R * Math.asin(Math.min(1, Math.sqrt(aa)));
    };

    let best = list[0];
    if (geoLat !== null && geoLng !== null) {
      let bestDist = Number.POSITIVE_INFINITY;
      for (const p of list) {
        const pLat = typeof p?.geo_lat === 'number' ? p.geo_lat : null;
        const pLng = typeof p?.geo_lng === 'number' ? p.geo_lng : null;
        if (pLat === null || pLng === null) continue;
        const d = haversineMiles(geoLat, geoLng, pLat, pLng);
        if (d < bestDist) {
          bestDist = d;
          best = p;
        }
      }
    }

    const candidate = String(best?.pro_id || best?.tech_id || best?.user_id || best?.id || '').trim();

    return candidate || null;
  } catch {
    return null;
  }
}

async function safeInsertDispatchJob(dispatch: any, initialPayload: any) {
  // Retries insert if PostgREST rejects unknown columns (schema cache mismatch).
  const payload = { ...initialPayload };
  stripUndefinedKeys(payload);

  const removed: string[] = [];
  let lastError: any = null;

  for (let i = 0; i < 50; i++) {
    const { data, error } = await dispatch
      .from('h2s_dispatch_jobs')
      .insert(payload)
      .select('job_id')
      .single();

    if (!error) return { data, error: null as any, payload, removed };

    lastError = error;

    // Handle NOT NULL constraints that may appear in the dispatch DB schema.
    // This prevents deploy-time schema drift from breaking checkout/scheduling flows.
    if (String(error?.code || '') === '23502') {
      const col = extractNotNullColumnFromSupabaseError(error);
      if ((col === 'sequence_id' || col === 'recipient_id' || col === 'step_id') && (payload as any)[col] == null) {
        const picked = await resolveDispatchRequiredIds(dispatch);
        if (col === 'sequence_id' && picked.sequenceId) {
          payload.sequence_id = picked.sequenceId;
          continue;
        }
        if (col === 'recipient_id' && picked.recipientId) {
          payload.recipient_id = picked.recipientId;
          continue;
        }
        if (col === 'step_id' && picked.stepId) {
          payload.step_id = picked.stepId;
          continue;
        }

        return { data: null, error, payload, removed };
      }
    }

    const missing = extractMissingColumnFromSupabaseError(error);
    if (missing && missing in payload) {
      delete payload[missing];
      removed.push(missing);
      continue;
    }

    return { data: null, error, payload, removed };
  }

  return { data: null, error: lastError || { message: 'Insert failed after retries' }, payload, removed };
}

async function safeUpdateDispatchJob(dispatch: any, jobId: string, initialPayload: any) {
  const payload = { ...initialPayload };
  stripUndefinedKeys(payload);

  const removed: string[] = [];
  let lastError: any = null;

  for (let i = 0; i < 50; i++) {
    const res = await dispatch
      .from('h2s_dispatch_jobs')
      .update(payload)
      .eq('job_id', jobId);

    if (!res?.error) return { error: null as any, payload, removed };

    lastError = res.error;
    const missing = extractMissingColumnFromSupabaseError(res.error);
    if (missing && missing in payload) {
      delete payload[missing];
      removed.push(missing);
      continue;
    }

    return { error: res.error, payload, removed };
  }

  return { error: lastError || { message: 'Update failed after retries' }, payload, removed };
}

async function geocodeAddress(address: string, city: string, state: string, zip: string) {
  if (!address || !city || !state) return { lat: null as number | null, lng: null as number | null };
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return { lat: null as number | null, lng: null as number | null };
  const full = `${address}, ${city}, ${state} ${zip || ''}`.trim();

  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(full)}&key=${encodeURIComponent(key)}`;
    const resp = await fetch(url);
    const data = await resp.json();
    if (data?.status === 'OK' && Array.isArray(data?.results) && data.results.length > 0) {
      const loc = data.results[0]?.geometry?.location;
      if (typeof loc?.lat === 'number' && typeof loc?.lng === 'number') {
        return { lat: loc.lat as number, lng: loc.lng as number };
      }
    }
  } catch {
    // non-fatal
  }

  return { lat: null as number | null, lng: null as number | null };
}

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders() });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    // ===== Legacy mode (bundles-success scheduling) =====
    // Expected payload: { order_id, delivery_date, delivery_time, start_iso, end_iso, timezone }
    if (body?.order_id && body?.delivery_date && body?.delivery_time) {
      const orderKey = String(body.order_id || '').trim();
      const delivery_date = String(body.delivery_date || '').trim();
      const delivery_time = String(body.delivery_time || '').trim();
      const dryRun = body?.dry_run === true;
      const start_iso = body.start_iso ? String(body.start_iso) : null;
      const end_iso = body.end_iso ? String(body.end_iso) : null;
      const timezone = body.timezone ? String(body.timezone) : null;
      const lat = typeof body.lat === 'number' ? body.lat : null;
      const lng = typeof body.lng === 'number' ? body.lng : null;

      if (!orderKey) {
        return NextResponse.json({ ok: false, error: 'Missing order_id' }, { status: 400, headers: corsHeaders() });
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(delivery_date)) {
        return NextResponse.json({ ok: false, error: 'Invalid date format. Expected YYYY-MM-DD' }, { status: 400, headers: corsHeaders() });
      }
      if (!delivery_time) {
        return NextResponse.json({ ok: false, error: 'Missing delivery_time' }, { status: 400, headers: corsHeaders() });
      }

      const main = getSupabase();
      if (!main) {
        return NextResponse.json({ ok: false, error: 'Database not available' }, { status: 503, headers: corsHeaders() });
      }

      // Capacity check (non-blocking on error)
      try {
        const MAX_JOBS_PER_SLOT = 3;
        const { data: existing, error } = await main
          .from('h2s_orders')
          .select('id')
          .eq('delivery_date', delivery_date)
          .eq('delivery_time', delivery_time);
        if (!error && Array.isArray(existing) && existing.length >= MAX_JOBS_PER_SLOT) {
          return NextResponse.json(
            {
              ok: false,
              error: `This time slot is fully booked. We have ${existing.length} jobs already scheduled. Please choose a different date or time window.`,
              error_code: 'slot_full',
              spots_remaining: 0,
            },
            { status: 409, headers: corsHeaders() }
          );
        }
      } catch {
        // ignore
      }

      // Lookup order
      let orderQuery = main.from('h2s_orders').select('*');
      if (isUuid(orderKey)) orderQuery = orderQuery.eq('id', orderKey);
      else orderQuery = orderQuery.eq('order_id', orderKey);

      let orderRes = await orderQuery.single();
      if (orderRes.error || !orderRes.data) {
        // fallback by session_id
        orderRes = await main.from('h2s_orders').select('*').eq('session_id', orderKey).single();
      }
      if (orderRes.error || !orderRes.data) {
        return NextResponse.json({ ok: false, error: 'Order not found' }, { status: 404, headers: corsHeaders() });
      }

      const order: any = orderRes.data;
      const canonicalOrderId = String(order.order_id || order.id);  // Use order_id (ORD-XXX) not UUID id

      // Update order with scheduled appointment
      const { error: updateError } = await main
        .from('h2s_orders')
        .update({ delivery_date, delivery_time, updated_at: new Date().toISOString() })
        .eq('id', order.id);
      if (updateError) {
        return NextResponse.json({ ok: false, error: updateError.message }, { status: 500, headers: corsHeaders() });
      }

      // Derive address fields (prefer metadata_json)
      const metaObj = safeParseJson(order.metadata_json) || safeParseJson(order.metadata) || {};
      const address = String(metaObj?.service_address || metaObj?.address || order.service_address || order.address || order.shipping_address || '').trim();
      const city = String(metaObj?.service_city || metaObj?.city || order.service_city || order.city || order.shipping_city || '').trim();
      const state = String(metaObj?.service_state || metaObj?.state || order.service_state || order.state || order.shipping_state || '').trim();
      const zip = String(metaObj?.service_zip || metaObj?.zip || order.service_zip || order.zip || order.shipping_zip || '').trim();

      // Best-effort: hydrate first-class address columns on the order itself.
      // We only write columns that we can see on the fetched row to avoid schema mismatches.
      try {
        const patch: any = { updated_at: new Date().toISOString() };

        const setIfPresentAndEmpty = (col: string, value: string) => {
          if (!(col in order)) return;
          const cur = String(order[col] ?? '').trim();
          if (cur) return;
          if (!value) return;
          patch[col] = value;
        };

        setIfPresentAndEmpty('service_address', address);
        setIfPresentAndEmpty('service_city', city);
        setIfPresentAndEmpty('service_state', state);
        setIfPresentAndEmpty('service_zip', zip);

        // Common aliases
        setIfPresentAndEmpty('address', address);
        setIfPresentAndEmpty('city', city);
        setIfPresentAndEmpty('state', state);
        setIfPresentAndEmpty('zip', zip);
        setIfPresentAndEmpty('zip_code', zip);

        if (Object.keys(patch).length > 1) {
          const { error: addrErr } = await main.from('h2s_orders').update(patch).eq('id', canonicalOrderId);
          if (addrErr) console.warn('[Schedule] Order address hydration failed:', addrErr);
        }
      } catch (e) {
        console.warn('[Schedule] Order address hydration exception:', e);
      }

      // Geo (optional)
      let geoLat: number | null = lat;
      let geoLng: number | null = lng;
      if ((geoLat === null || geoLng === null) && address && city && state) {
        const geo = await geocodeAddress(address, city, state, zip);
        geoLat = geoLat ?? geo.lat;
        geoLng = geoLng ?? geo.lng;
      }

      // Dispatch job upsert
      const dispatch = getSupabaseDispatch() || main;
      
      if (!dispatch) {
        console.error('[Schedule] No dispatch database available');
        return NextResponse.json(
          { ok: false, error: 'Dispatch database not configured' },
          { status: 503, headers: corsHeaders() }
        );
      }
      
      let jobId: string | null = null;
      let jobCreationWarning: string | null = null;
      let jobCreationDebug: any | null = null;
      let jobLookupKeys = Array.from(
        new Set([
          canonicalOrderId,
          String(order.order_id || ''),
          String(order.session_id || ''),
          orderKey,
        ].filter(Boolean))
      );

      let existingJob: any = null;
      let foundViaKey: string | null = null;
      for (const k of jobLookupKeys) {
        try {
          const { data } = await dispatch.from('h2s_dispatch_jobs').select('*').eq('order_id', k).single();
          if (data) {
            existingJob = data;
            foundViaKey = k;
            console.log('[Schedule] Found existing job via key:', k, 'job_id:', data.job_id);
            break;
          }
        } catch {
          // ignore - no job found with this key
        }

        // Some schemas don't have order_id; try common alternatives.
        try {
          const { data } = await dispatch.from('h2s_dispatch_jobs').select('*').eq('order_ref', k).single();
          if (data) {
            existingJob = data;
            foundViaKey = `order_ref:${k}`;
            console.log('[Schedule] Found existing job via order_ref:', k, 'job_id:', data.job_id);
            break;
          }
        } catch {
          // ignore
        }

        try {
          const { data } = await dispatch.from('h2s_dispatch_jobs').select('*').eq('order_number', k).single();
          if (data) {
            existingJob = data;
            foundViaKey = `order_number:${k}`;
            console.log('[Schedule] Found existing job via order_number:', k, 'job_id:', data.job_id);
            break;
          }
        } catch {
          // ignore
        }

        // Fallback: some deployments do not have order_id as a first-class column.
        // Try matching against JSON metadata instead.
        try {
          const { data } = await dispatch
            .from('h2s_dispatch_jobs')
            .select('*')
            .eq('metadata->>order_id_text', k)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          if (data) {
            existingJob = data;
            foundViaKey = `metadata.order_id_text:${k}`;
            console.log('[Schedule] Found existing job via metadata order_id_text:', k, 'job_id:', data.job_id);
            break;
          }
        } catch {
          // ignore
        }

        try {
          const { data } = await dispatch
            .from('h2s_dispatch_jobs')
            .select('*')
            .eq('metadata->>session_id', k)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          if (data) {
            existingJob = data;
            foundViaKey = `metadata.session_id:${k}`;
            console.log('[Schedule] Found existing job via metadata session_id:', k, 'job_id:', data.job_id);
            break;
          }
        } catch {
          // ignore
        }
      }
      
      if (!existingJob) {
        console.log('[Schedule] No existing job found, will create new one');
      }

      const serviceId = String(order.service_id || order.service_name || metaObj?.service_id || metaObj?.service_name || '').trim() || null;
      const customerName = String(order.customer_name || order.name || metaObj?.customer_name || '').trim();
      const customerEmail = String(order.customer_email || metaObj?.customer_email || '').trim();
      const customerPhone = String(order.customer_phone || metaObj?.customer_phone || '').trim();

      const desiredStartIso = start_iso || computeStartIsoFromWindow(delivery_date, delivery_time);
      const desiredEndIso = end_iso || null;

      // ===== Calculate payout using standardized algorithm =====
      const estimatedPayout = estimatePayout(order);

      // Parse items from order data
      let itemsJson: any[] = [];
      try {
        const rawItems = order.items || order.items_json || order.line_items || metaObj?.items || metaObj?.items_json;
        if (typeof rawItems === 'string') {
          itemsJson = JSON.parse(rawItems);
        } else if (Array.isArray(rawItems)) {
          itemsJson = rawItems;
        }
      } catch {
        // Fallback: create single item from order data
        const orderTotal = Number(order.order_total || order.total || 0);
        itemsJson = [{
          service_name: serviceId || 'Service',
          qty: 1,
          unit_price: orderTotal,
          line_total: orderTotal
        }];
      }

      // Build enriched metadata for portal consumption
      const enrichedMetadata = {
        ...(metaObj || {}),
        order_id_text: order.order_id || null,
        session_id: order.session_id || null,
        scheduled_via: 'api/schedule-appointment',
        service_name: serviceId || 'Service',  // Ensure service_name is in metadata
        // Store calculated payout and financials
        estimated_payout: estimatedPayout,
        order_total: Number(order.order_total || order.total || 0),
        order_subtotal: Number(order.order_subtotal || order.subtotal || order.order_total || order.total || 0),
        items_json: itemsJson,
        // Customer details
        customer_name: customerName || metaObj?.customer_name,
        customer_email: customerEmail || metaObj?.customer_email,
        customer_phone: customerPhone || metaObj?.customer_phone,
        // Service location
        service_address: address || metaObj?.service_address,
        service_city: city || metaObj?.service_city,
        service_state: state || metaObj?.service_state,
        service_zip: zip || metaObj?.service_zip,
      };

      if (existingJob?.job_id) {
        jobId = String(existingJob.job_id);

        const updateJob: any = {
          status: 'scheduled',
          updated_at: new Date().toISOString(),
          metadata: enrichedMetadata, // Update metadata with payout
        };
        if (desiredStartIso) updateJob.start_iso = desiredStartIso;
        if (desiredEndIso) updateJob.end_iso = desiredEndIso;
        if (geoLat !== null && geoLng !== null) {
          updateJob.geo_lat = geoLat;
          updateJob.geo_lng = geoLng;
        }
        if (address) updateJob.service_address = address;
        if (city) updateJob.service_city = city;
        if (state) updateJob.service_state = state;
        if (zip) updateJob.service_zip = zip;
        if (customerName) updateJob.customer_name = customerName;
        if (customerPhone) updateJob.customer_phone = customerPhone;
        if (serviceId) updateJob.service_id = serviceId;
        if (existingJob.order_id !== canonicalOrderId) {
          updateJob.order_id = canonicalOrderId;
        }

        const updRes = await safeUpdateDispatchJob(dispatch, jobId, updateJob);
        if (updRes.error) {
          console.warn('[Schedule] Job update returned error (non-fatal):', updRes.error?.message || updRes.error);
        } else {
          console.log('[Schedule] Updated existing job:', jobId);
        }
      } else {
        // Build job object - start with required fields only
        const insertJob: any = {
          status: 'scheduled',
          created_at: new Date().toISOString(),
        };

        // Some dispatch schemas require recipient_id (NOT NULL). If so, reuse an existing recipient_id.
        const attemptedRecipientId = await pickDispatchRecipientId(dispatch);
        if (attemptedRecipientId) {
          insertJob.recipient_id = attemptedRecipientId;
        }

        // Some dispatch schemas require a non-null recipient_id.
        // Best-effort: choose a fallback pro/recipient from dispatch pros.
        const fallbackRecipientId = await pickFallbackRecipientId(dispatch, geoLat, geoLng);
        if (fallbackRecipientId && !insertJob.recipient_id) {
          insertJob.recipient_id = fallbackRecipientId;
        }
        
        // Build comprehensive metadata including geo coordinates
        const jobMetadata: any = enrichedMetadata || {};
        
        // Always save geo in metadata (guaranteed to work)
        if (geoLat !== null && geoLng !== null) {
          jobMetadata.geo_lat = geoLat;
          jobMetadata.geo_lng = geoLng;
          jobMetadata.geocoded = true;
        }
        
        // Save all address and contact info in metadata
        if (address) jobMetadata.service_address = address;
        if (city) jobMetadata.service_city = city;
        if (state) jobMetadata.service_state = state;
        if (zip) jobMetadata.service_zip = zip;
        if (customerEmail) jobMetadata.customer_email = customerEmail;
        if (customerName) jobMetadata.customer_name = customerName;
        if (customerPhone) jobMetadata.customer_phone = customerPhone;
        if (serviceId) jobMetadata.service_id = serviceId;
        
        // Save metadata in multiple common column names; safeInsert will strip unknown columns.
        insertJob.metadata = jobMetadata;
        insertJob.metadata_json = jobMetadata;
        insertJob.meta = jobMetadata;

        // Attempt to persist a first-class order reference if the schema supports it.
        insertJob.order_id = canonicalOrderId;
        insertJob.order_number = canonicalOrderId;
        insertJob.order_ref = canonicalOrderId;
        
        // Add common first-class columns in INSERT (best-effort).
        if (customerName) insertJob.customer_name = customerName;
        if (customerPhone) insertJob.customer_phone = customerPhone;
        if (address) insertJob.address = address;
        if (city) insertJob.city = city;
        if (state) insertJob.state = state;
        if (zip) insertJob.zip = zip;
        if (address) insertJob.service_address = address;
        if (city) insertJob.service_city = city;
        if (state) insertJob.service_state = state;
        if (zip) insertJob.service_zip = zip;
        if (serviceId) insertJob.service_id = serviceId;
        if (order?.service_name) insertJob.service_name = String(order.service_name);
        if (desiredStartIso) insertJob.start_iso = desiredStartIso;
        if (desiredEndIso) insertJob.end_iso = desiredEndIso;
        if (geoLat !== null) insertJob.geo_lat = geoLat;
        if (geoLng !== null) insertJob.geo_lng = geoLng;
        
        console.log('[Schedule] Creating job for order:', canonicalOrderId);
        console.log('[Schedule] Customer:', customerName, customerPhone, customerEmail);
        console.log('[Schedule] Address:', address, `${city}, ${state} ${zip}`);
        console.log('[Schedule] Geo:', geoLat, geoLng);
        console.log('[Schedule] insertJob payload:', JSON.stringify(insertJob, null, 2));
        
        // Insert with retries for schema mismatches (unknown columns)
        const { data: newJob, error: jobErr, payload: finalInsertPayload, removed: removedColumns } = await safeInsertDispatchJob(dispatch, insertJob);
        
        if (jobErr) {
          console.error('[Schedule] Job insert failed:', jobErr.message, jobErr.code);

          // IMPORTANT: The customer already successfully scheduled the order in h2s_orders.
          // If dispatch job creation fails due to schema constraints, do NOT block scheduling.
          // Continue through notifications and return ok:true with a warning.
          jobCreationWarning = `Dispatch job creation failed: ${jobErr.message}`;
          jobCreationDebug = {
            inserted_payload_keys: Object.keys(finalInsertPayload || {}),
            stripped_columns: removedColumns,
            attempted_recipient_id: attemptedRecipientId || fallbackRecipientId || null,
            error_code: jobErr.code || null,
          };
        } else {
          jobId = String(newJob.job_id);
          console.log('[Schedule] ✅ Job created:', jobId);
          
          // Best-effort: update additional fields (tolerate schema mismatch).
          const updatePayload: any = {
            updated_at: new Date().toISOString(),
            metadata: jobMetadata,
            metadata_json: jobMetadata,
            meta: jobMetadata,
          };
          if (serviceId) updatePayload.service_id = serviceId;
          if (order?.service_name) updatePayload.service_name = String(order.service_name);
          if (customerName) updatePayload.customer_name = customerName;
          if (customerPhone) updatePayload.customer_phone = customerPhone;
          if (address) updatePayload.address = address;
          if (city) updatePayload.city = city;
          if (state) updatePayload.state = state;
          if (zip) updatePayload.zip = zip;
          if (address) updatePayload.service_address = address;
          if (city) updatePayload.service_city = city;
          if (state) updatePayload.service_state = state;
          if (zip) updatePayload.service_zip = zip;
          if (desiredStartIso) updatePayload.start_iso = desiredStartIso;
          if (desiredEndIso) updatePayload.end_iso = desiredEndIso;
          if (geoLat !== null) updatePayload.geo_lat = geoLat;
          if (geoLng !== null) updatePayload.geo_lng = geoLng;

          const updRes = await safeUpdateDispatchJob(dispatch, jobId, updatePayload);
          if (updRes.error) {
            console.warn('[Schedule] Non-critical: Additional fields update returned error:', updRes.error?.message || updRes.error);
          }
        }
      }

      // Notify management (non-blocking): successful scheduling
      // Always attempt, even if dispatch job creation failed (jobId may be null).
      {
        try {
          const baseUrl = process.env.VERCEL_URL 
            ? `https://${process.env.VERCEL_URL}` 
            : 'https://h2s-backend.vercel.app';

          const amountTotal = Number(order.order_total || order.total || 0);
          const serviceLabel = `${String(order.service_name || serviceId || 'Service')} (${delivery_date} ${delivery_time})${jobId ? '' : ' (dispatch pending)'}`;
          await fetch(`${baseUrl}/api/notify-management`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              dry_run: dryRun,
              type: 'newBooking',
              idempotency_key: `schedule_appointment|${canonicalOrderId}|${delivery_date}|${delivery_time}`,
              data: {
                service: serviceLabel,
                customerName: customerName || 'Customer',
                orderNumber: canonicalOrderId || String(order.order_id || '').slice(-8).toUpperCase(),
                amount: (Number.isFinite(amountTotal) ? amountTotal : 0).toFixed(2),
                city: city || 'Unknown',
                state: state || 'SC',
                phone: customerPhone || 'N/A',
              }
            })
          });
        } catch (err: any) {
          console.warn('[Schedule] Management notify failed (non-critical):', err?.message || err);
        }
      }

      // Attempt auto-assign via DB function if available
      if (jobId) {
        try {
          const { data: assignedPro } = await dispatch.rpc('auto_assign_job_to_pro', {
            p_job_id: jobId,
            p_service_id: serviceId || order.service_name || null,
            p_date: delivery_date,
            p_time_slot: delivery_time,
            p_customer_lat: (geoLat ?? 34.8526) as any,
            p_customer_lng: (geoLng ?? -82.394) as any,
          });

          // IMPORTANT: The portal UI expects a pending offer row in the assignments table.
          // The RPC may update the job row but return null/empty; in that case we infer
          // assigned_to (or email/id equivalents) from the job row and still create the assignment.
          const offerResult = await ensureDispatchOfferAssignmentForJob(dispatch, {
            jobId,
            proValue: assignedPro ? String(assignedPro) : null,
            state: 'offer_sent',
            status: 'offer_sent',
          });

          // expose minimal debug in response
          (order as any).__offer_debug = offerResult;
        } catch {
          // ignore
        }
      }

      // ============================================================
      // SEND BOOKING CONFIRMATION NOTIFICATIONS
      // ============================================================
      if (!dryRun && (customerPhone || customerEmail)) {
        const baseUrl = process.env.VERCEL_URL 
          ? `https://${process.env.VERCEL_URL}` 
          : 'https://h2s-backend.vercel.app';
        
        const firstName = String(customerName || 'there').split(' ')[0];
        const dateFormatted = formatDate(delivery_date);
        const timeFormatted = delivery_time;
        const serviceName = String(order.service_name || serviceId || 'your service');

        // Send SMS if phone exists - Use Twilio directly for customer notifications
        if (customerPhone && twilioClient && process.env.TWILIO_PHONE_NUMBER) {
          try {
            const smsBody = `Hi ${firstName}! Your ${serviceName} appointment is confirmed for ${dateFormatted} at ${timeFormatted}. We'll send you a reminder before we arrive. Questions? Call (864) 528-1475. - Home2Smart`;
            await twilioClient.messages.create({
              body: smsBody,
              from: process.env.TWILIO_PHONE_NUMBER,
              to: customerPhone
            });
            console.log('[Schedule] Booking SMS sent to customer');
          } catch (err: any) {
            console.warn('[Schedule] SMS send failed (non-critical):', err.message);
          }
        }

        // Email notification would go here if we had email templates set up
        // For now, relying on SMS as primary channel
      }

      return NextResponse.json(
        {
          ok: true,
          _v: 'DEPLOY_20260105_0001',  // Version marker to verify deployment
          message: 'Appointment scheduled successfully',
          order_id: orderKey,
          canonical_order_id: canonicalOrderId,
          delivery_date,
          delivery_time,
          dry_run: dryRun,
          job_id: jobId,
          job_creation_warning: jobCreationWarning || (jobId ? null : 'Dispatch job was not created - check server logs'),
          debug: {
            found_existing_job: !!foundViaKey,
            found_via_key: foundViaKey,
            job_lookup_keys_tried: jobLookupKeys,
            dispatch_job_debug: jobCreationDebug,
          },
          human_date: formatDate(delivery_date),
          offer_debug: (order as any).__offer_debug || null,
        },
        { headers: corsHeaders() }
      );
    }

    // ===== Simple appointment-booking mode (legacy/other usage) =====
    const { name, email, phone, service, date, time, notes } = body;

    if (!name || !email || !phone) {
      return NextResponse.json({ success: false, error: 'Name, email, and phone are required' }, { status: 400, headers: corsHeaders() });
    }

    const client = getSupabase();
    if (!client) {
      return NextResponse.json({ success: false, error: 'Database not available' }, { status: 503, headers: corsHeaders() });
    }

    const orderId = `APPT${Date.now()}${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const { data, error } = await client
      .from('h2s_orders')
      .insert({
        order_id: orderId,
        customer_email: String(email).trim().toLowerCase(),
        customer_name: name,
        customer_phone: phone,
        status: 'queued',
        due_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        subtotal: 0,
        total: 0,
        items: [
          {
            type: 'appointment',
            service: service || 'Consultation',
            date: date,
            time: time,
            notes: notes || '',
          },
        ],
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      console.error('[Schedule Appointment] Database error:', error);
      return NextResponse.json({ success: false, error: 'Failed to schedule appointment', details: error.message }, { status: 500, headers: corsHeaders() });
    }

    return NextResponse.json({ success: true, appointment: data }, { headers: corsHeaders() });

  } catch (error: any) {
    console.error('[Schedule Appointment] Error:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to process appointment request',
      details: error.message
    }, { status: 500, headers: corsHeaders() });
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const email = searchParams.get('email');

  try {
    const client = getSupabase();
    
    if (!client) {
      return NextResponse.json({
        success: false,
        appointments: []
      }, { status: 503, headers: corsHeaders() });
    }

    let query = client.from('h2s_orders')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (email) {
      query = query.eq('customer_email', email);
    }

    const { data, error } = await query;

    if (error) {
      console.error('[Get Appointments] Error:', error);
      return NextResponse.json({
        success: false,
        appointments: [],
        error: error.message
      }, { status: 500, headers: corsHeaders() });
    }

    return NextResponse.json({
      success: true,
      appointments: data || []
    }, { headers: corsHeaders() });

  } catch (error: any) {
    console.error('[Get Appointments] Error:', error);
    return NextResponse.json({
      success: false,
      appointments: [],
      error: error.message
    }, { status: 500, headers: corsHeaders() });
  }
}

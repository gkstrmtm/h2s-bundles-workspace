import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { getSupabaseDispatch } from '@/lib/supabase';
import { ensureDispatchOfferAssignmentForJob } from '@/lib/dispatchOfferAssignment';

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
        if (customerEmail) updateJob.customer_email = customerEmail;
        if (customerPhone) updateJob.customer_phone = customerPhone;
        if (serviceId) updateJob.service_id = serviceId;
        if (existingJob.order_id !== canonicalOrderId) {
          updateJob.order_id = canonicalOrderId;
        }

        try {
          await dispatch.from('h2s_dispatch_jobs').update(updateJob).eq('job_id', jobId);
          console.log('[Schedule] Updated existing job:', jobId);
        } catch (updateErr) {
          console.error('[Schedule] Job update failed:', updateErr);
          // Continue - job exists even if update fails
        }
      } else {
        // Build job object - start with required fields only
        const insertJob: any = {
          status: 'scheduled',
          order_id: canonicalOrderId,
          created_at: new Date().toISOString()
        };
        
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
        
        insertJob.metadata = jobMetadata;
        
        // CRITICAL: Add customer details to first-class columns in INSERT (portal reads these, not metadata)
        if (customerName) insertJob.customer_name = customerName;
        if (customerPhone) insertJob.customer_phone = customerPhone;
        if (customerEmail) insertJob.customer_email = customerEmail;
        if (address) insertJob.service_address = address;
        if (city) insertJob.service_city = city;
        if (state) insertJob.service_state = state;
        if (zip) insertJob.service_zip = zip;
        if (serviceId) insertJob.service_id = serviceId;
        if (desiredStartIso) insertJob.start_iso = desiredStartIso;
        if (desiredEndIso) insertJob.end_iso = desiredEndIso;
        if (geoLat !== null) insertJob.geo_lat = geoLat;
        if (geoLng !== null) insertJob.geo_lng = geoLng;
        
        console.log('[Schedule] Creating job for order:', canonicalOrderId);
        console.log('[Schedule] Customer:', customerName, customerPhone, customerEmail);
        console.log('[Schedule] Address:', address, `${city}, ${state} ${zip}`);
        console.log('[Schedule] Geo:', geoLat, geoLng);
        console.log('[Schedule] insertJob payload:', JSON.stringify(insertJob, null, 2));
        
        // Insert with ALL fields
        const { data: newJob, error: jobErr } = await dispatch
          .from('h2s_dispatch_jobs')
          .insert(insertJob)
          .select('job_id')
          .single();
        
        if (jobErr) {
          console.error('[Schedule] Job insert failed:', jobErr.message, jobErr.code);
          return NextResponse.json({
            ok: false,
            error: `Job creation failed: ${jobErr.message}`,
            error_code: jobErr.code,
            order_was_scheduled: true,
            order_id: orderKey
          }, { status: 500, headers: corsHeaders() });
        }
        
        jobId = String(newJob.job_id);
        console.log('[Schedule] ✅ Job created:', jobId);
        
        // Update is now only for failsafe (most fields already in initial insert)
        try {
          const updatePayload: any = {};
          if (serviceId && !insertJob.service_id) updatePayload.service_id = serviceId;
          if (customerEmail && !insertJob.customer_email) updatePayload.customer_email = customerEmail;
          if (customerName && !insertJob.customer_name) updatePayload.customer_name = customerName;
          if (customerPhone && !insertJob.customer_phone) updatePayload.customer_phone = customerPhone;
          if (address && !insertJob.service_address) updatePayload.service_address = address;
          if (city && !insertJob.service_city) updatePayload.service_city = city;
          if (state && !insertJob.service_state) updatePayload.service_state = state;
          if (zip && !insertJob.service_zip) updatePayload.service_zip = zip;
          if (desiredStartIso && !insertJob.start_iso) updatePayload.start_iso = desiredStartIso;
          if (geoLat !== null && !insertJob.geo_lat) updatePayload.geo_lat = geoLat;
          if (geoLng !== null && !insertJob.geo_lng) updatePayload.geo_lng = geoLng;
          
          if (Object.keys(updatePayload).length > 0) {
            await dispatch.from('h2s_dispatch_jobs').update(updatePayload).eq('job_id', jobId);
            console.log('[Schedule] ✅ Additional fields updated');
          }
        } catch (updateErr) {
          console.warn('[Schedule] Non-critical: Additional fields update failed:', updateErr);
          // Continue - job exists with geo in metadata
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
      if (customerPhone || customerEmail) {
        const baseUrl = process.env.VERCEL_URL 
          ? `https://${process.env.VERCEL_URL}` 
          : 'https://h2s-backend.vercel.app';
        
        const firstName = String(customerName || 'there').split(' ')[0];
        const dateFormatted = formatDate(delivery_date);
        const timeFormatted = delivery_time;

        // Send SMS if phone exists
        if (customerPhone) {
          try {
            await fetch(`${baseUrl}/api/send-sms`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                to: customerPhone,
                template_key: 'booking_confirmation',
                job_id: jobId,
                data: {
                  firstName,
                  service_name: String(order.service_name || serviceId || 'Service'),
                  date: dateFormatted,
                  time: timeFormatted,
                  address: String(address || ''),
                  job_id: jobId || ''
                }
              })
            });
            console.log('[Schedule] ✅ Booking SMS sent to customer');
          } catch (err: any) {
            console.warn('[Schedule] SMS send failed (non-critical):', err.message);
          }
        }

        // Send Email if email exists
        if (customerEmail) {
          try {
            await fetch(`${baseUrl}/api/send-email`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                to_email: customerEmail,
                template_key: 'booking_confirmation',
                order_id: canonicalOrderId,
                data: {
                  firstName,
                  service_name: String(order.service_name || serviceId || 'Service'),
                  date: dateFormatted,
                  time: timeFormatted,
                  address: String(address || ''),
                  city: String(city || ''),
                  state: String(state || ''),
                  zip: String(zip || ''),
                  job_id: jobId || ''
                }
              })
            });
            console.log('[Schedule] ✅ Booking email sent to customer');
          } catch (err: any) {
            console.warn('[Schedule] Email send failed (non-critical):', err.message);
          }
        }
      }

      return NextResponse.json(
        {
          ok: true,
          _v: 'DEPLOY_20251230_1915',  // Version marker to verify deployment
          message: 'Appointment scheduled successfully',
          order_id: orderKey,
          canonical_order_id: canonicalOrderId,
          delivery_date,
          delivery_time,
          job_id: jobId,
          job_creation_warning: jobId ? null : 'Job was not created - check server logs',
          debug: {
            found_existing_job: !!foundViaKey,
            found_via_key: foundViaKey,
            job_lookup_keys_tried: jobLookupKeys
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
        status: 'pending',
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

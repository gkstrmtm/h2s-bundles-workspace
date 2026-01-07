import { NextResponse } from 'next/server';
import { getSupabaseDispatch } from '@/lib/supabase';
import { verifyPortalToken } from '@/lib/portalTokens';
import { resolveDispatchSchema } from '@/lib/dispatchSchema';
import { bestEffortUpdateProRow } from '@/lib/portalProProfile';
import { enrichServiceName, extractCameraDetails } from '@/lib/dataOrchestration';

function corsHeaders(request?: Request): Record<string, string> {
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

console.log('[portal_jobs] Module loaded - env vars:', {
  hasSupabaseUrl: !!process.env.SUPABASE_URL,
  hasServiceKey: !!process.env.SUPABASE_SERVICE_KEY,
  hasPortalSecret: !!process.env.PORTAL_TOKEN_SECRET
});

const JOB_TABLE_CANDIDATES = ['h2s_dispatch_jobs'];
const ASSIGN_TABLE_CANDIDATES = ['h2s_dispatch_job_assignments'];

function toNum(v: any): number | null {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : null;
}

function toRad(deg: number) {
  return (deg * Math.PI) / 180;
}

function haversineMiles(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 3959;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

const ZIP_GEO_CACHE: Map<string, { lat: number; lng: number; at: number }> = new Map();

function first5(z: any) {
  const m = String(z ?? '').trim().match(/\d{5}/);
  return m ? m[0] : null;
}

async function geocodeZip(zip: string): Promise<{ lat: number; lng: number } | null> {
  const zip5 = first5(zip);
  if (!zip5) return null;

  // Very small in-memory cache to avoid repeated lookups in a warm lambda.
  const cached = ZIP_GEO_CACHE.get(zip5);
  if (cached && Date.now() - cached.at < 30 * 24 * 60 * 60 * 1000) {
    return { lat: cached.lat, lng: cached.lng };
  }

  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return null;

  try {
    // Geocode just the ZIP (centroid).
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(zip5)}&key=${encodeURIComponent(key)}`;
    const resp = await fetch(url);
    const json: any = await resp.json().catch(() => null);
    const loc = json?.results?.[0]?.geometry?.location;
    const lat = typeof loc?.lat === 'number' ? loc.lat : null;
    const lng = typeof loc?.lng === 'number' ? loc.lng : null;
    if (lat == null || lng == null) return null;
    ZIP_GEO_CACHE.set(zip5, { lat, lng, at: Date.now() });
    return { lat, lng };
  } catch {
    return null;
  }
}

async function fetchProProfile(client: any, proId: string) {
  const tables = ['H2S_Pros', 'h2s_dispatch_pros', 'h2s_pros', 'h2s_pro_profiles', 'h2s_techs', 'h2s_technicians'];
  const idCols = ['pro_id', 'Pro_ID', 'id', 'tech_id', 'Tech_ID'];
  for (const table of tables) {
    for (const idCol of idCols) {
      try {
        const { data, error } = await client.from(table).select('*').eq(idCol as any, proId).limit(1);
        if (!error && data?.[0]) return { table, row: data[0] };
      } catch {
        // ignore
      }
    }
  }
  return null;
}

function extractProGeo(profile: any) {
  const row = profile?.row;
  const lat = toNum(row?.geo_lat ?? row?.lat ?? row?.latitude);
  const lng = toNum(row?.geo_lng ?? row?.lng ?? row?.longitude);
  const zip =
    String(
      row?.zip ??
        row?.Zip ??
        row?.zipcode ??
        row?.home_zip ??
        row?.zip_code ??
        row?.postal_code ??
        row?.service_zip ??
        ''
    ).trim() || null;
  const radius = toNum(row?.service_radius_miles ?? row?.radius_miles ?? row?.service_radius) ?? 50;
  return { lat, lng, zip, radius: Math.max(1, Math.min(radius, 250)) };
}

async function fetchAvailableOffers(
  client: any,
  opts: { lat: number | null; lng: number | null; zip?: string | null; radius: number; limit: number },
  schema?: { jobsTable?: string; jobsStatusCol?: string }
) {
  const limit = Math.min(Math.max(opts.limit || 200, 1), 500);
  const jobsTable = schema?.jobsTable || 'h2s_dispatch_jobs';
  const statusCol = schema?.jobsStatusCol || 'status';

  // NOTE: Some deployments incorrectly store “scheduled” rows without any assignment.
  // In that case we still want them to appear as offers (if unassigned).
  const OFFER_STATUSES = ['pending_assign', 'pending', 'open', 'unassigned', 'available', 'offered', 'new', 'scheduled', 'queued'];
  const LAT_COLS = ['geo_lat', 'job_geo_lat', 'service_lat', 'lat', 'latitude'];
  const LNG_COLS = ['geo_lng', 'geo_long', 'job_geo_lng', 'service_lng', 'lng', 'longitude', 'long'];
  const ZIP_COLS = ['service_zip', 'zip', 'zip_code', 'postal_code'];

  const isProbablyAssigned = (job: any): boolean => {
    if (!job || typeof job !== 'object') return false;
    const candidates = [
      job.assigned_to,
      job.assigned_pro_id,
      job.pro_id,
      job.tech_id,
      job.technician_id,
      job.assigned_email,
      job.assigned_pro_email,
      job.pro_email,
      job.tech_email,
      job.email,
    ];
    return candidates.some((v) => String(v ?? '').trim());
  };

  // Best-effort: infer geo columns from an existing row.
  let latCol = 'geo_lat';
  let lngCol = 'geo_lng';
  let zipCol = 'service_zip';
  try {
    const probe = await client.from(jobsTable).select('*').limit(1);
    const row = Array.isArray(probe?.data) ? probe.data[0] : null;
    if (row && typeof row === 'object') {
      const keys = new Set(Object.keys(row));
      latCol = LAT_COLS.find((c) => keys.has(c)) || latCol;
      lngCol = LNG_COLS.find((c) => keys.has(c)) || lngCol;
      zipCol = ZIP_COLS.find((c) => keys.has(c)) || zipCol;
    }
  } catch {
    // ignore
  }

  let jobs: any[] = [];
  try {
    let q: any = client.from(jobsTable).select('*').limit(limit).order('created_at', { ascending: false });
    if (statusCol) q = q.in(statusCol, OFFER_STATUSES);

    const { data, error } = await q;
    if (error) throw error;
    jobs = Array.isArray(data) ? data : [];
  } catch {
    // Fallback: fetch recent jobs and filter in memory.
    const { data } = await client.from(jobsTable).select('*').limit(limit).order('created_at', { ascending: false });
    const all = Array.isArray(data) ? data : [];
    jobs = all.filter((j: any) => OFFER_STATUSES.includes(String(j?.status || j?.job_status || j?.state || '').toLowerCase()));
  }

  // ✅ ENRICHMENT: Backfill missing job details from Orders (Reverse Linkage)
  try {
     const jobIds = jobs.map((j: any) => j.job_id).filter((id: any) => id);
     if (jobIds.length > 0) {
        const { data: orders } = await client
          .from('h2s_orders')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(100);
          
        if (orders && orders.length > 0) {
          const orderByJobId = new Map();
          orders.forEach((o: any) => {
             const meta = o.metadata_json || o.metadata || {};
             const jid = meta.dispatch_job_id || meta.job_id;
             if (jid) orderByJobId.set(jid, o);
          });
          
          jobs = jobs.map((j: any) => {
             const order = orderByJobId.get(j.job_id);
             if (!order) return j;
             
             const meta = order.metadata_json || order.metadata || {};
             
             let items = j.line_items || order.items || meta.items_json || [];
             if (typeof items === 'string') {
               try { items = JSON.parse(items); } catch {}
             }
             
             const merged = {
               ...j,
               service_name: j.service_name || order.service_name || meta.service_name || "Service",
               service_address: j.service_address || order.address || meta.service_address || '',
               service_city: j.service_city || order.city || meta.service_city || '',
               service_state: j.service_state || order.state || meta.service_state || '',
               service_zip: j.service_zip || order.zip || meta.service_zip || '',
               
               geo_lat: toNum(j.geo_lat) ?? toNum(meta.geo_lat),
               geo_lng: toNum(j.geo_lng) ?? toNum(meta.geo_lng),
               
               payout_estimated: toNum(j.payout_estimated) ?? toNum(meta.estimated_payout) ?? 0,
               line_items: items,
               
               description: j.description || order.special_instructions || meta.description || '',
               customer_name: j.customer_name || order.customer_name || meta.customer_name || '',
             };
             // Normalise zip for filtering
             if (!merged.service_zip && merged.zip) merged.service_zip = merged.zip;
             return merged;
          });
        }
     }
  } catch (err) {
    console.warn('[Portal Jobs] Enrichment failed:', err);
  }

  const proZip5 = first5(opts.zip);

  if (opts.lat == null || opts.lng == null) {
    // If we don't have a pro geo point, do NOT return all jobs.
    // Prefer ZIP matching (legacy behavior would otherwise return an empty set).
    if (!proZip5) return [];

    return jobs
      .map((j: any) => {
        const jobZip5 = first5(j?.[zipCol] ?? j?.service_zip ?? j?.zip ?? j?.zip_code ?? j?.postal_code);
        const st = String(j?.[statusCol] ?? j?.status ?? j?.job_status ?? j?.state ?? '').toLowerCase().trim();
        // Extract line_items from metadata if available
        const lineItems = j?.line_items || j?.metadata?.items_json || null;
        // CRITICAL: Read payout from column first, then metadata (column is authoritative)
        const estimatedPayout = Number(j?.payout_estimated || j?.metadata?.estimated_payout || 0);
        // CRITICAL: Enrich service name from items if generic
        const enrichedServiceName = enrichServiceName(j);
        // ✅ NEW: Extract camera installation details
        const cameraDetails = extractCameraDetails(j);
        return {
          ...j,
          service_name: enrichedServiceName, // Override generic names
          line_items: lineItems, // Ensure line_items is available for frontend
          camera_details: cameraDetails, // Add structured camera data
          distance_miles: null,
          payout_estimated: estimatedPayout,
          _job_zip5: jobZip5,
          _job_status_norm: st,
        };
      })
      .filter((j: any) => {
        if (j._job_status_norm === 'scheduled') return !isProbablyAssigned(j);
        return true;
      })
      .filter((j: any) => j._job_zip5 && j._job_zip5 === proZip5)
      .map((j: any) => {
        const { _job_zip5, _job_status_norm, ...rest } = j;
        return rest;
      });
  }

  return jobs
    .map((j: any) => {
      // Try to get geo from columns first, then fallback to metadata
      let jLat = toNum(j?.[latCol]);
      let jLng = toNum(j?.[lngCol]);
      
      // Fallback: check metadata for geo coordinates
      if ((jLat === null || jLng === null) && j?.metadata) {
        jLat = jLat ?? toNum(j.metadata.geo_lat);
        jLng = jLng ?? toNum(j.metadata.geo_lng);
      }
      
      const dist = jLat != null && jLng != null ? haversineMiles(opts.lat!, opts.lng!, jLat, jLng) : null;
      const jobZip5 = first5(j?.[zipCol] ?? j?.service_zip ?? j?.zip ?? j?.zip_code ?? j?.postal_code ?? j?.metadata?.service_zip);
      const st = String(j?.[statusCol] ?? j?.status ?? j?.job_status ?? j?.state ?? '').toLowerCase().trim();
      // Extract line_items from metadata if available
      const lineItems = j?.line_items || j?.metadata?.items_json || null;
      // CRITICAL: Read payout from column first, then metadata (column is authoritative)
      const estimatedPayout = Number(j?.payout_estimated || j?.metadata?.estimated_payout || 0);
      // CRITICAL: Enrich service name from items if generic
      const enrichedServiceName = enrichServiceName(j);
      // ✅ NEW: Extract camera installation details
      const cameraDetails = extractCameraDetails(j);
      return {
        ...j,
        service_name: enrichedServiceName, // Override generic names
        line_items: lineItems, // Ensure line_items is available for frontend
        camera_details: cameraDetails, // Add structured camera data
        distance_miles: dist != null ? Math.round(dist * 10) / 10 : null,
        payout_estimated: estimatedPayout,
        referral_code: j?.metadata?.referral_code ?? null,
        _job_zip5: jobZip5,
        _job_status_norm: st,
      };
    })
    .filter((j: any) => {
      if (j._job_status_norm === 'scheduled') {
        return !isProbablyAssigned(j);
      }
      return true;
    })
    .filter((j: any) => {
      // Prefer geo radius when we can compute it.
      if (j.distance_miles != null) return j.distance_miles <= opts.radius;

      // If we can't compute geo distance, fall back to matching pro/job ZIP when available.
      if (proZip5 && j._job_zip5) return proZip5 === j._job_zip5;

      // Otherwise, exclude (we can't safely geo-filter this row).
      return false;
    })
    .map((j: any) => {
      // Strip internal helper fields
      const { _job_zip5, _job_status_norm, ...rest } = j;
      return rest;
    });
}

function groupByState(rows: any[]) {
  const offers: any[] = [];
  const upcoming: any[] = [];
  const completed: any[] = [];

  const isOneOf = (value: string, set: string[]) => set.includes(value);
  const COMPLETED = ['completed', 'complete', 'done', 'paid', 'closed', 'cancelled', 'canceled'];
  const UPCOMING = ['accepted', 'assigned', 'scheduled', 'in_progress', 'in-progress', 'enroute', 'en_route', 'started'];
  const OFFER = ['pending_assign', 'pending', 'open', 'offered', 'available', 'unassigned', 'new'];

  for (const r of rows) {
    const state = String(r.assign_state || r.assignment_state || r.state || r.status || '').toLowerCase().trim();

    if (!state) {
      offers.push(r);
      continue;
    }

    if (isOneOf(state, COMPLETED) || state.includes('complete')) {
      completed.push(r);
    } else if (isOneOf(state, UPCOMING) || state.includes('accept') || state.includes('scheduled')) {
      upcoming.push(r);
    } else if (isOneOf(state, OFFER) || state === 'queued') {
      offers.push(r);
    } else {
      offers.push(r);
    }
  }

  return { offers, upcoming, completed };
}

async function findAssignments(client: any, opts: { proId: string; email?: string | null }) {
  for (const table of ASSIGN_TABLE_CANDIDATES) {
    try {
      // Try common pro id/email columns.
      const proCols = ['pro_id', 'tech_id', 'assigned_pro_id', 'technician_id', 'pro_email', 'tech_email', 'email', 'assigned_email', 'assigned_to_email'];
      const proValues = Array.from(new Set([opts.proId, opts.email].filter(Boolean).map((v) => String(v))));
      for (const col of proCols) {
        for (const val of proValues) {
          const { data, error } = await client.from(table).select('*').eq(col as any, val).limit(500);
          if (!error && Array.isArray(data) && data.length) return { table, rows: data };
        }
      }
    } catch {
      // ignore
    }
  }
  return null;
}

async function fetchJobsByIds(client: any, jobIds: string[]) {
  for (const table of JOB_TABLE_CANDIDATES) {
    try {
      const { data, error } = await client.from(table).select('*').in('job_id' as any, jobIds).limit(500);
      if (!error && data) return { table, rows: data };
    } catch {
      // ignore
    }
  }
  return null;
}

function mergeJobAssignment(job: any, assignment: any) {
  // Prefer job fields, but ensure assignment state fields are surfaced.
  return {
    ...job,
    ...assignment,
    job_id: job?.job_id ?? assignment?.job_id,
    assign_state: assignment?.assign_state ?? assignment?.state ?? job?.assign_state ?? job?.status,
  };
}

// ✅ Fetch a single job by ID with full details
async function handleSingleJobFetch(sb: any, jobId: string, proId: string, request: Request) {
  console.log('[portal_jobs] Single job fetch:', jobId, 'for pro:', proId);

  // Find the job in the jobs table
  let job: any = null;
  const jobTables = ['h2s_dispatch_jobs', 'dispatch_jobs', 'h2s_jobs', 'jobs'];
  
  for (const table of jobTables) {
    try {
      const { data, error } = await sb.from(table).select('*').eq('job_id', jobId).single();
      if (!error && data) {
        job = { ...data, job_id: data.job_id || data.id };
        console.log('[portal_jobs] Found job in table:', table);
        break;
      }
    } catch {}
  }

  if (!job) {
    return NextResponse.json(
      { ok: false, error: 'Job not found', error_code: 'job_not_found' },
      { status: 404, headers: corsHeaders(request) }
    );
  }

  // Fetch line items for this job
  const lineTables = ['h2s_job_lines', 'job_lines', 'h2s_dispatch_job_lines', 'dispatch_job_lines'];
  let lineItems: any[] = [];
  
  for (const table of lineTables) {
    try {
      const { data } = await sb.from(table).select('*').eq('job_id', jobId);
      if (data && data.length > 0) {
        lineItems = data;
        console.log('[portal_jobs] Found', lineItems.length, 'line items in table:', table);
        break;
      }
    } catch {}
  }

  if (lineItems.length > 0) {
    job.line_items = lineItems;
  }

  // Fetch assignment info for this job + pro
  const assignTables = ['h2s_dispatch_job_assignments', 'dispatch_job_assignments', 'h2s_job_assignments', 'job_assignments'];
  let assignment: any = null;
  
  for (const table of assignTables) {
    try {
      const { data } = await sb.from(table).select('*').eq('job_id', jobId).eq('pro_id', proId).single();
      if (data) {
        assignment = data;
        console.log('[portal_jobs] Found assignment in table:', table);
        break;
      }
    } catch {}
  }

  if (assignment) {
    job.assignment_state = assignment.state || assignment.assign_state || assignment.status;
    job.offer_sent_at = assignment.offer_sent_at || assignment.sent_at;
    job.accepted_at = assignment.accepted_at;
    job.distance_miles = assignment.distance_miles;
  }

  // Enrich service name if needed
  if (job.service_id || job.service_name) {
    const enriched = enrichServiceName(job);
    if (enriched) {
      job.service_name = enriched;
    }
  }

  console.log('[portal_jobs] Returning single job:', jobId, '- has line_items:', !!job.line_items?.length);
  return NextResponse.json(
    { ok: true, job },
    { headers: corsHeaders(request) }
  );
}

async function handle(request: Request, token: string, jobId?: string) {
  if (!token) {
    return NextResponse.json(
      { ok: false, error: 'Missing token', error_code: 'bad_session' },
      { status: 401, headers: corsHeaders(request) }
    );
  }

  let payload;
  try {
    payload = verifyPortalToken(token);
  } catch (err: any) {
    console.error('[portal_jobs] Token verification failed:', err.message);
    return NextResponse.json(
      { ok: false, error: 'Invalid or expired token', error_code: 'bad_session', details: err.message },
      { status: 401, headers: corsHeaders(request) }
    );
  }

  if (payload.role !== 'pro') {
    return NextResponse.json(
      { ok: false, error: 'Not a pro session', error_code: 'bad_session' },
      { status: 401, headers: corsHeaders(request) }
    );
  }

  const dispatchClient = getSupabaseDispatch();
  if (!dispatchClient) {
    return NextResponse.json(
      {
        ok: false,
        error: 'Dispatch database not configured (set SUPABASE_URL_DISPATCH / SUPABASE_SERVICE_KEY_DISPATCH)',
        error_code: 'dispatch_db_not_configured',
      },
      { status: 503, headers: corsHeaders(request) }
    );
  }

  const proId = payload.sub;
  const sb: any = dispatchClient as any;

  // ✅ SINGLE JOB FETCH: If job_id provided, return that specific job only
  if (jobId) {
    return await handleSingleJobFetch(sb, jobId, proId, request);
  }

  const proProfile = await fetchProProfile(sb, proId);
  const proGeo = extractProGeo(proProfile);

  // Make sure we have a usable geo point for distance filtering.
  // If missing, try to infer from the pro's ZIP (ZIP centroid) if we have a Geocoding API key.
  let proGeoSource: 'profile' | 'zip_geocode' | 'none' = proGeo.lat != null && proGeo.lng != null ? 'profile' : 'none';
  const proZip5 = first5(proGeo.zip);
  if (proGeoSource === 'none' && proZip5) {
    const geo = await geocodeZip(proZip5);
    if (geo) {
      proGeo.lat = geo.lat;
      proGeo.lng = geo.lng;
      proGeoSource = 'zip_geocode';

      // Best-effort: persist the inferred geo back to the pro profile so future requests don't depend on geocoding.
      try {
        await bestEffortUpdateProRow(sb, proId, [
          { geo_lat: geo.lat, geo_lng: geo.lng },
          { lat: geo.lat, lng: geo.lng },
          { latitude: geo.lat, longitude: geo.lng },
        ]);
      } catch {
        // ignore
      }
    }
  }

  const geoWarning = (() => {
    if (proGeoSource === 'profile') return null;
    if (proGeoSource === 'zip_geocode') return 'Using ZIP-based location (centroid). Update your Profile address for more accurate distances.';
    return 'Missing location (no geo coordinates and no ZIP). Update your Profile so we can match you to nearby jobs.';
  })();

  const schema = await resolveDispatchSchema(sb, { preferProValue: payload.sub, preferEmailValue: payload.email });

  // Preferred path: assignments -> job_ids -> jobs
  let assignmentsHit: { table: string; rows: any[] } | null = null;

  if (schema) {
    // Try by pro_id first, then email (if token has email)
    const proValues = Array.from(new Set([payload.sub, payload.email].filter(Boolean).map((v) => String(v))));
    for (const v of proValues) {
      try {
        const { data, error } = await sb.from(schema.assignmentsTable).select('*').eq(schema.assignmentsProCol as any, v).limit(500);
        if (!error && data) {
          assignmentsHit = { table: schema.assignmentsTable, rows: data };
          if (data.length) break;
        }
      } catch {
        // ignore
      }
    }
  }

  if (!assignmentsHit) {
    assignmentsHit = await findAssignments(sb, { proId, email: payload.email || null });
  }
  if (!assignmentsHit || !assignmentsHit.rows.length) {
    // Legacy portal behavior: even with no assignments, return nearby available jobs as "offers".
    try {
      const offers = await fetchAvailableOffers(
        sb,
        {
          lat: proGeo.lat,
          lng: proGeo.lng,
          zip: proGeo.zip,
          radius: proGeo.radius,
          limit: 200,
        },
        schema ? { jobsTable: schema.jobsTable, jobsStatusCol: schema.jobsStatusCol } : undefined
      );

      if (offers.length) {
        return NextResponse.json(
          {
            ok: true,
            offers,
            upcoming: [],
            completed: [],
            meta: {
              mode: 'available_jobs_radius',
              pro_source_table: proProfile?.table || null,
              has_geo: proGeo.lat != null && proGeo.lng != null,
              radius_miles: proGeo.radius,
              geo: {
                pro_geo_source: proGeoSource,
                pro_zip5: proZip5,
                warning: geoWarning,
              },
            },
          },
          { headers: corsHeaders(request) }
        );
      }
    } catch {
      // ignore and fall through
    }

    // Fallback: try direct jobs table filter (some schemas store pro_id on jobs)
    if (schema) {
      const proCols = [
        schema.assignmentsProCol,
        'pro_id',
        'tech_id',
        'assigned_pro_id',
        'technician_id',
        'assigned_to',
        'Assigned_To',
        'pro_email',
        'tech_email',
        'email',
      ];
      const proValues = Array.from(new Set([payload.sub, payload.email].filter(Boolean).map((v) => String(v))));
      for (const col of proCols) {
        for (const val of proValues) {
          try {
            const { data, error } = await sb.from(schema.jobsTable).select('*').eq(col as any, val).limit(500);
            if (!error && Array.isArray(data) && data.length) {
              const normalized = (data || []).map((j: any) => ({
                ...j,
                job_id: j?.job_id ?? j?.[schema.jobsIdCol] ?? j?.id,
              }));
              const grouped = groupByState(normalized);
              return NextResponse.json(
                {
                  ok: true,
                  offers: grouped.offers,
                  upcoming: grouped.upcoming,
                  completed: grouped.completed,
                  meta: {
                    mode: 'jobs_direct',
                    jobs_table: schema.jobsTable,
                    jobs_id_col: schema.jobsIdCol,
                    assignments_table: schema.assignmentsTable,
                    assignments_pro_col: schema.assignmentsProCol,
                    assignments_job_col: schema.assignmentsJobCol,
                  },
                },
                { headers: corsHeaders(request) }
              );
            }
          } catch {
            // ignore
          }
        }
      }
    } else {
      for (const table of JOB_TABLE_CANDIDATES) {
        const proCols = ['pro_id', 'tech_id', 'assigned_pro_id', 'assigned_to', 'Assigned_To'];
        for (const col of proCols) {
          try {
            const { data, error } = await sb.from(table).select('*').eq(col as any, proId).limit(500);
            if (!error && Array.isArray(data) && data.length) {
              const grouped = groupByState(data);
              return NextResponse.json(
                { ok: true, offers: grouped.offers, upcoming: grouped.upcoming, completed: grouped.completed },
                { headers: corsHeaders(request) }
              );
            }
          } catch {
            // ignore
          }
        }
      }
    }

    return NextResponse.json(
      {
        ok: true,
        offers: [],
        upcoming: [],
        completed: [],
        meta: schema
          ? {
              mode: 'no_rows',
              jobs_table: schema.jobsTable,
              jobs_id_col: schema.jobsIdCol,
              assignments_table: schema.assignmentsTable,
              assignments_pro_col: schema.assignmentsProCol,
              assignments_job_col: schema.assignmentsJobCol,
              geo: {
                pro_geo_source: proGeoSource,
                pro_zip5: proZip5,
                warning: geoWarning,
              },
            }
          : {
              mode: 'no_rows',
              geo: {
                pro_geo_source: proGeoSource,
                pro_zip5: proZip5,
                warning: geoWarning,
              },
            },
      },
      { headers: corsHeaders(request) }
    );
  }

  const jobIdKey = schema?.assignmentsJobCol || 'job_id';
  const jobIds: string[] = Array.from(
    new Set(
      (assignmentsHit.rows || [])
        .map((r: any) => r?.[jobIdKey] ?? r?.job_id ?? r?.dispatch_job_id ?? r?.work_order_id ?? r?.ticket_id ?? r?.id)
        .filter((v: any) => v !== undefined && v !== null)
        .map((v: any) => String(v))
    )
  );

  let jobsHit: { table: string; rows: any[] } | null = null;
  if (schema && jobIds.length) {
    // Try a few likely id columns (schema-picked first)
    const idCols = Array.from(new Set([schema.jobsIdCol, 'job_id', 'dispatch_job_id', 'work_order_id', 'ticket_id', 'id']));
    for (const idCol of idCols) {
      try {
        const { data, error } = await sb.from(schema.jobsTable).select('*').in(idCol as any, jobIds).limit(500);
        if (!error && data) {
          jobsHit = { table: schema.jobsTable, rows: (data || []).map((j: any) => ({ ...j, job_id: j?.job_id ?? j?.[idCol] ?? j?.id })) };
          break;
        }
      } catch {
        // ignore
      }
    }
  }

  if (!jobsHit) {
    const fallback = jobIds.length ? await fetchJobsByIds(sb, jobIds) : null;
    if (fallback) {
      jobsHit = { table: fallback.table, rows: (fallback.rows || []).map((j: any) => ({ ...j, job_id: j?.job_id ?? j?.id })) };
    }
  }
  const jobsById = new Map<string, any>();
  for (const j of jobsHit?.rows || []) {
    if (j?.job_id !== undefined && j?.job_id !== null) jobsById.set(String(j.job_id), j);
  }

  const merged = (assignmentsHit.rows || []).map((a: any) => {
    const job = jobsById.get(String(a.job_id)) || { job_id: a.job_id };
    return mergeJobAssignment(job, a);
  });

  const grouped = groupByState(merged);

  // Important: accepting one job must NOT hide other nearby offers.
  // Always append available (unassigned) offers in the pro's radius.
  let nearbyOffers: any[] = [];
  try {
    nearbyOffers = await fetchAvailableOffers(
      sb,
      {
        lat: proGeo.lat,
        lng: proGeo.lng,
        zip: proGeo.zip,
        radius: proGeo.radius,
        limit: 200,
      },
      schema ? { jobsTable: schema.jobsTable, jobsStatusCol: schema.jobsStatusCol } : undefined
    );
  } catch {
    nearbyOffers = [];
  }

  const assignedJobIds = new Set<string>(
    merged
      .map((r: any) => String(r?.job_id ?? r?.[schema?.jobsIdCol || 'job_id'] ?? r?.id ?? ''))
      .filter((s: string) => !!s)
  );

  const upcomingIds = new Set<string>(
    grouped.upcoming
      .map((r: any) => String(r?.job_id ?? r?.[schema?.jobsIdCol || 'job_id'] ?? r?.id ?? ''))
      .filter((s: string) => !!s)
  );
  const completedIds = new Set<string>(
    grouped.completed
      .map((r: any) => String(r?.job_id ?? r?.[schema?.jobsIdCol || 'job_id'] ?? r?.id ?? ''))
      .filter((s: string) => !!s)
  );

  const filteredNearbyOffers = (nearbyOffers || []).filter((j: any) => {
    const id = String(j?.job_id ?? j?.[schema?.jobsIdCol || 'job_id'] ?? j?.id ?? '').trim();
    if (!id) return true;
    if (assignedJobIds.has(id)) return false;
    if (upcomingIds.has(id)) return false;
    if (completedIds.has(id)) return false;
    return true;
  });

  const combinedOffers = [...filteredNearbyOffers, ...(grouped.offers || [])];

  // DEBUG: Log what we're actually returning
  console.log('[portal_jobs] Returning data:');
  console.log(`  - offers: ${combinedOffers.length} jobs`);
  console.log(`  - upcoming: ${grouped.upcoming?.length || 0} jobs`);
  if (combinedOffers.length > 0) {
    const firstOffer = combinedOffers[0];
    console.log('[portal_jobs] First offer fields:', {
      job_id: firstOffer.job_id,
      customer_name: firstOffer.customer_name,
      customer_phone: firstOffer.customer_phone,
      service_address: firstOffer.service_address,
      service_city: firstOffer.service_city,
      has_metadata: !!firstOffer.metadata,
      metadata_items: firstOffer.metadata?.items_json?.length || 0
    });
  }

  return NextResponse.json(
    {
      ok: true,
      offers: combinedOffers,
      upcoming: grouped.upcoming,
      completed: grouped.completed,
      meta: {
        mode: 'assignments_plus_available_offers',
        assignments_table: assignmentsHit.table,
        jobs_table: jobsHit?.table || null,
        assignments_job_key_used: jobIdKey,
        nearby_offers_added: filteredNearbyOffers.length,
        geo: {
          pro_geo_source: proGeoSource,
          pro_zip5: proZip5,
          warning: geoWarning,
        },
        discovered: schema
          ? {
              jobs_table: schema.jobsTable,
              jobs_id_col: schema.jobsIdCol,
              assignments_table: schema.assignmentsTable,
              assignments_pro_col: schema.assignmentsProCol,
              assignments_job_col: schema.assignmentsJobCol,
            }
          : null,
      },
    },
    { headers: corsHeaders(request) }
  );
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const token = body?.token || '';
    return await handle(request, token);
  } catch (error: any) {
    const msg = error?.message || 'Internal error';
    const isAuth = /token/i.test(msg) || /signature/i.test(msg) || /expired/i.test(msg) || /format/i.test(msg);
    return NextResponse.json(
      { ok: false, error: msg, error_code: isAuth ? 'bad_session' : 'server_error' },
      { status: isAuth ? 401 : 500, headers: corsHeaders(request) }
    );
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get('token') || '';
    const jobId = searchParams.get('job_id') || ''; // ✅ Support single job fetch
    return await handle(request, token, jobId);
  } catch (error: any) {
    const msg = error?.message || 'Internal error';
    const isAuth = /token/i.test(msg) || /signature/i.test(msg) || /expired/i.test(msg) || /format/i.test(msg);
    return NextResponse.json(
      { ok: false, error: msg, error_code: isAuth ? 'bad_session' : 'server_error' },
      { status: isAuth ? 401 : 500, headers: corsHeaders(request) }
    );
  }
}

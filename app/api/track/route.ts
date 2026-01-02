import { NextResponse } from 'next/server';
import { getSupabase, getSupabaseDb1 } from '../../lib/supabase';
import OpenAI from 'openai';

// Initialize OpenAI only if API key exists
const openai = process.env.OPENAI_API_KEY 
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

// Helper to handle CORS
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders() });
}

export async function GET(request: Request) {
  // STEP 1: Always return 200 - route proof
  // Build marker: 2024-01-15-force-rebuild-v2
  const buildMarker = process.env.VERCEL_GIT_COMMIT_SHA || 
                      process.env.VERCEL_GIT_COMMIT_REF || 
                      `build-${new Date().toISOString()}`;
  
  console.log('[TRACK_ROUTE_HIT] GET /api/track', { build: buildMarker });
  
  return NextResponse.json({
    ok: true,
    route: 'api/track',
    build: buildMarker,
    deployed_at: new Date().toISOString()
  }, { 
    status: 200,
    headers: corsHeaders()
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

// Helper: Generate or validate UUID
function ensureUUID(value: string | null | undefined): string | null {
  if (!value) return null;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (uuidRegex.test(value)) {
    return value;
  }
  return null;
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
    return NextResponse.json({
      ok: false,
      code: 'INVALID_JSON',
      request_id: requestId,
      message: 'Invalid JSON payload',
      details: { error: error.message }
    }, { status: 400, headers: corsHeaders() });
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
      }, { status: 500, headers: corsHeaders() });
    }

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

    // Extract event data
    const eventName = body.event_name || body.event_type || body.Event_Type || 'page_view';
    const eventTs = body.occurred_at || body.event_time || body.Event_Time || new Date().toISOString();
    // Generate session_id if not provided (database requires NOT NULL)
    const sessionId = body.session_id || body.Session_ID || crypto.randomUUID();
    
    // Extract customer identity (for linking)
    const customerEmail = normalizeIdentity('email', body.customer_email || body.Customer_Email);
    const customerPhone = normalizeIdentity('phone', body.customer_phone || body.Customer_Phone);

    // Extract device type from user_agent
    const detectDeviceType = (userAgent: string | null | undefined): string | null => {
      if (!userAgent) return null;
      const ua = userAgent.toLowerCase();
      if (/mobile|android|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(ua)) {
        if (/tablet|ipad|playbook|silk/i.test(ua)) return 'tablet';
        return 'mobile';
      }
      return 'desktop';
    };

    // Extract page_type from page_path or metadata
    const extractPageType = (pagePath: string | null, metadata: any): string | null => {
      if (metadata?.page_type) return metadata.page_type;
      if (metadata?.pageType) return metadata.pageType;
      if (!pagePath) return null;
      
      // Intelligent page type detection from path
      const path = pagePath.toLowerCase();
      if (path === '/' || path === '/home' || path.includes('home')) return 'home';
      if (path.includes('shop') || path.includes('bundles')) return 'shop';
      if (path.includes('security')) return 'security';
      if (path.includes('tvmount') || path.includes('tv-mount')) return 'tvmounting';
      if (path.includes('smart')) return 'smart';
      if (path.includes('contact')) return 'contact';
      if (path.includes('quote')) return 'quote';
      return 'other';
    };

    const deviceType = detectDeviceType(body.user_agent || body.User_Agent);
    const userAgent = body.user_agent || body.User_Agent || null;

    // Extract IP from request headers (for geo-location, hashed for privacy)
    const forwardedFor = request.headers.get('x-forwarded-for');
    const realIP = request.headers.get('x-real-ip');
    const clientIP = forwardedFor?.split(',')[0]?.trim() || realIP || null;
    
    // Hash IP for privacy (simple hash, in production use proper hashing)
    let ipHash: string | null = null;
    if (clientIP) {
      // Simple hash for privacy (in production, use crypto.createHash)
      try {
        const encoder = new TextEncoder();
        const data = encoder.encode(clientIP);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        ipHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 32);
      } catch (e) {
        // If crypto.subtle not available, skip IP hashing
      }
    }

    // STEP 2: Upsert visitor row (last_seen_at)
    const visitorData: any = {
      visitor_id: visitorId,
      last_seen_at: eventTs,
      user_agent: userAgent,
      ip_hash: ipHash,
      last_utm_source: body.utm_source || body.UTM_Source || null,
      last_utm_medium: body.utm_medium || body.UTM_Medium || null,
      last_utm_campaign: body.utm_campaign || body.UTM_Campaign || null,
      last_utm_term: body.utm_term || body.UTM_Term || null,
      last_utm_content: body.utm_content || body.UTM_Content || null,
      last_referrer: body.referrer || null,
      device_type: deviceType || body.device_type || body.Device_Type || null
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
      }, { status: 500, headers: corsHeaders() });
    }

    console.log('[TRACK_POST_VISITOR_SUCCESS]', {
      request_id: requestId,
      visitor_id: visitorId.substring(0, 20) + '...',
      is_new: !existingVisitor
    });

    // STEP 3: Insert event row (INSERT ONLY, no upsert)
    const eventId = crypto.randomUUID();
    const pagePath = body.page_path || (body.page_url ? new URL(body.page_url).pathname : null) || null;
    
    // Build comprehensive metadata/properties JSONB
    const properties: any = {};
    
    // Parse existing metadata if provided
    if (body.metadata) {
      Object.assign(properties, typeof body.metadata === 'string' ? JSON.parse(body.metadata) : body.metadata);
    }
    
    // Extract and store page_type (from metadata or infer from path)
    const pageType = extractPageType(pagePath, properties);
    if (pageType) {
      properties.page_type = pageType;
    }
    
    // Store content_category if provided
    if (body.content_category || body.contentCategory) {
      properties.content_category = body.content_category || body.contentCategory;
    }
    
    // Store content_name if provided
    if (body.content_name || body.contentName) {
      properties.content_name = body.content_name || body.contentName;
    }
    
    // Store element tracking
    if (body.element_id || body.elementId) {
      properties.element_id = body.element_id || body.elementId;
    }
    if (body.element_text || body.elementText) {
      properties.element_text = body.element_text || body.elementText;
    }
    
    // Store button location for CTAs
    if (body.button_location || body.buttonLocation) {
      properties.button_location = body.button_location || body.buttonLocation;
    }
    
    // Store device type in properties for analytics
    if (deviceType) {
      properties.device_type = deviceType;
    }
    
    // Store all UTM params in metadata for easy querying
    if (body.utm_source || body.UTM_Source) {
      properties.utm_source = body.utm_source || body.UTM_Source;
    }
    if (body.utm_medium || body.UTM_Medium) {
      properties.utm_medium = body.utm_medium || body.UTM_Medium;
    }
    if (body.utm_campaign || body.UTM_Campaign) {
      properties.utm_campaign = body.utm_campaign || body.UTM_Campaign;
    }
    
    // Store event-specific metadata
    if (body.value !== undefined) properties.value = body.value;
    if (body.currency) properties.currency = body.currency;
    if (body.num_items) properties.num_items = body.num_items;
    
    const eventData: any = {
      id: eventId,
      event_id: eventId,
      visitor_id: visitorId,
      event_type: eventName, // Database requires event_type (NOT NULL)
      event_name: eventName,  // Also set event_name for compatibility
      event_ts: eventTs,
      session_id: sessionId,
      page_url: body.page_url || body.Page_URL || null,
      page_path: pagePath,
      referrer: body.referrer || null,
      user_agent: userAgent,
      utm_source: body.utm_source || body.UTM_Source || null,
      utm_medium: body.utm_medium || body.UTM_Medium || null,
      utm_campaign: body.utm_campaign || body.UTM_Campaign || null,
      utm_term: body.utm_term || body.UTM_Term || null,
      utm_content: body.utm_content || body.UTM_Content || null,
      revenue_amount: body.revenue_amount || body.revenue || body.Value || null,
      order_id: ensureUUID(body.order_id || body.Order_ID) || null
    };
    
    // Store customer identity in metadata for attribution queries
    if (customerEmail) {
      properties.customer_email = customerEmail;
    }
    if (customerPhone) {
      properties.customer_phone = customerPhone;
    }

    // Only add properties if we have data
    if (Object.keys(properties).length > 0) {
      eventData.properties = properties;
    }

    const { data: insertedEvent, error: eventError } = await client
      .from('h2s_tracking_events')
      .insert(eventData)
      .select('id')
      .single();

    if (eventError) {
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
      }, { status: 500, headers: corsHeaders() });
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
    const headers: any = { ...corsHeaders() };
    if (process.env.NODE_ENV === 'production') {
      headers['Set-Cookie'] = `visitor_id=${visitorId}; Path=/; Max-Age=31536000; SameSite=Lax; Secure`;
    }

    return NextResponse.json(response, { 
      status: 200, 
      headers 
    });

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
    }, { status: 500, headers: corsHeaders() });
  }
}

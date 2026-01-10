import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getSupabase, getSupabaseDispatch } from '@/lib/supabase';

/**
 * Customer Orders API
 * Returns recent orders for a customer by email or session_id
 * 
 * POST /api/customer_orders
 * Body: { customer_email, session_id }
 * Returns: { ok, orders: [...] }
 */

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders() });
}

interface OrderRecord {
  order_id: string;
  session_id: string;
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  total: number;
  status: string;
  created_at: string;
  metadata_json?: any;
}

interface DispatchJob {
  job_id: string;
  status: string;
  due_at: string | null;
  customer_photos_count?: number;
  metadata?: any;
}

export async function POST(request: NextRequest) {
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  const startTime = performance.now();
  
  try {
    const body = await request.json();
    const customerEmail = String(body?.customer_email || '').trim().toLowerCase();
    const sessionId = String(body?.session_id || '').trim();
    
    if (!customerEmail && !sessionId) {
      return NextResponse.json({
        ok: false,
        error: 'Missing required parameter: customer_email or session_id',
        code: 'MISSING_IDENTIFIER',
        request_id: requestId,
      }, { status: 400, headers: corsHeaders() });
    }
    
    const ordersClient = getSupabase();
    if (!ordersClient) {
      return NextResponse.json({
        ok: false,
        error: 'Orders database not configured',
        code: 'DB_NOT_CONFIGURED',
        request_id: requestId,
      }, { status: 503, headers: corsHeaders() });
    }
    
    // Query orders by email or session_id
    let query = ordersClient
      .from('h2s_orders')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(20);
    
    if (customerEmail) {
      query = query.eq('customer_email', customerEmail);
    } else if (sessionId) {
      query = query.eq('session_id', sessionId);
    }
    
    const { data: ordersData, error: ordersError } = await query;
    
    if (ordersError) {
      console.error('[customer_orders] Query error:', ordersError);
      return NextResponse.json({
        ok: false,
        error: 'Failed to query orders',
        code: 'QUERY_ERROR',
        request_id: requestId,
      }, { status: 500, headers: corsHeaders() });
    }
    
    if (!ordersData || ordersData.length === 0) {
      return NextResponse.json({
        ok: true,
        orders: [],
        count: 0,
        request_id: requestId,
        duration_ms: Math.round(performance.now() - startTime),
      }, { headers: corsHeaders() });
    }
    
    // Enrich orders with dispatch job data
    const dispatchClient = getSupabaseDispatch();
    const enrichedOrders = await Promise.all(ordersData.map(async (order: OrderRecord) => {
      const metadata = order.metadata_json || {};
      
      // Try to find linked dispatch job
      let jobData: DispatchJob | null = null;
      let photosCount = 0;
      
      if (dispatchClient) {
        try {
          // Look up by dispatch_job_id in metadata or by order_id
          const jobId = metadata.dispatch_job_id;
          let jobQuery;
          
          if (jobId) {
            jobQuery = dispatchClient
              .from('h2s_dispatch_jobs')
              .select('job_id, status, due_at, metadata')
              .eq('job_id', jobId)
              .single();
          } else {
            // Fallback: search by session_id in job metadata
            jobQuery = dispatchClient
              .from('h2s_dispatch_jobs')
              .select('job_id, status, due_at, metadata')
              .contains('metadata', { stripe_session_id: order.session_id })
              .limit(1)
              .single();
          }
          
          const { data: job } = await jobQuery;
          
          if (job) {
            jobData = job;
            
            // Count photos for this job
            const { count } = await dispatchClient
              .from('h2s_customer_uploads')
              .select('*', { count: 'exact', head: true })
              .eq('job_id', job.job_id);
            
            photosCount = count || 0;
          }
        } catch (err) {
          console.warn('[customer_orders] Job lookup failed for order:', order.order_id, err);
        }
      }
      
      // Determine schedule status
      const deliveryDate = (order as any).delivery_date || metadata.scheduled_date || jobData?.metadata?.scheduled_date || null;
      const deliveryTime = (order as any).delivery_time || metadata.time_window || jobData?.metadata?.time_window || null;
      const scheduleStatus = deliveryDate ? 'Scheduled' : (metadata.schedule_status || 'Scheduling Pending');
      
      // Build service summary
      const items = metadata.items_json || [];
      const serviceSummary = items.length > 0
        ? items.map((item: any) => `${item.name} (x${item.quantity})`).join(', ')
        : metadata.job_details_summary || 'Service';
      
      return {
        order_id: order.order_id,
        session_id: order.session_id,
        customer_name: order.customer_name,
        customer_email: order.customer_email,
        customer_phone: order.customer_phone,
        total: order.total,
        status: order.status,
        created_at: order.created_at,
        
        // Service details
        service_summary: serviceSummary,
        service_address: metadata.service_address || metadata.address || null,
        service_city: metadata.service_city || metadata.city || null,
        service_state: metadata.service_state || metadata.state || null,
        service_zip: metadata.service_zip || metadata.zip || null,
        
        // Schedule info
        schedule_status: scheduleStatus,
        scheduled_date: deliveryDate,
        installation_date: deliveryDate, // Alias for compatibility
        time_window: deliveryTime,
        time_preference: deliveryTime, // Alias for compatibility
        
        // Job info
        job_id: jobData?.job_id || null,
        job_status: jobData?.status || null,
        
        // Photos
        photos_count: photosCount,
        photos_uploaded: photosCount > 0,
        
        // Promo
        promo_code: metadata.promo_code || null,
        discount: metadata.discount || 0,
        
        // Metadata (sanitized)
        equipment_provided: metadata.equipment_provided || null,
        job_details: metadata.job_details_summary || null,
      };
    }));
    
    const duration = Math.round(performance.now() - startTime);
    
    return NextResponse.json({
      ok: true,
      orders: enrichedOrders,
      count: enrichedOrders.length,
      request_id: requestId,
      duration_ms: duration,
      server_timestamp: new Date().toISOString(),
    }, { headers: corsHeaders() });
    
  } catch (err: any) {
    console.error('[customer_orders] Exception:', err);
    return NextResponse.json({
      ok: false,
      error: 'Internal server error',
      code: 'EXCEPTION',
      message: err.message,
      request_id: requestId,
    }, { status: 500, headers: corsHeaders() });
  }
}

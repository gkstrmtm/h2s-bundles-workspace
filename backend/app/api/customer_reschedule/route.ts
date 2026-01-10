import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getSupabase, getSupabaseDispatch } from '@/lib/supabase';

/**
 * Customer Reschedule API
 * Allows customers to update scheduled date/time for their order
 * 
 * POST /api/customer_reschedule
 * Body: { 
 *   session_id or order_id,
 *   scheduled_iso (ISO 8601 date),
 *   timezone,
 *   time_window
 * }
 * Returns: { ok, updated_order_id, updated_job_id, scheduled_date }
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

function isValidISODate(dateString: string): boolean {
  const date = new Date(dateString);
  return date instanceof Date && !isNaN(date.getTime());
}

function isValidTimeWindow(window: string): boolean {
  const validWindows = ['9am - 12pm', '12pm - 3pm', '3pm - 6pm', '9-12', '12-3', '3-6'];
  return validWindows.some(valid => window.toLowerCase().includes(valid.toLowerCase()));
}

export async function POST(request: NextRequest) {
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  const startTime = performance.now();
  
  try {
    const body = await request.json();
    
    const sessionId = String(body?.session_id || '').trim();
    const orderId = String(body?.order_id || '').trim();
    const scheduledIso = String(body?.scheduled_iso || '').trim();
    const timezone = String(body?.timezone || 'America/New_York').trim();
    const timeWindow = String(body?.time_window || '').trim();
    
    // Validation
    if (!sessionId && !orderId) {
      return NextResponse.json({
        ok: false,
        error: 'Missing required parameter: session_id or order_id',
        code: 'MISSING_IDENTIFIER',
        request_id: requestId,
      }, { status: 400, headers: corsHeaders() });
    }
    
    if (!scheduledIso) {
      return NextResponse.json({
        ok: false,
        error: 'Missing required parameter: scheduled_iso',
        code: 'MISSING_DATE',
        request_id: requestId,
      }, { status: 400, headers: corsHeaders() });
    }
    
    if (!isValidISODate(scheduledIso)) {
      return NextResponse.json({
        ok: false,
        error: 'Invalid date format. Use ISO 8601 (YYYY-MM-DDTHH:mm:ssZ)',
        code: 'INVALID_DATE_FORMAT',
        request_id: requestId,
      }, { status: 400, headers: corsHeaders() });
    }
    
    // Check date is in the future
    const scheduledDate = new Date(scheduledIso);
    const now = new Date();
    if (scheduledDate < now) {
      return NextResponse.json({
        ok: false,
        error: 'Scheduled date must be in the future',
        code: 'INVALID_DATE_PAST',
        request_id: requestId,
      }, { status: 400, headers: corsHeaders() });
    }
    
    if (timeWindow && !isValidTimeWindow(timeWindow)) {
      return NextResponse.json({
        ok: false,
        error: 'Invalid time window. Use: 9am - 12pm, 12pm - 3pm, or 3pm - 6pm',
        code: 'INVALID_TIME_WINDOW',
        request_id: requestId,
      }, { status: 400, headers: corsHeaders() });
    }
    
    // Get database clients
    const ordersClient = getSupabase();
    const dispatchClient = getSupabaseDispatch();
    
    if (!ordersClient) {
      return NextResponse.json({
        ok: false,
        error: 'Database not configured',
        code: 'DB_NOT_CONFIGURED',
        request_id: requestId,
      }, { status: 503, headers: corsHeaders() });
    }
    
    // Find order
    let orderQuery = ordersClient.from('h2s_orders').select('order_id, metadata_json, session_id');
    
    if (orderId) {
      orderQuery = orderQuery.eq('order_id', orderId);
    } else {
      orderQuery = orderQuery.eq('session_id', sessionId);
    }
    
    const { data: orderData, error: orderError } = await orderQuery.single();
    
    if (orderError || !orderData) {
      return NextResponse.json({
        ok: false,
        error: 'Order not found',
        code: 'ORDER_NOT_FOUND',
        request_id: requestId,
      }, { status: 404, headers: corsHeaders() });
    }
    
    // Update order metadata
    const currentMetadata = orderData.metadata_json || {};
    const previousScheduledDate = currentMetadata.scheduled_date || null;
    const isRescheduling = !!previousScheduledDate;
    
    const updatedMetadata = {
      ...currentMetadata,
      scheduled_date: scheduledIso,
      timezone: timezone,
      time_window: timeWindow || currentMetadata.time_window || 'TBD',
      schedule_status: 'Scheduled',
      rescheduled: isRescheduling,
      rescheduled_at: isRescheduling ? new Date().toISOString() : undefined,
      previous_scheduled_date: isRescheduling ? previousScheduledDate : undefined,
    };
    
    const { error: updateError } = await ordersClient
      .from('h2s_orders')
      .update({
        delivery_date: scheduledIso.split('T')[0], // Extract YYYY-MM-DD
        delivery_time: timeWindow || 'TBD',
        metadata_json: updatedMetadata,
        updated_at: new Date().toISOString(),
      })
      .eq('order_id', orderData.order_id);
    
    if (updateError) {
      console.error('[customer_reschedule] Order update failed:', updateError);
      return NextResponse.json({
        ok: false,
        error: 'Failed to update order',
        code: 'UPDATE_FAILED',
        request_id: requestId,
      }, { status: 500, headers: corsHeaders() });
    }
    
    // Update dispatch job if exists
    let updatedJobId: string | null = null;
    
    if (dispatchClient) {
      try {
        const jobId = currentMetadata.dispatch_job_id;
        
        if (jobId) {
          // Update by job_id
          const { error: jobError } = await dispatchClient
            .from('h2s_dispatch_jobs')
            .update({
              status: 'scheduled',
              due_at: scheduledIso,
              metadata: {
                ...currentMetadata,
                scheduled_date: scheduledIso,
                timezone: timezone,
                time_window: timeWindow,
                schedule_status: 'Scheduled',
                rescheduled: isRescheduling,
              },
            })
            .eq('job_id', jobId);
          
          if (!jobError) {
            updatedJobId = jobId;
          }
        } else {
          // Fallback: search by session_id
          const { data: jobs } = await dispatchClient
            .from('h2s_dispatch_jobs')
            .select('job_id')
            .contains('metadata', { stripe_session_id: orderData.session_id })
            .limit(1);
          
          if (jobs && jobs.length > 0) {
            const { error: jobError } = await dispatchClient
              .from('h2s_dispatch_jobs')
              .update({
                status: 'scheduled',
                due_at: scheduledIso,
                metadata: {
                  ...currentMetadata,
                  scheduled_date: scheduledIso,
                  timezone: timezone,
                  time_window: timeWindow,
                  schedule_status: 'Scheduled',
                  rescheduled: isRescheduling,
                },
              })
              .eq('job_id', jobs[0].job_id);
            
            if (!jobError) {
              updatedJobId = jobs[0].job_id;
            }
          }
        }
      } catch (jobErr) {
        console.warn('[customer_reschedule] Job update failed (non-fatal):', jobErr);
      }
    }
    
    const duration = Math.round(performance.now() - startTime);
    
    return NextResponse.json({
      ok: true,
      updated_order_id: orderData.order_id,
      updated_job_id: updatedJobId,
      scheduled_date: scheduledIso,
      timezone: timezone,
      time_window: timeWindow || 'TBD',
      was_rescheduled: isRescheduling,
      request_id: requestId,
      duration_ms: duration,
      server_timestamp: new Date().toISOString(),
    }, { headers: corsHeaders() });
    
  } catch (err: any) {
    console.error('[customer_reschedule] Exception:', err);
    return NextResponse.json({
      ok: false,
      error: 'Internal server error',
      code: 'EXCEPTION',
      message: err.message,
      request_id: requestId,
    }, { status: 500, headers: corsHeaders() });
  }
}

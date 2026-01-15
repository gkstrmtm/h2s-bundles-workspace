import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseDb1, getSupabase, getSupabaseDispatch } from '@/lib/supabase';

function corsHeaders(request?: Request) {
  const allowedOrigins = [
    'https://home2smart.com',
    'https://www.home2smart.com',
    'https://shop.home2smart.com',
    'http://localhost:3000',
    'http://localhost:3001'
  ];
  
  const origin = request?.headers.get('origin') || '';
  const allowOrigin = allowedOrigins.includes(origin) ? origin : allowedOrigins[0];
  
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

export async function OPTIONS(request: Request) {
  return NextResponse.json({}, { headers: corsHeaders(request) });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { session_id, scheduled_iso, timezone, time_window } = body;

    // Validate required fields
    if (!session_id) {
      return NextResponse.json({
        ok: false,
        error: 'session_id is required'
      }, { status: 400, headers: corsHeaders(req) });
    }

    if (!scheduled_iso) {
      return NextResponse.json({
        ok: false,
        error: 'scheduled_iso is required (ISO 8601 date string)'
      }, { status: 400, headers: corsHeaders(req) });
    }

    // Validate date format
    const scheduledDate = new Date(scheduled_iso);
    if (isNaN(scheduledDate.getTime())) {
      return NextResponse.json({
        ok: false,
        error: 'Invalid scheduled_iso format. Use ISO 8601.'
      }, { status: 400, headers: corsHeaders(req) });
    }

    console.log('[ScheduleConfirm] Processing:', {
      session_id,
      scheduled_iso,
      timezone: timezone || 'not provided',
      time_window: time_window || 'not provided'
    });

    // Find order by session_id
    const client = getSupabaseDb1() || getSupabase();
    if (!client) {
      return NextResponse.json({
        ok: false,
        error: 'Database not available'
      }, { status: 500, headers: corsHeaders(req) });
    }

    const { data: order, error: orderError } = await client
      .from('h2s_orders')
      .select('order_id, metadata_json')
      .eq('session_id', session_id)
      .single();

    if (orderError || !order) {
      console.error('[ScheduleConfirm] Order not found:', session_id);
      return NextResponse.json({
        ok: false,
        error: 'Order not found for this session'
      }, { status: 404, headers: corsHeaders(req) });
    }

    // Update order with schedule details
    const metadata = (order.metadata_json && typeof order.metadata_json === 'object') 
      ? order.metadata_json 
      : {};

    const updatedMetadata = {
      ...metadata,
      scheduled_date: scheduled_iso,
      timezone: timezone || 'America/New_York',
      time_window: time_window || 'Not specified',
      schedule_status: 'Scheduled',
      scheduled_at: new Date().toISOString(),
    };

    const { error: updateError } = await client
      .from('h2s_orders')
      .update({
        metadata_json: updatedMetadata
      })
      .eq('order_id', order.order_id);

    if (updateError) {
      console.error('[ScheduleConfirm] Failed to update order:', updateError);
      return NextResponse.json({
        ok: false,
        error: 'Failed to update order schedule'
      }, { status: 500, headers: corsHeaders(req) });
    }

    console.log('[ScheduleConfirm] Order updated:', order.order_id);

    // Update dispatch job if exists
    const dispatchJobId = metadata?.dispatch_job_id || metadata?.job_id;
    if (dispatchJobId) {
      try {
        const dispatch = getSupabaseDispatch() || client;
        
        // ✅ FIX: Update BOTH start_iso and due_at (canonical schedule fields)
        // Guardrail: Never overwrite a completed/done job
        const { error: jobError } = await dispatch
          .from('h2s_dispatch_jobs')
          .update({
            status: 'scheduled',
            start_iso: scheduled_iso,
            due_at: scheduled_iso,
            metadata: {
              ...(metadata || {}),
              scheduled_date: scheduled_iso,
              timezone: timezone || 'America/New_York',
              time_window: time_window || 'Not specified',
              schedule_status: 'Scheduled',
              scheduled_at: new Date().toISOString(),
            }
          })
          .eq('job_id', dispatchJobId)
          .not('status', 'in', '("completed","done","cancelled")'); // Guardrail

        if (jobError) {
          console.warn('[ScheduleConfirm] Failed to update dispatch job:', jobError);
          // Don't fail the request if job update fails
        } else {
          console.log('[ScheduleConfirm] ✅ Dispatch job updated with start_iso:', dispatchJobId, scheduled_iso);
        }
      } catch (dispatchError) {
        console.warn('[ScheduleConfirm] Dispatch update error:', dispatchError);
        // Don't fail the request
      }
    } else {
      console.warn('[ScheduleConfirm] No dispatch_job_id found in order metadata');
    }

    return NextResponse.json({
      ok: true,
      updated_order_id: order.order_id,
      updated_job_id: dispatchJobId || null,
      scheduled_iso,
      message: 'Schedule confirmed successfully'
    }, { headers: corsHeaders(req) });

  } catch (error: any) {
    console.error('[ScheduleConfirm] Unexpected error:', error);
    return NextResponse.json({
      ok: false,
      error: 'Server error processing schedule confirmation',
      details: error.message
    }, { status: 500, headers: corsHeaders(req) });
  }
}

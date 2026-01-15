import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase';

/**
 * Admin Trace Status Endpoint
 * GET /api/admin/trace_status?trace_id=xxx
 * Header: x-admin-key must match process.env.ADMIN_KEY
 */

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const adminKey = request.headers.get('x-admin-key');
  
  if (!adminKey || adminKey !== process.env.ADMIN_KEY) {
    return NextResponse.json({
      ok: false,
      error: 'Unauthorized'
    }, { status: 401 });
  }
  
  const searchParams = request.nextUrl.searchParams;
  const traceId = searchParams.get('trace_id');
  
  if (!traceId) {
    return NextResponse.json({
      ok: false,
      error: 'Missing trace_id parameter'
    }, { status: 400 });
  }
  
  const client = getSupabase();
  if (!client) {
    return NextResponse.json({
      ok: false,
      error: 'Database not configured'
    }, { status: 503 });
  }
  
  try {
    // Get all trace stages for this checkout
    const { data: traces, error: tracesError } = await client
      .from('h2s_checkout_traces')
      .select('*')
      .eq('checkout_trace_id', traceId)
      .order('created_at', { ascending: true });
    
    if (tracesError) {
      console.error('[TraceStatus] Error fetching traces:', tracesError);
      return NextResponse.json({
        ok: false,
        error: 'Failed to fetch traces'
      }, { status: 500 });
    }
    
    // Get failures for this checkout
    const { data: failures, error: failuresError } = await client
      .from('h2s_checkout_failures')
      .select('*')
      .eq('checkout_trace_id', traceId)
      .order('created_at', { ascending: true });
    
    if (failuresError) {
      console.error('[TraceStatus] Error fetching failures:', failuresError);
    }
    
    const latestTrace = traces && traces.length > 0 ? traces[traces.length - 1] : null;
    const latestFailure = failures && failures.length > 0 ? failures[failures.length - 1] : null;
    
    // Try to get order details if order_id exists
    let orderSummary = null;
    if (latestTrace?.order_id) {
      const { data: order } = await client
        .from('h2s_orders')
        .select('order_id, status, customer_email, created_at, metadata_json')
        .eq('order_id', latestTrace.order_id)
        .single();
      
      if (order) {
        orderSummary = {
          order_id: order.order_id,
          status: order.status,
          customer_email: order.customer_email,
          created_at: order.created_at,
          job_id_in_metadata: order.metadata_json?.dispatch_job_id || null
        };
      }
    }
    
    // Try to get job details if job_id exists
    let jobSummary = null;
    if (latestTrace?.job_id) {
      const { data: job } = await client
        .from('h2s_dispatch_jobs')
        .select('job_id, status, recipient_id, created_at')
        .eq('job_id', latestTrace.job_id)
        .single();
      
      if (job) {
        jobSummary = {
          job_id: job.job_id,
          status: job.status,
          recipient_id: job.recipient_id,
          created_at: job.created_at
        };
      }
    }
    
    return NextResponse.json({
      ok: true,
      trace_id: traceId,
      latest_stage: latestTrace?.stage || 'UNKNOWN',
      all_stages: traces?.map(t => t.stage) || [],
      traces: traces || [],
      failures: failures || [],
      latest_failure: latestFailure,
      order: orderSummary,
      job: jobSummary,
      summary: {
        total_traces: traces?.length || 0,
        total_failures: failures?.length || 0,
        has_order: !!orderSummary,
        has_job: !!jobSummary,
        completed: latestTrace?.stage === 'DONE'
      }
    });
    
  } catch (error: any) {
    console.error('[TraceStatus] Exception:', error);
    return NextResponse.json({
      ok: false,
      error: error.message || 'Internal error'
    }, { status: 500 });
  }
}

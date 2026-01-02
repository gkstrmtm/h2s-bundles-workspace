import { NextResponse } from 'next/server';
import { getSupabaseDb1 } from '@/lib/supabase';

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders() });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const period = searchParams.get('period') || 'day'; // day, week, month

  try {
    const client = getSupabaseDb1();
    
    if (!client) {
      return NextResponse.json({
        success: false,
        stats: {},
        error: 'Tracking database not available'
      }, { status: 503, headers: corsHeaders() });
    }

    // Calculate date range based on period
    const now = new Date();
    let startDate: Date;
    
    switch (period) {
      case 'week':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'month':
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      default: // day
        startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    }

    // Fetch tracking stats
    const [visitorsRes, eventsRes] = await Promise.all([
      client
        .from('h2s_tracking_visitors')
        .select('visitor_id', { count: 'exact' })
        .gte('first_seen_ts', startDate.toISOString()),
      client
        .from('h2s_tracking_events')
        .select('event_id, event_type', { count: 'exact' })
        .gte('event_ts', startDate.toISOString())
    ]);

    // Calculate stats
    const stats = {
      period,
      visitors: visitorsRes.count || 0,
      events: eventsRes.count || 0,
      pageViews: eventsRes.data?.filter((e: any) => e.event_type === 'page_view').length || 0,
      interactions: eventsRes.data?.filter((e: any) => e.event_type !== 'page_view').length || 0
    };

    return NextResponse.json({
      success: true,
      stats
    }, { headers: corsHeaders() });

  } catch (error: any) {
    console.error('[Stats API] Error:', error);
    return NextResponse.json({
      success: false,
      stats: {},
      error: error.message
    }, { status: 500, headers: corsHeaders() });
  }
}

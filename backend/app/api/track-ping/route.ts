import { NextResponse } from 'next/server';
import { getSupabase, getSupabaseDb1 } from '@/lib/supabase';

// Helper to handle CORS
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

function applyInternalPathExclusions<T extends { not: any }>(query: T): T {
  // Exclude internal/admin pages from health checks.
  // NOTE: We keep these aligned with /api/track ingestion blocking.
  return query
    .not('page_path', 'ilike', '/funnels%')
    .not('page_path', 'ilike', '/dashboard%')
    .not('page_path', 'ilike', '/portal%')
    .not('page_path', 'ilike', '/dispatch%')
    .not('page_path', 'ilike', '/funnel-track%');
}

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders() });
}

export async function GET() {
  try {
    const client = getSupabaseDb1() || getSupabase();

    // Get most recent event
    const { data: recentEvents, error: recentError } = await client
      .from('h2s_tracking_events')
      .select('occurred_at')
      .order('occurred_at', { ascending: false })
      .limit(1);

    if (recentError) {
      console.error('Error fetching recent events:', recentError);
      return NextResponse.json({
        ok: false,
        healthy: false,
        last_event_mins: null,
        total_events_24h: 0,
        total_meta_24h: 0,
        message: `Database error: ${recentError.message}`
      }, { headers: corsHeaders() });
    }

    // Calculate last_event_mins (minutes since most recent event)
    const lastEventTime = recentEvents?.[0]?.occurred_at;
    const lastEventMins = lastEventTime
      ? Math.floor((Date.now() - new Date(lastEventTime).getTime()) / 60000)
      : null;

    // Count events in last 24 hours
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const events24hQuery = applyInternalPathExclusions(
      client
        .from('h2s_tracking_events')
        .select('*', { count: 'exact', head: true })
        .gte('occurred_at', twentyFourHoursAgo)
    );
    const { count: events24h, error: countError } = await events24hQuery;

    if (countError) {
      console.error('Error counting 24h events:', countError);
    }

    // Count Meta Pixel events in last 24 hours (events with certain event types)
    const meta24hQuery = applyInternalPathExclusions(
      client
        .from('h2s_tracking_events')
        .select('*', { count: 'exact', head: true })
        .gte('occurred_at', twentyFourHoursAgo)
        .in('event_type', ['page_view', 'view_content', 'lead', 'purchase', 'add_to_cart', 'initiate_checkout'])
    );
    const { count: meta24h, error: metaCountError } = await meta24hQuery;

    if (metaCountError) {
      console.error('Error counting Meta Pixel events:', metaCountError);
    }

    // Determine healthy (events in last 5 minutes)
    const healthy = lastEventMins !== null && lastEventMins <= 5;

    return NextResponse.json({
      ok: true,
      healthy,
      last_event_mins: lastEventMins,
      total_events_24h: events24h || 0,
      total_meta_24h: meta24h || 0,
      message: healthy 
        ? 'All systems operational' 
        : lastEventMins === null 
        ? 'No events recorded yet'
        : `Last event ${lastEventMins} minutes ago`
    }, { headers: corsHeaders() });

  } catch (error: any) {
    console.error('Track ping error:', error);
    return NextResponse.json({
      ok: false,
      healthy: false,
      last_event_mins: null,
      total_events_24h: 0,
      total_meta_24h: 0,
      message: `Error: ${error.message}`
    }, { status: 500, headers: corsHeaders() });
  }
}



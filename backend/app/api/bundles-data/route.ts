import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';

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
  try {
    const client = getSupabase();
    
    if (!client) {
      return NextResponse.json({
        ok: false,
        error: 'Database not available',
        bundles: []
      }, { status: 503, headers: corsHeaders() });
    }

    // Fetch bundles, services, and reviews from h2s tables
    const [bundlesRes, servicesRes, reviewsRes] = await Promise.all([
      client.from('h2s_bundles').select('*').eq('active', true).order('sort'),
      client.from('h2s_services').select('*').eq('active', true).order('sort'),
      client.from('h2s_reviews').select('*').eq('is_visible', true).order('created_at', { ascending: false }).limit(30)
    ]);

    // Format reviews with dual field names for frontend compatibility
    const formattedReviews = (reviewsRes.data || []).map((review: any) => ({
      rating: review.rating || 5,
      review_text: review.review_text || review.text || '',
      display_name: review.display_name || review.name || 'Customer',
      services_selected: review.services_selected || '',
      timestamp_iso: review.timestamp_iso || review.created_at || new Date().toISOString(),
      verified: review.verified || false,
      // Aliases for hero reviews
      text: review.review_text || review.text || '',
      name: review.display_name || review.name || 'Customer',
      stars: review.rating || 5
    }));

    return NextResponse.json({
      ok: true,
      bundles: bundlesRes.data || [],
      services: servicesRes.data || [],
      reviews: formattedReviews,
      bundleItems: [] // h2s doesn't use bundle_items - bundles are standalone
    }, { headers: corsHeaders() });

  } catch (error: any) {
    console.error('[Bundles Data API] Error:', error);
    return NextResponse.json({
      ok: false,
      error: 'Failed to fetch bundles data',
      details: error.message,
      bundles: []
    }, { status: 500, headers: corsHeaders() });
  }
}

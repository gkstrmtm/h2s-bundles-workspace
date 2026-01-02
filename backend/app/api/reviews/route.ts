import { NextResponse } from 'next/server';
import { getSupabase, getSupabaseMgmt } from '@/lib/supabase';

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders() });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = parseInt(searchParams.get('limit') || '30');
  const onlyVerified = searchParams.get('onlyVerified') === 'true';
  const offset = parseInt(searchParams.get('offset') || '0');

  try {
    const client = getSupabase();
    if (!client) {
      return NextResponse.json({ 
        ok: false, 
        error: 'Database not available',
        reviews: []
      }, { status: 503, headers: corsHeaders() });
    }

    // Query reviews from h2s_reviews table
    let query = client
      .from('h2s_reviews')
      .select('*')
      .eq('is_visible', true)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (onlyVerified) {
      query = query.eq('verified', true);
    }

    const { data: reviews, error } = await query;

    // If no reviews found and no real error, return empty array (graceful fallback)
    if (!reviews && !error) {
      return NextResponse.json({
        ok: true,
        reviews: [],
        message: 'No reviews available'
      }, { headers: corsHeaders() });
    }

    if (error) {
      console.error('[Reviews API] Error:', error);
      // Fallback: return empty array instead of error
      return NextResponse.json({
        ok: true,
        reviews: [],
        message: 'No reviews available'
      }, { headers: corsHeaders() });
    }

    // Transform reviews to match expected format
    // Frontend has TWO different patterns: hero reviews use text/name, carousel uses review_text/display_name
    const formattedReviews = (reviews || []).map((review: any) => ({
      // Core fields
      rating: review.rating || review.stars_tech || 5,
      review_text: review.review_text || review.comment_tech || review.text || '',
      display_name: review.display_name || review.name || 'Customer',
      services_selected: review.services_selected || review.service || '',
      timestamp_iso: review.timestamp_iso || review.created_at || new Date().toISOString(),
      verified: review.verified || false,
      // Aliases for hero reviews compatibility
      text: review.review_text || review.comment_tech || review.text || '',
      name: review.display_name || review.name || 'Customer',
      stars: review.rating || review.stars_tech || 5
    }));

    return NextResponse.json({
      ok: true,
      reviews: formattedReviews,
      count: formattedReviews.length
    }, { headers: corsHeaders() });

  } catch (error: any) {
    console.error('[Reviews API] Exception:', error);
    return NextResponse.json({
      ok: false,
      error: error.message || 'Failed to fetch reviews',
      reviews: []
    }, { status: 500, headers: corsHeaders() });
  }
}


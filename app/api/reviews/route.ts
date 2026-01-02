import { NextResponse } from 'next/server';
import { getSupabaseDb1, getSupabase } from '@/lib/supabase';

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
    const client = getSupabaseDb1() || getSupabase();
    if (!client) {
      return NextResponse.json({ 
        ok: false, 
        error: 'Database not available',
        reviews: []
      }, { status: 503, headers: corsHeaders() });
    }

    // Query reviews from Supabase - try multiple possible table names
    // Reviews might be in a customer_reviews, h2s_reviews, or reviews table
    let reviews = null;
    let error = null;

    // Try different table names
    const possibleTables = ['customer_reviews', 'h2s_reviews', 'reviews', 'reviews_table'];
    
    for (const tableName of possibleTables) {
      try {
        let query = client
          .from(tableName)
          .select('*')
          .order('created_at', { ascending: false })
          .range(offset, offset + limit - 1);

        if (onlyVerified) {
          query = query.eq('verified', true);
        }

        const result = await query;
        if (result.data && result.data.length > 0) {
          reviews = result.data;
          break;
        }
        if (result.error && !result.error.message.includes('relation') && !result.error.message.includes('does not exist')) {
          // Real error, not just missing table
          error = result.error;
        }
      } catch (e: any) {
        // Table doesn't exist or other error
        if (e.message && !e.message.includes('relation') && !e.message.includes('does not exist')) {
          error = e;
        }
        continue;
      }
    }

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
    const formattedReviews = (reviews || []).map((review: any) => ({
      rating: review.rating || review.stars_tech || 5,
      review_text: review.review_text || review.comment_tech || review.text || '',
      display_name: review.display_name || review.name || 'Customer',
      services_selected: review.services_selected || review.service || '',
      timestamp_iso: review.timestamp_iso || review.created_at || new Date().toISOString(),
      verified: review.verified || false
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


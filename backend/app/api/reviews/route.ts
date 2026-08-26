import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';

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
  const debug = searchParams.get('debug') === '1';

  try {
    const client = getSupabase();
    if (!client) {
      return NextResponse.json({ 
        ok: false, 
        error: 'Database not available',
        reviews: []
      }, { status: 503, headers: corsHeaders() });
    }

    // Public review surfaces must never return records explicitly hidden by moderation.
    let query = client
      .from('h2s_public_reviews')
      .select('*', { count: 'exact' })
      .or('is_visible.eq.true,is_visible.is.null')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (onlyVerified) {
      query = query.or('verified.eq.true,verified.is.null');
    }

    const { data: reviews, error, count } = await query;

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
      return NextResponse.json(
        {
          ok: false,
          error: error.message || 'Failed to fetch reviews',
          reviews: [],
        },
        { status: 500, headers: { ...corsHeaders(), 'Cache-Control': 'no-store' } },
      );
    }

    let meta: any = undefined;
    if (debug) {
      const supabaseUrl = String(process.env.SUPABASE_URL || '');
      let supabaseHost = '';
      try {
        supabaseHost = supabaseUrl ? new URL(supabaseUrl).host : '';
      } catch (_) {
        supabaseHost = '';
      }

      // Lightweight counts to quickly diagnose "wrong project" vs "filters hide rows".
      const baseCountQuery = () =>
        client
          .from('h2s_public_reviews')
          .select('id', { count: 'exact', head: true });

      const allCount = await baseCountQuery();
      const visibleCount = await baseCountQuery().or('is_visible.eq.true,is_visible.is.null');
      const visibleVerifiedCount = await baseCountQuery()
        .or('is_visible.eq.true,is_visible.is.null')
        .or('verified.eq.true,verified.is.null');

      meta = {
        table: 'h2s_public_reviews',
        supabaseHost,
        filters: {
          onlyVerified,
          offset,
          limit,
          effectiveVisibility: 'is_visible = true OR is_visible IS NULL',
          effectiveVerified: onlyVerified ? 'verified = true OR verified IS NULL' : 'not applied',
        },
        counts: {
          all: allCount.count ?? null,
          visible: visibleCount.count ?? null,
          visibleAndVerified: visibleVerifiedCount.count ?? null,
        },
        countErrors: {
          all: allCount.error?.message || null,
          visible: visibleCount.error?.message || null,
          visibleAndVerified: visibleVerifiedCount.error?.message || null,
        },
      };
    }

    // Transform reviews to match expected format
    // Frontend has TWO different patterns: hero reviews use text/name, carousel uses review_text/display_name
    const formattedReviews = (reviews || []).map((review: any) => ({
      // Core fields
      rating: review.rating || review.stars_tech || 5,
      review_text: review.review_text || review.comment_tech || review.text || '',
      display_name: review.display_name || review.name || 'Customer',
      services_selected: review.services_selected || review.service || '',
      location: review.location || review.city || review.customer_city || review.service_city || '',
      city: review.city || review.customer_city || review.service_city || review.location || '',
      timestamp_iso: review.timestamp_iso || review.created_at || new Date().toISOString(),
      verified: review.verified || false,

      // Photo fields (required for reviews.html gallery)
      photo_urls: review.photo_urls || review.photos || null,
      photo_url_1: review.photo_url_1 || review.Photo_URL_1 || null,
      photo_url_2: review.photo_url_2 || review.Photo_URL_2 || null,
      photo_url_3: review.photo_url_3 || review.Photo_URL_3 || null,

      // Additional aliases sometimes used across older embeds
      service: review.service || review.services_selected || '',
      services: review.services || review.services_selected || review.service || '',
      // Aliases for hero reviews compatibility
      text: review.review_text || review.comment_tech || review.text || '',
      name: review.display_name || review.name || 'Customer',
      stars: review.rating || review.stars_tech || 5
    }));

    return NextResponse.json(
      {
        ok: true,
        reviews: formattedReviews,
        count: typeof count === 'number' ? count : formattedReviews.length,
        ...(meta ? { meta } : {}),
      },
      {
        headers: {
          ...corsHeaders(),
          'Cache-Control': 'no-store',
        },
      },
    );

  } catch (error: any) {
    console.error('[Reviews API] Exception:', error);
    return NextResponse.json({
      ok: false,
      error: error.message || 'Failed to fetch reviews',
      reviews: []
    }, { status: 500, headers: corsHeaders() });
  }
}


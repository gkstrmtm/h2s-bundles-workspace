import { NextResponse } from 'next/server';

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
  const code = searchParams.get('code');

  if (!code) {
    return NextResponse.json({
      valid: false,
      error: 'Promo code required'
    }, { status: 400, headers: corsHeaders() });
  }

  try {
    // Initialize Stripe if configured
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    
    if (!stripeKey) {
      console.warn('[Promo Validate] Stripe not configured');
      return NextResponse.json({
        valid: false,
        error: 'Payment service not configured'
      }, { status: 503, headers: corsHeaders() });
    }

    // Dynamically import Stripe
    const { default: Stripe } = await import('stripe');
    const stripe = new Stripe(stripeKey, { apiVersion: '2024-06-20' as any });

    // Search for the coupon/promotion code
    const promotionCodes = await stripe.promotionCodes.list({
      code: code,
      limit: 1,
    });

    if (promotionCodes.data.length === 0) {
      return NextResponse.json({
        valid: false,
        error: 'Invalid promo code'
      }, { headers: corsHeaders() });
    }

    const promoCode: any = promotionCodes.data[0];
    
    // Fetch the full coupon details - handle both ID string and object
    // Note: Stripe API may return coupon in different locations depending on version
    let couponId: string | null = null;
    let coupon: any;
    
    // Check for coupon in promotion object (newer API)
    if (promoCode.promotion && promoCode.promotion.coupon) {
      couponId = typeof promoCode.promotion.coupon === 'string' 
        ? promoCode.promotion.coupon 
        : promoCode.promotion.coupon.id;
    }
    // Fallback to old structure
    else if (typeof promoCode.coupon === 'string') {
      couponId = promoCode.coupon;
    } else if (promoCode.coupon && promoCode.coupon.id) {
      couponId = promoCode.coupon.id;
    } else if (promoCode.coupon && typeof promoCode.coupon === 'object') {
      // Coupon already expanded
      coupon = promoCode.coupon;
    }
    
    if (!coupon && couponId) {
      coupon = await stripe.coupons.retrieve(couponId);
    }
    
    if (!coupon) {
      console.error('[Promo Validate] Could not resolve coupon from:', promoCode);
      return NextResponse.json({
        valid: false,
        error: 'Invalid promo code structure'
      }, { headers: corsHeaders() });
    }

    // Check if the promo code is active and not expired
    const now = Math.floor(Date.now() / 1000);
    const isActive = promoCode.active;
    const isNotExpired = !promoCode.expires_at || promoCode.expires_at > now;
    const isCouponValid = coupon.valid;

    if (!isActive || !isNotExpired || !isCouponValid) {
      return NextResponse.json({
        valid: false,
        error: 'Promo code expired or inactive'
      }, { headers: corsHeaders() });
    }

    // Calculate discount details
    const discountInfo: any = {
      ok: true,
      valid: true,
      code: promoCode.code || code,
      promo: {
        code: promoCode.code || code,
        coupon: {
          percent_off: coupon.percent_off || null,
          amount_off: coupon.amount_off || null,
          currency: coupon.currency || 'usd'
        }
      },
      type: coupon.percent_off ? 'percent' : 'amount',
      value: coupon.percent_off || (coupon.amount_off ? coupon.amount_off / 100 : 0),
      currency: coupon.currency || 'usd',
      duration: coupon.duration,
      durationInMonths: coupon.duration_in_months
    };

    // Add formatted display
    if (coupon.percent_off) {
      discountInfo.display = `${coupon.percent_off}% off`;
    } else if (coupon.amount_off) {
      discountInfo.display = `$${(coupon.amount_off / 100).toFixed(2)} off`;
    }

    return NextResponse.json(discountInfo, { headers: corsHeaders() });

  } catch (error: any) {
    console.error('[Promo Validate] Error:', error);
    return NextResponse.json({
      valid: false,
      error: 'Failed to validate promo code',
      details: error.message
    }, { status: 500, headers: corsHeaders() });
  }
}

import { NextResponse } from 'next/server';
import { KNOWN_PROMO_CODES } from '@/lib/promoCache';

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
    console.log('[Promo Validate] ========================================');
    console.log('[Promo Validate] Looking up code:', code);
    
    // FAST PATH: Check cache first to avoid Stripe API timeout issues
    const normalizedCode = code.toLowerCase();
    const cachedPromo = KNOWN_PROMO_CODES[normalizedCode];
    
    if (cachedPromo && cachedPromo.active) {
      console.log('[Promo Validate] Found in cache:', cachedPromo.code);
      
      const coupon = cachedPromo.coupon;
      const discountInfo: any = {
        ok: true,
        valid: true,
        code: cachedPromo.code,
        promo: {
          code: cachedPromo.code,
          coupon: {
            percent_off: coupon.percent_off,
            amount_off: coupon.amount_off,
            currency: coupon.currency || 'usd'
          }
        },
        type: coupon.percent_off ? 'percent' : 'amount',
        value: coupon.percent_off || (coupon.amount_off ? coupon.amount_off / 100 : 0),
        currency: coupon.currency || 'usd',
        duration: 'once',
        durationInMonths: null
      };
      
      if (coupon.percent_off) {
        discountInfo.display = `${coupon.percent_off}% off`;
      } else if (coupon.amount_off) {
        discountInfo.display = `$${(coupon.amount_off / 100).toFixed(2)} off`;
      }
      
      console.log('[Promo Validate] SUCCESS: Returning cached promo');
      console.log('[Promo Validate] ========================================');
      return NextResponse.json(discountInfo, { headers: corsHeaders() });
    }
    
    console.log('[Promo Validate] Not in cache, trying Stripe API...');
    
    // SLOW PATH: Try Stripe API (may timeout from Vercel)
    // Initialize Stripe with extended timeout and retries
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    
    if (!stripeKey) {
      console.error('[Promo Validate] STRIPE_SECRET_KEY not configured');
      return NextResponse.json({
        valid: false,
        error: 'Payment system not configured'
      }, { status: 500, headers: corsHeaders() });
    }

    const Stripe = require('stripe');
    const stripe = new Stripe(stripeKey, { 
      apiVersion: '2024-06-20',
      timeout: 25000, // 25 second timeout
      maxNetworkRetries: 3 // Retry 3 times on network errors
    });

    console.log('[Promo Validate] ========================================');
    console.log('[Promo Validate] Looking up code:', code);
    console.log('[Promo Validate] Calling Stripe API...');
    const startTime = Date.now();

    // Search for the coupon/promotion code
    const promotionCodes = await stripe.promotionCodes.list({
      code: code,
      limit: 1,
    });

    console.log('[Promo Validate] Stripe response time:', Date.now() - startTime, 'ms');
    console.log('[Promo Validate] Results found:', promotionCodes.data.length);

    if (promotionCodes.data.length === 0) {
      console.log('[Promo Validate] ERROR: Code not found in Stripe');
      return NextResponse.json({
        valid: false,
        error: 'Invalid promo code'
      }, { headers: corsHeaders() });
    }

    const promoCode: any = promotionCodes.data[0];
    
    console.log('[Promo Validate] Promo code object keys:', Object.keys(promoCode));
    console.log('[Promo Validate] Active:', promoCode.active);
    console.log('[Promo Validate] Times redeemed:', promoCode.times_redeemed);
    console.log('[Promo Validate] Restrictions:', JSON.stringify(promoCode.restrictions || {}));
    
    // Fetch the full coupon details - handle both ID string and object
    // Note: Stripe API may return coupon in different locations depending on version
    let couponId: string | null = null;
    let coupon: any;
    
    // Check for coupon in promotion object (newer API)
    if (promoCode.promotion && promoCode.promotion.coupon) {
      console.log('[Promo Validate] Found coupon in promotion object');
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

    console.log('[Promo Validate] SUCCESS: Returning valid promo code:', code);
    console.log('[Promo Validate] ========================================');
    return NextResponse.json(discountInfo, { headers: corsHeaders() });

  } catch (error: any) {
    console.error('[Promo Validate] ERROR: Stripe API Error occurred!');
    console.error('[Promo Validate] Error type:', error.type);
    console.error('[Promo Validate] Error message:', error.message);
    console.error('[Promo Validate] Error code:', error.code);
    console.error('[Promo Validate] Code attempted:', code);
    console.error('[Promo Validate] Full error:', JSON.stringify(error, null, 2));
    console.error('[Promo Validate] ========================================');
    
    // Return user-friendly error - don't expose internal errors
    return NextResponse.json({
      ok: false,
      valid: false,
      error: 'Invalid promo code',
      message: `"${code}" is not a valid promo code`
    }, { status: 200, headers: corsHeaders() }); // Return 200 with valid:false instead of 500
  }
}

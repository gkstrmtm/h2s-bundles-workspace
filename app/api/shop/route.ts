import { NextResponse } from 'next/server';
import { getSupabaseDb1, getSupabase } from '@/lib/supabase';
import OpenAI from 'openai';
import Stripe from 'stripe';

const openai = process.env.OPENAI_API_KEY 
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2025-12-15.clover' })
  : null;

function corsHeaders(request?: Request) {
  // Whitelist specific origins for security
  const allowedOrigins = [
    'https://home2smart.com',
    'https://www.home2smart.com',
    'http://localhost:3000',
    'http://localhost:3001'
  ];
  
  const origin = request?.headers.get('origin') || '';
  const allowOrigin = allowedOrigins.includes(origin) ? origin : allowedOrigins[0];
  
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
    'Access-Control-Allow-Credentials': 'true',
  };
}

export async function OPTIONS(request: Request) {
  return NextResponse.json({}, { headers: corsHeaders(request) });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  try {
    switch (action) {
      case 'catalog':
        // Return catalog structure expected by bundles.html
        // This should match the structure: { services, serviceOptions, priceTiers, bundles, bundleItems, recommendations, memberships, membershipPrices }
        const catalog: {
          services: any[];
          serviceOptions: any[];
          priceTiers: any[];
          bundles: any[];
          bundleItems: any[];
          recommendations: any[];
          memberships: any[];
          membershipPrices: any[];
        } = {
          services: [],
          serviceOptions: [],
          priceTiers: [],
          bundles: [],
          bundleItems: [],
          recommendations: [],
          memberships: [],
          membershipPrices: []
        };

        // Try to fetch from database if available
        const client = getSupabaseDb1() || getSupabase();
        if (client) {
          try {
            // Query catalog data from database (adjust table names as needed)
            const [servicesRes, bundlesRes, priceTiersRes] = await Promise.all([
              client.from('services').select('*').eq('active', true),
              client.from('bundles').select('*').eq('active', true),
              client.from('price_tiers').select('*')
            ]);

            catalog.services = servicesRes.data || [];
            catalog.bundles = bundlesRes.data || [];
            catalog.priceTiers = priceTiersRes.data || [];
          } catch (dbError) {
            console.warn('[Shop API] Database query failed, using empty catalog:', dbError);
          }
        }

        return NextResponse.json({
          ok: true,
          catalog
        }, { headers: corsHeaders(request) });

      case 'ai_sales':
        const email = searchParams.get('email');
        const mode = searchParams.get('mode') || 'recommendations';

        if (!email) {
          return NextResponse.json({
            success: false,
            error: 'Email parameter required'
          }, { status: 400, headers: corsHeaders(request) });
        }

        if (!openai) {
          return NextResponse.json({
            success: false,
            error: 'AI service not configured'
          }, { status: 503, headers: corsHeaders(request) });
        }

        // Get user's purchase history and preferences
        const trackingClient = getSupabaseDb1() || getSupabase();
        let userHistory: any[] = [];
        
        if (trackingClient) {
          try {
            const { data: events } = await trackingClient
              .from('h2s_tracking_events')
              .select('event_type, page_path, metadata, event_ts')
              .eq('customer_email', email)
              .order('event_ts', { ascending: false })
              .limit(50);

            userHistory = events || [];
          } catch (err) {
            console.warn('[Shop API] Failed to fetch user history:', err);
          }
        }

        // Generate AI recommendations
        const prompt = `You are a smart home services sales assistant. Based on the user's browsing history and preferences, provide personalized product recommendations.

User Email: ${email}
Browsing History: ${JSON.stringify(userHistory.slice(0, 10))}

Provide 3-5 product recommendations in JSON format:
{
  "recommendations": [
    {
      "bundle_id": "string",
      "title": "Product name",
      "description": "Why this is recommended",
      "match_score": 0.85
    }
  ],
  "reasoning": "Brief explanation of recommendations"
}`;

        const completion = await openai.chat.completions.create({
          model: 'gpt-4o',
          messages: [
            {
              role: 'system',
              content: 'You are a smart home services sales assistant. Always return valid JSON only.'
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          temperature: 0.7,
          max_tokens: 500,
          response_format: { type: 'json_object' }
        });

        const aiResponse = JSON.parse(completion.choices[0].message.content || '{}');

        return NextResponse.json({
          success: true,
          ai_analysis: {
            recommendations: aiResponse.recommendations || [],
            reasoning: aiResponse.reasoning || ''
          }
        }, { headers: corsHeaders(request) });

      default:
        return NextResponse.json({
          ok: false,
          error: 'Invalid action. Supported: catalog, ai_sales'
        }, { status: 400, headers: corsHeaders(request) });
    }

  } catch (error: any) {
    console.error('[Shop API] GET Error:', error);
    return NextResponse.json({
      ok: false,
      success: false,
      error: error.message || 'Internal server error'
    }, { status: 500, headers: corsHeaders(request) });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { __action, customer, cart, promotion_code, success_url, cancel_url, metadata, line_items, discounts } = body;

    if (__action === 'create_checkout_session') {
      // Validate Stripe is configured
      if (!stripe) {
        return NextResponse.json({
          ok: false,
          error: 'Payment processing not configured'
        }, { status: 503, headers: corsHeaders(request) });
      }

      // Validate required fields
      if (!customer?.email) {
        return NextResponse.json({
          ok: false,
          error: 'Customer email is required'
        }, { status: 400, headers: corsHeaders(request) });
      }

      if (!Array.isArray(cart) || cart.length === 0) {
        return NextResponse.json({
          ok: false,
          error: 'Cart is empty'
        }, { status: 400, headers: corsHeaders(request) });
      }

      // Use line_items from body if provided (with stripe_price_id), otherwise transform cart
      const stripeLineItems = Array.isArray(line_items) && line_items.length > 0
        ? line_items
        : cart.map(item => {
            const productData: any = {
              name: item.name || item.service_name || 'Service',
              metadata: item.metadata || {}
            };
            
            // Only add description if it's not empty
            if (item.description && item.description.trim()) {
              productData.description = item.description;
            }
            
            return {
              price_data: {
                currency: 'usd',
                product_data: productData,
                unit_amount: Math.round((item.price || 0) * 100) // Convert to cents
              },
              quantity: item.qty || 1
            };
          });

      // Create Stripe checkout session
      const sessionParams: Stripe.Checkout.SessionCreateParams = {
        payment_method_types: ['card'],
        line_items: stripeLineItems,
        mode: 'payment',
        success_url: success_url || 'https://home2smart.com/bundles?view=shopsuccess&session_id={CHECKOUT_SESSION_ID}',
        cancel_url: cancel_url || 'https://home2smart.com/bundles',
        customer_email: customer.email,
        billing_address_collection: 'required',
        shipping_address_collection: {
          allowed_countries: ['US']
        },
        metadata: {
          customer_name: customer.name || '',
          customer_phone: customer.phone || '',
          customer_email: customer.email || '',
          source: metadata?.source || 'shop_rebuilt',
          ...metadata
        }
      };

      // Add promotion code if provided (handle both discounts array and promotion_code string)
      const promoCodeValue = (Array.isArray(discounts) && discounts.length > 0 && discounts[0].promotion_code)
        ? discounts[0].promotion_code
        : promotion_code;

      if (promoCodeValue) {
        try {
          // Search for the promotion code in Stripe
          const promoCodes = await stripe.promotionCodes.list({
            code: promoCodeValue,
            limit: 1,
            active: true
          });

          if (promoCodes.data && promoCodes.data.length > 0) {
            const promoCodeId = promoCodes.data[0].id;
            console.log('[Checkout] Found promo code ID:', promoCodeId, 'for code:', promoCodeValue);
            // Stripe needs the promo code ID, not the code string
            sessionParams.discounts = [{
              promotion_code: promoCodeId
            }];
          } else {
            console.warn('[Checkout] Promo code not found:', promoCodeValue);
            return NextResponse.json({
              ok: false,
              error: `No such promotion code: '${promoCodeValue}'`
            }, { status: 400, headers: corsHeaders(request) });
          }
        } catch (promoError: any) {
          console.error('[Checkout] Error looking up promo code:', promoError);
          return NextResponse.json({
            ok: false,
            error: `Promotion code error: ${promoError.message}`
          }, { status: 400, headers: corsHeaders(request) });
        }
      }

      const session = await stripe.checkout.sessions.create(sessionParams);

      // Create order in database immediately for schedule-appointment lookup
      const client = getSupabaseDb1() || getSupabase();
      if (client) {
        try {
          const orderId = `ORD-${crypto.randomUUID().substring(0, 8).toUpperCase()}`;
          
          // Calculate totals from cart
          let subtotal = 0;
          const items = cart.map((item: any) => {
            const qty = item.qty || 1;
            const unitPrice = item.price || 0;
            const lineTotal = unitPrice * qty;
            subtotal += lineTotal;
            return {
              name: item.name || item.service_name || 'Service',
              unit_price: unitPrice,
              quantity: qty,
              line_total: lineTotal,
              metadata: item.metadata || {}
            };
          });
          
          // Insert order
          await client.from('h2s_orders').insert({
            order_id: orderId,
            session_id: session.id,
            customer_email: customer.email,
            customer_name: customer.name || '',
            customer_phone: customer.phone || '',
            items: items,
            subtotal: subtotal,
            total: subtotal, // Will be updated by webhook after payment
            currency: 'usd',
            status: 'pending',
            metadata_json: metadata || {},
            created_at: new Date().toISOString(),
            address: metadata?.service_address || '',
            city: metadata?.service_city || '',
            state: metadata?.service_state || '',
            zip: metadata?.service_zip || ''
          });
          
          console.log('[Checkout] Order created:', orderId, 'for session:', session.id);
        } catch (dbError) {
          console.error('[Checkout] Failed to create order:', dbError);
          // Don't fail checkout if order creation fails
        }
      }

      return NextResponse.json({
        ok: true,
        pay: {
          session_url: session.url,
          session_id: session.id
        }
      }, { status: 200, headers: corsHeaders(request) });
    }

    if (__action === 'promo_check_cart') {
      // Check if promo code applies to cart items
      const { promotion_code: promoCode, line_items: items } = body;

      if (!stripe) {
        return NextResponse.json({
          ok: false,
          error: 'Stripe not configured'
        }, { status: 503, headers: corsHeaders(request) });
      }

      if (!promoCode) {
        return NextResponse.json({
          ok: false,
          applicable: false,
          error: 'No promotion code provided'
        }, { status: 400, headers: corsHeaders(request) });
      }

      if (!Array.isArray(items) || items.length === 0) {
        return NextResponse.json({
          ok: false,
          applicable: false,
          error: 'No items in cart'
        }, { status: 400, headers: corsHeaders(request) });
      }

      try {
        console.log('[Promo Check] Searching for code:', promoCode);
        
        // Search for the promotion code in Stripe  
        const promoCodes = await stripe.promotionCodes.list({
          code: promoCode,
          limit: 1,
          active: true
        });

        console.log('[Promo Check] Search results:', promoCodes.data.length, 'codes found');

        if (!promoCodes.data || promoCodes.data.length === 0) {
          return NextResponse.json({
            ok: true,
            applicable: false,
            error: 'Promotion code not found or inactive'
          }, { headers: corsHeaders(request) });
        }

        const promoCodeId = promoCodes.data[0].id;
        console.log('[Promo Check] Found promo code ID:', promoCodeId);
        
        // Retrieve the full promotion code with expanded coupon
        const fullPromoCode: any = await stripe.promotionCodes.retrieve(promoCodeId, {
          expand: ['coupon']
        });
        
        console.log('[Promo Check] Full PromoCode retrieved');
        
        const coupon: any = fullPromoCode.coupon;
        
        if (!coupon) {
          console.log('[Promo Check] ERROR: Coupon not found on promo code');
          return NextResponse.json({
            ok: false,
            applicable: false,
            error: 'Unable to retrieve coupon details'
          }, { status: 500, headers: corsHeaders(request) });
        }

        console.log('[Promo Check] Coupon found:', coupon.id, coupon.percent_off ? `${coupon.percent_off}%` : `$${coupon.amount_off/100}`);

        // Calculate subtotal
        let subtotalCents = 0;
        for (const item of items) {
          const unitAmount = item.unit_amount || 0;
          const quantity = item.quantity || 1;
          subtotalCents += unitAmount * quantity;
        }

        // Calculate discount
        let savingsCents = 0;
        if (coupon.percent_off) {
          savingsCents = Math.round(subtotalCents * (coupon.percent_off / 100));
        } else if (coupon.amount_off) {
          savingsCents = coupon.amount_off;
        }

        // Ensure discount doesn't exceed subtotal
        savingsCents = Math.min(savingsCents, subtotalCents);

        const totalCents = subtotalCents - savingsCents;

        return NextResponse.json({
          ok: true,
          applicable: true,
          promotion_code: fullPromoCode.code,
          estimate: {
            subtotal_cents: subtotalCents,
            savings_cents: savingsCents,
            total_cents: totalCents,
            currency: coupon.currency || 'usd'
          }
        }, { headers: corsHeaders(request) });

      } catch (stripeError: any) {
        console.error('[Promo Check] Stripe error:', stripeError);
        return NextResponse.json({
          ok: false,
          applicable: false,
          error: stripeError.message || 'Failed to validate promotion code'
        }, { status: 500, headers: corsHeaders(request) });
      }
    }

    return NextResponse.json({
      ok: false,
      error: 'Unknown action'
    }, { status: 400, headers: corsHeaders(request) });

  } catch (error: any) {
    console.error('[Shop API] POST Error:', error);
    return NextResponse.json({
      ok: false,
      error: error.message || 'Internal server error'
    }, { status: 500, headers: corsHeaders(request) });
  }
}


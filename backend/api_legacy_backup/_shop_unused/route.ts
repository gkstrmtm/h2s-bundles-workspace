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
  const allowedOrigins = [
    'https://home2smart.com',
    'https://www.home2smart.com',
    'https://shop.home2smart.com',
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
      case 'orderpack': {
        // Fetch order details from Stripe session for success page
        const session_id = searchParams.get('session_id');
        
        if (!session_id) {
          return NextResponse.json({
            ok: false,
            error: 'session_id required'
          }, { status: 400, headers: corsHeaders(request) });
        }

        if (!stripe) {
          return NextResponse.json({
            ok: false,
            error: 'Stripe not configured'
          }, { status: 503, headers: corsHeaders(request) });
        }

        try {
          // Retrieve checkout session from Stripe
          const session = await stripe.checkout.sessions.retrieve(session_id, {
            expand: ['line_items', 'customer', 'payment_intent']
          });

          // Extract order details
          const lineItems = session.line_items?.data || [];
          const lines = lineItems.map((item: any) => ({
            qty: item.quantity || 1,
            name: item.description || item.price?.product?.name || 'Item',
            service_name: item.description,
            bundle_id: item.price?.product?.metadata?.bundle_id || null,
            service_id: item.price?.product?.metadata?.service_id || null,
            line_type: item.price?.product?.metadata?.bundle_id ? 'bundle' : 'service'
          }));

          const summary = {
            order_id: session.metadata?.order_id || session.id,
            total: (session.amount_total || 0) / 100,
            tax: (session.total_details?.amount_tax || 0) / 100,
            currency: (session.currency || 'USD').toUpperCase(),
            discount_code: session.metadata?.promotion_code || null,
            status: session.payment_status
          };

          const customer = session.customer_details ? {
            name: session.customer_details.name,
            email: session.customer_details.email,
            phone: session.customer_details.phone
          } : null;

          return NextResponse.json({
            ok: true,
            summary,
            lines,
            customer
          }, { headers: corsHeaders(request) });

        } catch (stripeError: any) {
          console.error('[Shop API] Stripe error fetching session:', stripeError);
          return NextResponse.json({
            ok: false,
            error: 'Failed to fetch order details: ' + stripeError.message
          }, { status: 500, headers: corsHeaders(request) });
        }
      }

      case 'catalog':
        // Return catalog structure expected by bundles.html
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
Browsing History:
${JSON.stringify(userHistory.slice(0, 10))}

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

      const toStripeMetaValue = (v: any): string | undefined => {
        if (v === null || v === undefined) return undefined;
        if (typeof v === 'string') return v.length > 450 ? v.slice(0, 450) : v;
        if (typeof v === 'number' || typeof v === 'boolean') return String(v);
        return undefined;
      };

      const buildStripeSessionMetadata = (): Record<string, string> => {
        const out: Record<string, string> = {};
        const set = (k: string, v: any) => {
          const sv = toStripeMetaValue(v);
          if (sv !== undefined && sv !== '') out[k] = sv;
        };

        set('customer_name', customer?.name || '');
        set('customer_phone', customer?.phone || '');
        set('customer_email', customer?.email || '');
        set('source', metadata?.source || 'shop_rebuilt');

        set('service_address', metadata?.service_address);
        set('service_city', metadata?.service_city);
        set('service_state', metadata?.service_state);
        set('service_zip', metadata?.service_zip);

        // Offer fields (optional)
        set('offer_code', (metadata as any)?.offer_code);
        set('offer_amount_off_usd', (metadata as any)?.offer_amount_off_usd);
        set('tv_mount_qty', (metadata as any)?.tv_mount_qty);
        set('free_roku', (metadata as any)?.free_roku);
        set('free_roku_qty', (metadata as any)?.free_roku_qty);

        return out;
      };

      // Use line_items from body if provided, otherwise transform cart
      const stripeLineItems = Array.isArray(line_items) && line_items.length > 0
        ? line_items
        : cart.map(item => {
            const productData: any = {
              name: item.name || item.service_name || 'Service'
            };
            
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
          ...buildStripeSessionMetadata()
        }
      };

      // Add promotion code if provided
      const promoCodeValue = (Array.isArray(discounts) && discounts.length > 0 && discounts[0].promotion_code)
        ? discounts[0].promotion_code
        : promotion_code;

      if (promoCodeValue) {
        try {
          const promoCodes = await stripe.promotionCodes.list({
            code: promoCodeValue,
            limit: 1,
            active: true
          });

          if (promoCodes.data && promoCodes.data.length > 0) {
            const promoCodeId = promoCodes.data[0].id;
            console.log('[Checkout] Found promo code ID:', promoCodeId, 'for code:', promoCodeValue);
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

      // Create order in database
      const client = getSupabaseDb1() || getSupabase();
      if (client) {
        try {
          const orderId = `ORD-${crypto.randomUUID().substring(0, 8).toUpperCase()}`;

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

          await client.from('h2s_orders').insert({
            order_id: orderId,
            session_id: session.id,
            customer_email: customer.email,
            customer_name: customer.name || '',
            customer_phone: customer.phone || '',
            items: items,
            subtotal: subtotal,
            total: subtotal,
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
        const promoCodes = await stripe.promotionCodes.list({
          code: promoCode,
          limit: 1,
          active: true
        });

        if (!promoCodes.data || promoCodes.data.length === 0) {
          return NextResponse.json({
            ok: true,
            applicable: false,
            error: 'Promotion code not found or inactive'
          }, { headers: corsHeaders(request) });
        }

        const promoCodeId = promoCodes.data[0].id;
        const fullPromoCode: any = await stripe.promotionCodes.retrieve(promoCodeId, {
          expand: ['coupon']
        });

        const coupon: any = fullPromoCode.coupon;

        if (!coupon) {
          return NextResponse.json({
            ok: false,
            applicable: false,
            error: 'Unable to retrieve coupon details'
          }, { status: 500, headers: corsHeaders(request) });
        }

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

    // USER MANAGEMENT ACTIONS
    if (__action === 'signin') {
      const { email, password } = body;

      if (!email || !password) {
        return NextResponse.json({
          ok: false,
          error: 'Email and password required'
        }, { status: 400, headers: corsHeaders(request) });
      }

      const client = getSupabaseDb1() || getSupabase();
      if (!client) {
        return NextResponse.json({
          ok: false,
          error: 'Database not configured'
        }, { status: 503, headers: corsHeaders(request) });
      }

      try {
        const { data, error } = await client.auth.signInWithPassword({
          email,
          password
        });

        if (error) throw error;

        // Get user profile
        const { data: profile } = await client
          .from('h2s_users')
          .select('*')
          .eq('email', email)
          .single();

        return NextResponse.json({
          ok: true,
          user: profile || { email }
        }, { headers: corsHeaders(request) });

      } catch (error: any) {
        return NextResponse.json({
          ok: false,
          error: error.message || 'Invalid credentials'
        }, { status: 401, headers: corsHeaders(request) });
      }
    }

    if (__action === 'create_user') {
      const { user: userData } = body;

      if (!userData?.email || !userData?.password) {
        return NextResponse.json({
          ok: false,
          error: 'Email and password required'
        }, { status: 400, headers: corsHeaders(request) });
      }

      const client = getSupabaseDb1() || getSupabase();
      if (!client) {
        return NextResponse.json({
          ok: false,
          error: 'Database not configured'
        }, { status: 503, headers: corsHeaders(request) });
      }

      try {
        // Create auth user
        const { data: authData, error: authError } = await client.auth.signUp({
          email: userData.email,
          password: userData.password
        });

        if (authError) throw authError;

        // Create/update profile
        const referralCode = `H2S${crypto.randomUUID().substring(0, 6).toUpperCase()}`;
        
        const { data: profile, error: profileError } = await client
          .from('h2s_users')
          .upsert({
            email: userData.email,
            name: userData.name || '',
            phone: userData.phone || '',
            referral_code: referralCode,
            credits: 0,
            total_spent: 0,
            created_at: new Date().toISOString()
          })
          .select()
          .single();

        if (profileError) console.error('[Create User] Profile error:', profileError);

        return NextResponse.json({
          ok: true,
          user: profile || { email: userData.email, referral_code: referralCode }
        }, { headers: corsHeaders(request) });

      } catch (error: any) {
        return NextResponse.json({
          ok: false,
          error: error.message || 'Failed to create account'
        }, { status: 400, headers: corsHeaders(request) });
      }
    }

    if (__action === 'upsert_user') {
      const { user: userData } = body;

      if (!userData?.email) {
        return NextResponse.json({
          ok: false,
          error: 'Email required'
        }, { status: 400, headers: corsHeaders(request) });
      }

      const client = getSupabaseDb1() || getSupabase();
      if (!client) {
        return NextResponse.json({
          ok: false,
          error: 'Database not configured'
        }, { status: 503, headers: corsHeaders(request) });
      }

      try {
        const { data, error } = await client
          .from('h2s_users')
          .upsert({
            email: userData.email,
            name: userData.name || '',
            phone: userData.phone || '',
            updated_at: new Date().toISOString()
          })
          .select()
          .single();

        if (error) throw error;

        return NextResponse.json({
          ok: true,
          user: data
        }, { headers: corsHeaders(request) });

      } catch (error: any) {
        return NextResponse.json({
          ok: false,
          error: error.message || 'Failed to update profile'
        }, { status: 400, headers: corsHeaders(request) });
      }
    }

    if (__action === 'change_password') {
      const { email, old_password, new_password } = body;

      if (!email || !old_password || !new_password) {
        return NextResponse.json({
          ok: false,
          error: 'Email, old password, and new password required'
        }, { status: 400, headers: corsHeaders(request) });
      }

      const client = getSupabaseDb1() || getSupabase();
      if (!client) {
        return NextResponse.json({
          ok: false,
          error: 'Database not configured'
        }, { status: 503, headers: corsHeaders(request) });
      }

      try {
        // Verify old password
        const { error: signInError } = await client.auth.signInWithPassword({
          email,
          password: old_password
        });

        if (signInError) throw new Error('Current password is incorrect');

        // Update to new password
        const { error: updateError } = await client.auth.updateUser({
          password: new_password
        });

        if (updateError) throw updateError;

        return NextResponse.json({
          ok: true
        }, { headers: corsHeaders(request) });

      } catch (error: any) {
        return NextResponse.json({
          ok: false,
          error: error.message || 'Failed to change password'
        }, { status: 400, headers: corsHeaders(request) });
      }
    }

    if (__action === 'request_password_reset') {
      const { email } = body;

      if (!email) {
        return NextResponse.json({
          ok: false,
          error: 'Email required'
        }, { status: 400, headers: corsHeaders(request) });
      }

      const client = getSupabaseDb1() || getSupabase();
      if (!client) {
        return NextResponse.json({
          ok: false,
          error: 'Database not configured'
        }, { status: 503, headers: corsHeaders(request) });
      }

      try {
        const { error } = await client.auth.resetPasswordForEmail(email, {
          redirectTo: 'https://shop.home2smart.com/bundles?view=reset'
        });

        if (error) throw error;

        return NextResponse.json({
          ok: true
        }, { headers: corsHeaders(request) });

      } catch (error: any) {
        // Don't reveal if email exists
        return NextResponse.json({
          ok: true
        }, { headers: corsHeaders(request) });
      }
    }

    if (__action === 'reset_password') {
      const { token, new_password } = body;

      if (!token || !new_password) {
        return NextResponse.json({
          ok: false,
          error: 'Token and new password required'
        }, { status: 400, headers: corsHeaders(request) });
      }

      const client = getSupabaseDb1() || getSupabase();
      if (!client) {
        return NextResponse.json({
          ok: false,
          error: 'Database not configured'
        }, { status: 503, headers: corsHeaders(request) });
      }

      try {
        const { error } = await client.auth.updateUser({
          password: new_password
        });

        if (error) throw error;

        return NextResponse.json({
          ok: true
        }, { headers: corsHeaders(request) });

      } catch (error: any) {
        return NextResponse.json({
          ok: false,
          error: error.message || 'Failed to reset password'
        }, { status: 400, headers: corsHeaders(request) });
      }
    }

    return NextResponse.json({
      ok: false,
      error: 'Invalid or missing __action'
    }, { status: 400, headers: corsHeaders(request) });

  } catch (error: any) {
    console.error('[Shop API] POST Error:', error);
    return NextResponse.json({
      ok: false,
      error: error.message || 'Internal server error'
    }, { status: 500, headers: corsHeaders(request) });
  }
}

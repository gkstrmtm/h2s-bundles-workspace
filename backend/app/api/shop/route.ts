import { NextResponse } from 'next/server';
import { getSupabaseDb1, getSupabase, getSupabaseDispatch } from '@/lib/supabase';
import { resolveDispatchRequiredIds } from '@/lib/dispatchRequiredIds';
import { filterDispatchJobPayload } from '@/lib/dispatchJobGuardrails';
import { KNOWN_PROMO_CODES } from '@/lib/promoCache';
import { generateJobDetailsSummary, generateEquipmentProvided, getScheduleStatus } from '@/lib/dataCompleteness';
import OpenAI from 'openai';
import Stripe from 'stripe';
import crypto from 'crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const openai = process.env.OPENAI_API_KEY 
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY, { 
      apiVersion: '2024-06-20' as any,
      timeout: 25000, // 25 second timeout
      maxNetworkRetries: 3 // Retry 3 times on network errors
    })
  : null;

// Password hashing utilities - supports BOTH old (pbkdf2) and new (SHA256) formats
function hashPassword(password: string): { hash: string; salt: string } {
  const salt = crypto.randomUUID();
  const hash = crypto.createHash('sha256').update(password + salt).digest('hex');
  return { hash, salt };
}

function verifyPassword(password: string, storedHash: string, storedSalt?: string): boolean {
  if (!storedHash) return false;
  
  // NEW FORMAT: SHA256 with separate salt (e.g., "abc123..." + "550e8400-e29b-41d4-a716-446655440000")
  if (storedSalt) {
    try {
      const testHash = crypto.createHash('sha256').update(password + storedSalt).digest('hex');
      return crypto.timingSafeEqual(Buffer.from(testHash, 'hex'), Buffer.from(storedHash, 'hex'));
    } catch {
      return false;
    }
  }
  
  // OLD FORMAT: pbkdf2 combined format (e.g., "pbkdf2$120000$salt$hash")
  try {
    const parts = storedHash.split('$');
    if (parts[0] === 'pbkdf2' && parts.length === 4) {
      const [, iterStr, salt, hash] = parts;
      const iterations = Number(iterStr);
      const testHash = crypto.pbkdf2Sync(password, salt, iterations, 32, 'sha256').toString('hex');
      return crypto.timingSafeEqual(Buffer.from(testHash, 'hex'), Buffer.from(hash, 'hex'));
    }
  } catch {
    return false;
  }
  
  return false;
}

function corsHeaders(request?: Request) {
  // Whitelist specific origins for security
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

// ✅ BUILD CANONICAL JOB DETAILS PAYLOAD
function buildJobDetailsPayload(cart: any[], customer: any, metadata: any): any {
  // Parse cart items to build explicit service breakdown
  const services: any[] = [];
  const bonuses: any[] = [];
  let totalItems = 0;
  
  for (const item of cart) {
    totalItems += item.qty || 1;
    const itemName = item.name || item.title || 'Unknown Service';
    const itemId = item.id || '';
    
    // Detect service type
    let serviceCategory = 'general';
    let scopeDetails: any = {};
    
    if (itemName.toLowerCase().includes('tv') || itemName.toLowerCase().includes('mount')) {
      serviceCategory = 'tv_mount';
      scopeDetails = {
        tv_count: item.qty || 1,
        mount_type: item.mount_type || 'Standard Wall Mount',
        above_fireplace: item.above_fireplace || false,
        soundbar: item.soundbar || false,
        wall_type: item.wall_type || 'Drywall',
      };
    } else if (itemName.toLowerCase().includes('camera') || itemName.toLowerCase().includes('security')) {
      serviceCategory = 'cameras';
      scopeDetails = {
        camera_count: item.qty || 1,
        locations: item.locations || ['Front Door'],
        power_type: item.power_type || 'Existing Outlet',
        front_door_only: itemName.toLowerCase().includes('front door only'),
      };
    } else if (itemName.toLowerCase().includes('smart home') || itemName.toLowerCase().includes('bundle')) {
      serviceCategory = 'smart_home_bundle';
      scopeDetails = {
        bundle_type: itemName,
        includes: item.includes || [],
      };
    }
    
    services.push({
      service_id: itemId,
      service_name: itemName,
      service_category: serviceCategory,
      qty: item.qty || 1,
      price: item.price || 0,
      scope: scopeDetails,
    });
    
    // Check for promotional bonuses (like Free Roku)
    if (item.bonus || item.promotional) {
      bonuses.push({
        bonus_type: item.bonus_type || 'Promotional Gift',
        bonus_name: item.bonus_name || 'Free Roku Streaming Device',
        qty: item.qty || 1,
        fulfillment: 'Company provides separately',
        note: 'One per TV - will be mailed to customer',
      });
    }
  }
  
  // Build job summary
  let jobSummary = '';
  if (services.length === 1) {
    const svc = services[0];
    jobSummary = `${svc.qty > 1 ? svc.qty + 'x ' : ''}${svc.service_name}`;
  } else {
    jobSummary = `${totalItems} Services: ${services.map(s => s.service_name).join(', ')}`;
  }
  
  // Build technician tasks
  const technicianTasks: string[] = [];
  for (const svc of services) {
    if (svc.service_category === 'tv_mount') {
      technicianTasks.push(`Mount ${svc.qty} TV${svc.qty > 1 ? 's' : ''} to ${svc.scope.wall_type || 'wall'}`);
      if (svc.scope.soundbar) technicianTasks.push('Install soundbar');
      if (svc.scope.above_fireplace) technicianTasks.push('Above-fireplace installation (special care required)');
    } else if (svc.service_category === 'cameras') {
      technicianTasks.push(`Install ${svc.qty} security camera${svc.qty > 1 ? 's' : ''}`);
      technicianTasks.push(`Locations: ${(svc.scope.locations || []).join(', ')}`);
    } else {
      technicianTasks.push(`Complete ${svc.service_name}`);
    }
  }
  
  return {
    job_title: jobSummary,
    job_summary: `Installation service for ${jobSummary.toLowerCase()}`,
    service_category: services[0]?.service_category || 'general',
    services: services,
    bonuses: bonuses,
    total_items: totalItems,
    customer_provides: ['Wi-Fi network name and password', 'Access to installation areas'],
    included_items: ['All mounting hardware', 'Professional installation', 'Testing and setup'],
    technician_tasks: technicianTasks,
    customer_notes: metadata?.customer_notes || metadata?.notes || '',
    customer_photos: [],
    created_at: new Date().toISOString(),
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
      case 'orderpack':
        // Retrieve Stripe session data for success page
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
          const session = await stripe.checkout.sessions.retrieve(session_id, {
            expand: ['line_items', 'total_details']
          });

          // Build order summary
          const summary = {
            order_id: session.id,
            total: session.amount_total ? session.amount_total / 100 : 0,
            tax: session.total_details?.amount_tax ? session.total_details.amount_tax / 100 : 0,
            currency: session.currency?.toUpperCase() || 'USD',
            discount_code: (session.total_details?.amount_discount && session.total_details.amount_discount > 0) ? (session.metadata?.promotion_code || '') : null,
            customer_email: session.customer_email || session.customer_details?.email
          };

          // Build line items
          const lines: any[] = [];
          if (session.line_items && session.line_items.data) {
            session.line_items.data.forEach((item: any) => {
              lines.push({
                service_name: item.description,
                qty: item.quantity,
                line_total: item.amount_total ? item.amount_total / 100 : 0
              });
            });
          }

          return NextResponse.json({
            ok: true,
            summary,
            lines,
            customer: {
              email: session.customer_email || session.customer_details?.email,
              name: session.customer_details?.name
            }
          }, { headers: corsHeaders(request) });

        } catch (stripeError: any) {
          console.error('[Shop API] Stripe session retrieval failed:', stripeError);
          return NextResponse.json({
            ok: false,
            error: 'Failed to retrieve session: ' + stripeError.message
          }, { status: 500, headers: corsHeaders(request) });
        }

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

      case 'orders':
        // Fetch orders for a specific customer email
        const orderEmail = searchParams.get('email');
        
        if (!orderEmail) {
          return NextResponse.json({
            ok: false,
            error: 'Email parameter required'
          }, { status: 400, headers: corsHeaders(request) });
        }

        const ordersClient = getSupabaseDb1() || getSupabase();
        if (!ordersClient) {
          return NextResponse.json({
            ok: false,
            error: 'Database unavailable'
          }, { status: 503, headers: corsHeaders(request) });
        }

        try {
          const { data: orders, error: ordersError } = await ordersClient
            .from('h2s_orders')
            .select('*')
            .eq('customer_email', orderEmail.trim().toLowerCase())
            .order('created_at', { ascending: false });

          if (ordersError) {
            console.error('[Shop API] Orders query error:', ordersError);
            return NextResponse.json({
              ok: false,
              error: 'Failed to fetch orders'
            }, { status: 500, headers: corsHeaders(request) });
          }

          return NextResponse.json({
            ok: true,
            orders: orders || []
          }, { headers: corsHeaders(request) });

        } catch (dbError: any) {
          console.error('[Shop API] Orders fetch error:', dbError);
          return NextResponse.json({
            ok: false,
            error: dbError.message || 'Failed to retrieve orders'
          }, { status: 500, headers: corsHeaders(request) });
        }

      case 'backfill_accounts':
        // Batch function: Create user accounts for any orders without corresponding users
        const backfillClient = getSupabaseDb1() || getSupabase();
        if (!backfillClient) {
          return NextResponse.json({
            ok: false,
            error: 'Database unavailable'
          }, { status: 503, headers: corsHeaders(request) });
        }

        try {
          // Get all unique customer emails from orders
          const { data: orders, error: ordersErr } = await backfillClient
            .from('h2s_orders')
            .select('customer_email, customer_name, customer_phone')
            .not('customer_email', 'is', null)
            .order('created_at', { ascending: false });

          if (ordersErr) {
            return NextResponse.json({
              ok: false,
              error: 'Failed to query orders: ' + ordersErr.message
            }, { status: 500, headers: corsHeaders(request) });
          }

          // Get unique emails
          const uniqueCustomers = new Map<string, { name: string; phone: string }>();
          orders?.forEach(order => {
            const email = order.customer_email?.trim().toLowerCase();
            if (email && !uniqueCustomers.has(email)) {
              uniqueCustomers.set(email, {
                name: order.customer_name || '',
                phone: order.customer_phone || ''
              });
            }
          });

          // Check which emails already have accounts
          const { data: existingUsers } = await backfillClient
            .from('h2s_users')
            .select('email');

          const existingEmails = new Set(existingUsers?.map(u => u.email.toLowerCase()) || []);

          // Create accounts for missing users
          const newAccounts: any[] = [];
          uniqueCustomers.forEach((info, email) => {
            if (!existingEmails.has(email)) {
              const userId = crypto.randomUUID();
              const referralCode = (email.split('@')[0] + crypto.randomBytes(4).toString('hex')).slice(0, 16).toUpperCase();
              
              newAccounts.push({
                user_id: userId,
                email: email,
                full_name: info.name,
                phone: info.phone,
                referral_code: referralCode,
                created_at: new Date().toISOString(),
                // No password - customer must reset password to access account
                password_hash: '',
                password_salt: ''
              });
            }
          });

          let created = 0;
          if (newAccounts.length > 0) {
            // Batch insert new users
            const { error: insertErr } = await backfillClient
              .from('h2s_users')
              .insert(newAccounts);

            if (!insertErr) {
              created = newAccounts.length;
            }
          }

          // Update any users missing referral codes
          const { data: usersWithoutCodes } = await backfillClient
            .from('h2s_users')
            .select('email, referral_code')
            .or('referral_code.is.null,referral_code.eq.');

          let updated = 0;
          if (usersWithoutCodes && usersWithoutCodes.length > 0) {
            for (const user of usersWithoutCodes) {
              const newCode = (user.email.split('@')[0] + crypto.randomBytes(3).toString('hex')).slice(0, 16).toUpperCase();
              await backfillClient
                .from('h2s_users')
                .update({ referral_code: newCode })
                .eq('email', user.email);
              updated++;
            }
          }

          return NextResponse.json({
            ok: true,
            summary: {
              total_unique_customers: uniqueCustomers.size,
              existing_accounts: existingEmails.size,
              created_accounts: created,
              updated_referral_codes: updated
            },
            message: `Backfill complete: ${created} accounts created, ${updated} referral codes generated`
          }, { headers: corsHeaders(request) });

        } catch (backfillErr: any) {
          console.error('[Shop API] Backfill error:', backfillErr);
          return NextResponse.json({
            ok: false,
            error: backfillErr.message || 'Backfill failed'
          }, { status: 500, headers: corsHeaders(request) });
        }

      case 'user':
        // Fetch user profile by email
        const userEmail = searchParams.get('email');
        
        if (!userEmail) {
          return NextResponse.json({
            ok: false,
            error: 'Email parameter required'
          }, { status: 400, headers: corsHeaders(request) });
        }

        const userClient = getSupabaseDb1() || getSupabase();
        if (!userClient) {
          return NextResponse.json({
            ok: false,
            error: 'Database unavailable'
          }, { status: 503, headers: corsHeaders(request) });
        }

        try {
          const { data: userData, error: userError } = await userClient
            .from('h2s_users')
            .select('email, full_name, phone, referral_code, points_balance, total_spent')
            .eq('email', userEmail.trim().toLowerCase())
            .single();

          if (userError || !userData) {
            return NextResponse.json({
              ok: false,
              error: 'User not found'
            }, { status: 404, headers: corsHeaders(request) });
          }

          // Auto-generate referral code if missing
          if (!userData.referral_code) {
            const newCode = (userEmail.split('@')[0] + Math.random().toString(36).slice(2, 6)).slice(0, 16).toUpperCase();
            await userClient.from('h2s_users').update({ referral_code: newCode }).eq('email', userEmail);
            userData.referral_code = newCode;
          }

          return NextResponse.json({
            ok: true,
            user: {
              email: userData.email,
              name: userData.full_name || '',
              phone: userData.phone || '',
              referral_code: userData.referral_code,
              credits: Number(userData.points_balance || 0),
              total_spent: Number(userData.total_spent || 0)
            }
          }, { headers: corsHeaders(request) });

        } catch (dbError: any) {
          console.error('[Shop API] User fetch error:', dbError);
          return NextResponse.json({
            ok: false,
            error: dbError.message || 'Failed to retrieve user'
          }, { status: 500, headers: corsHeaders(request) });
        }

      case 'ai_sales':
        try {
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
        } catch (aiError: any) {
          console.error('[Shop API] AI Sales error:', aiError);
          return NextResponse.json({
            success: false,
            error: 'AI recommendations temporarily unavailable',
            details: aiError.message
          }, { status: 500, headers: corsHeaders(request) });
        }

      default:
        return NextResponse.json({
          ok: false,
          error: 'Invalid action. Supported: catalog, orders, user, backfill_accounts, ai_sales, orderpack'
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
    // Support both 'action' and '__action' for backwards compatibility
    const action = body.action || body.__action;
    const { customer, cart, promotion_code, success_url, cancel_url, metadata } = body;
    // Back-compat: older clients POSTed {customer, cart, metadata} with no action.
    // If we have a checkout-shaped payload, treat it as create_checkout_session.
    const __action = action || ((customer && cart) ? 'create_checkout_session' : undefined);

    // ===== SIGNIN =====
    if (__action === 'signin') {
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '');
      
      if (!email || !password) {
        return NextResponse.json({
          ok: false,
          error: 'Missing credentials'
        }, { status: 400, headers: corsHeaders(request) });
      }

      const client = getSupabaseDb1() || getSupabase();
      if (!client) {
        return NextResponse.json({
          ok: false,
          error: 'Database unavailable'
        }, { status: 503, headers: corsHeaders(request) });
      }

      const { data, error } = await client.from('h2s_users')
        .select('email, full_name, phone, password_hash, password_salt, referral_code, points_balance, total_spent')
        .eq('email', email)
        .single();

      if (error || !data) {
        return NextResponse.json({
          ok: false,
          error: 'Invalid email or password'
        }, { status: 401, headers: corsHeaders(request) });
      }

      if (!verifyPassword(password, data.password_hash, data.password_salt)) {
        return NextResponse.json({
          ok: false,
          error: 'Invalid email or password'
        }, { status: 401, headers: corsHeaders(request) });
      }

      // Update last_login
      await client.from('h2s_users')
        .update({ last_login: new Date().toISOString() })
        .eq('email', email);

      // Auto-generate referral code if missing
      if (!data.referral_code) {
        const newCode = (email.split('@')[0] + Math.random().toString(36).slice(2, 6)).slice(0, 16).toUpperCase();
        await client.from('h2s_users').update({ referral_code: newCode }).eq('email', email);
        data.referral_code = newCode;
      }

      return NextResponse.json({
        ok: true,
        user: {
          email: data.email,
          name: data.full_name || '',
          phone: data.phone || '',
          referral_code: data.referral_code,
          credits: Number(data.points_balance || 0),
          total_spent: Number(data.total_spent || 0)
        }
      }, { status: 200, headers: corsHeaders(request) });
    }

    // ===== CREATE USER =====
    if (__action === 'create_user') {
      const u = body.user || {};
      if (!u.email || !u.password) {
        return NextResponse.json({
          ok: false,
          error: 'Missing email or password'
        }, { status: 400, headers: corsHeaders(request) });
      }

      const email = String(u.email).trim().toLowerCase();
      const { hash, salt } = hashPassword(String(u.password));
      const user_id = crypto.randomUUID();
      const referral_code = (email.split('@')[0] + crypto.randomBytes(4).toString('hex')).slice(0, 16).toUpperCase();

      const client = getSupabaseDb1() || getSupabase();
      if (!client) {
        return NextResponse.json({
          ok: false,
          error: 'Database unavailable'
        }, { status: 503, headers: corsHeaders(request) });
      }

      const { data, error } = await client.from('h2s_users').insert({
        user_id,
        email,
        password_hash: hash,
        password_salt: salt,
        full_name: u.name || '',
        phone: u.phone || '',
        referral_code,
        created_at: new Date().toISOString(),
        last_login: new Date().toISOString()
      }).select('user_id, email, full_name, phone, referral_code, points_balance, total_spent').single();

      if (error) {
        return NextResponse.json({
          ok: false,
          error: error.message
        }, { status: 400, headers: corsHeaders(request) });
      }

      return NextResponse.json({
        ok: true,
        user: {
          email: data.email,
          name: data.full_name || '',
          phone: data.phone || '',
          referral_code: data.referral_code,
          credits: Number(data.points_balance || 0),
          total_spent: Number(data.total_spent || 0)
        }
      }, { status: 200, headers: corsHeaders(request) });
    }

    // ===== UPSERT USER =====
    if (__action === 'upsert_user') {
      const u = body.user || {};
      const email = String(u.email || '').trim().toLowerCase();
      if (!email) {
        return NextResponse.json({
          ok: false,
          error: 'Missing email'
        }, { status: 400, headers: corsHeaders(request) });
      }

      const client = getSupabaseDb1() || getSupabase();
      if (!client) {
        return NextResponse.json({
          ok: false,
          error: 'Database unavailable'
        }, { status: 503, headers: corsHeaders(request) });
      }

      const { data, error } = await client.from('h2s_users')
        .upsert({ email, full_name: u.name || '', phone: u.phone || '' }, { onConflict: 'email' })
        .select('email, full_name, phone, referral_code, points_balance, total_spent')
        .single();

      if (error) {
        return NextResponse.json({
          ok: false,
          error: error.message
        }, { status: 400, headers: corsHeaders(request) });
      }

      return NextResponse.json({
        ok: true,
        user: {
          email: data.email,
          name: data.full_name || '',
          phone: data.phone || '',
          referral_code: data.referral_code,
          credits: Number(data.points_balance || 0),
          total_spent: Number(data.total_spent || 0)
        }
      }, { status: 200, headers: corsHeaders(request) });
    }

    // ===== REQUEST PASSWORD RESET =====
    if (__action === 'request_password_reset') {
      const email = String(body.email || '').trim().toLowerCase();
      if (!email) {
        return NextResponse.json({
          ok: false,
          error: 'Missing email'
        }, { status: 400, headers: corsHeaders(request) });
      }

      const token = crypto.randomBytes(24).toString('hex');
      const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

      const client = getSupabaseDb1() || getSupabase();
      if (!client) {
        return NextResponse.json({
          ok: false,
          error: 'Database unavailable'
        }, { status: 503, headers: corsHeaders(request) });
      }

      const { error } = await client.from('h2s_users')
        .update({ reset_token: token, reset_expires: expires })
        .eq('email', email);

      if (error) {
        return NextResponse.json({
          ok: false,
          error: error.message
        }, { status: 400, headers: corsHeaders(request) });
      }

      return NextResponse.json({
        ok: true,
        token
      }, { status: 200, headers: corsHeaders(request) });
    }

    // ===== RESET PASSWORD =====
    if (__action === 'reset_password') {
      const token = String(body.token || '');
      const newpw = String(body.new_password || '');
      
      if (!token || newpw.length < 8) {
        return NextResponse.json({
          ok: false,
          error: 'Invalid request'
        }, { status: 400, headers: corsHeaders(request) });
      }

      const client = getSupabaseDb1() || getSupabase();
      if (!client) {
        return NextResponse.json({
          ok: false,
          error: 'Database unavailable'
        }, { status: 503, headers: corsHeaders(request) });
      }

      const { data, error } = await client.from('h2s_users')
        .select('email, reset_expires')
        .eq('reset_token', token)
        .single();

      if (error || !data) {
        return NextResponse.json({
          ok: false,
          error: 'Invalid token'
        }, { status: 400, headers: corsHeaders(request) });
      }

      if (data.reset_expires && new Date(data.reset_expires) < new Date()) {
        return NextResponse.json({
          ok: false,
          error: 'Token expired'
        }, { status: 400, headers: corsHeaders(request) });
      }

      const { hash, salt } = hashPassword(newpw);
      const { error: updErr } = await client.from('h2s_users')
        .update({ password_hash: hash, password_salt: salt, reset_token: null, reset_expires: null })
        .eq('reset_token', token);

      if (updErr) {
        return NextResponse.json({
          ok: false,
          error: updErr.message
        }, { status: 400, headers: corsHeaders(request) });
      }

      return NextResponse.json({
        ok: true
      }, { status: 200, headers: corsHeaders(request) });
    }

    // ===== CHANGE PASSWORD =====
    if (__action === 'change_password') {
      const email = String(body.email || '').trim().toLowerCase();
      const oldp = String(body.old_password || '');
      const newp = String(body.new_password || '');
      
      if (!email || newp.length < 8) {
        return NextResponse.json({
          ok: false,
          error: 'Invalid request'
        }, { status: 400, headers: corsHeaders(request) });
      }

      const client = getSupabaseDb1() || getSupabase();
      if (!client) {
        return NextResponse.json({
          ok: false,
          error: 'Database unavailable'
        }, { status: 503, headers: corsHeaders(request) });
      }

      const { data, error } = await client.from('h2s_users')
        .select('password_hash, password_salt')
        .eq('email', email)
        .single();

      if (error || !data) {
        return NextResponse.json({
          ok: false,
          error: 'Account not found'
        }, { status: 400, headers: corsHeaders(request) });
      }

      if (!verifyPassword(oldp, data.password_hash, data.password_salt)) {
        return NextResponse.json({
          ok: false,
          error: 'Incorrect current password'
        }, { status: 401, headers: corsHeaders(request) });
      }

      const { hash, salt } = hashPassword(newp);
      const { error: updErr } = await client.from('h2s_users')
        .update({ password_hash: hash, password_salt: salt })
        .eq('email', email);

      if (updErr) {
        return NextResponse.json({
          ok: false,
          error: updErr.message
        }, { status: 400, headers: corsHeaders(request) });
      }

      return NextResponse.json({
        ok: true
      }, { status: 200, headers: corsHeaders(request) });
    }

    if (__action === 'create_checkout_session') {
      // Generate unique request ID for tracing
      const reqId = crypto.randomUUID();
      const debugMode = body.debug === 1 || body.debug === '1' || body.debug === true;
      
      const diagnostics = {
        request_id: reqId,
        steps: {} as Record<string, { ok: boolean; at: string; error_code?: string; error_message?: string; data?: any }>,
        ids: { order_id: null as string | null, job_id: null as string | null, stripe_session_id: null as string | null }
      };
      
      const recordStep = (step: string, ok: boolean, data?: any, error?: any) => {
        diagnostics.steps[step] = {
          ok,
          at: new Date().toISOString(),
          error_code: error?.code || error?.name,
          error_message: error?.message,
          data
        };
        console.log(`[CHECKOUT][${reqId}][${step}]`, ok ? '✅' : '❌', data || error?.message || '');
      };
      
      const classifySupabaseError = (err: any): { code: string; message: string; classified: string } => {
        const msg = String(err?.message || err || '').toLowerCase();
        const code = String(err?.code || '');
        
        if (code === '42501' || msg.includes('permission denied') || msg.includes('insufficient privilege')) {
          return { code: 'DISPATCH_JOB_PERMISSION_DENIED', message: 'Database permission denied', classified: 'RLS' };
        }
        if (code === '23505' || msg.includes('unique') || msg.includes('duplicate')) {
          return { code: 'DISPATCH_JOB_DUPLICATE', message: 'Duplicate job constraint violation', classified: 'UNIQUE_VIOLATION' };
        }
        if (msg.includes('relation') && msg.includes('does not exist')) {
          return { code: 'DISPATCH_JOB_TABLE_MISSING', message: 'Dispatch jobs table not found', classified: 'TABLE_MISSING' };
        }
        if (msg.includes('column') && msg.includes('does not exist')) {
          return { code: 'DISPATCH_JOB_SCHEMA_MISMATCH', message: 'Table schema mismatch', classified: 'SCHEMA_ERROR' };
        }
        return { code: 'DISPATCH_JOB_UNKNOWN', message: err?.message || String(err), classified: 'UNKNOWN' };
      };
      
      console.log(`[CHECKOUT][${reqId}] ========== START create_checkout_session ==========`);
      recordStep('REQUEST_START', true, { customer_email: customer?.email, cart_count: cart?.length });
      
      // Helper function to log trace stages
      const logTrace = async (stage: string, context?: any) => {
        try {
          const client = getSupabaseDb1() || getSupabase();
          if (client) {
            await client.from('h2s_checkout_traces').insert({
              checkout_trace_id: reqId,
              stage,
              order_id: context?.order_id || null,
              job_id: context?.job_id || null,
              stripe_session_id: context?.stripe_session_id || null,
              context_json: context || null
            });
          }
        } catch (err) {
          console.error('[Checkout] Failed to log trace:', err);
        }
      };
      
      // Helper function to log failures
      const logFailure = async (stage: string, error: any, context?: any) => {
        try {
          const client = getSupabaseDb1() || getSupabase();
          if (client) {
            await client.from('h2s_checkout_failures').insert({
              checkout_trace_id: reqId,
              stage,
              error_message: error?.message || String(error),
              error_stack: error?.stack || null,
              context_json: context || null
            });
          }
        } catch (err) {
          console.error('[Checkout] Failed to log failure:', err);
        }
      };
      
      await logTrace('REQUEST_START', { customer_email: customer?.email, cart_count: cart?.length });
      
      // Validate Stripe is configured
      if (!stripe) {
        await logFailure('REQUEST_START', new Error('Payment processing not configured'));
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

      // === Offer logic (non-invasive) ===
      // NEWYEAR50: $50 off total (Stripe promo code) + free Roku when booking 2+ TV mounts.
      // Roku is fulfillment metadata only (not a $0 Stripe line item) to avoid checkout edge cases.
      const offerMeta: any = { ...(metadata || {}) };
      const promoCodeText = String(promotion_code || '').trim().toUpperCase();
      const offerCode = 'NEWYEAR50';
      const countTvMountsInCart = (items: any[]): number => {
        let count = 0;
        for (const it of items || []) {
          const qty = Number(it?.qty || 1);

          // Prefer explicit TV-package metadata (multi-TV flows set these)
          const meta = it?.metadata || {};
          const tvCount = Number(meta?.tv_count || 0);
          if (Number.isFinite(tvCount) && tvCount > 0 && Number.isFinite(qty) && qty > 0) {
            count += (tvCount * qty);
            continue;
          }

          // Fallback: items_json array (one element per TV)
          const itemsJson = meta?.items_json;
          if (Array.isArray(itemsJson) && itemsJson.length && Number.isFinite(qty) && qty > 0) {
            const inner = itemsJson.reduce((sum: number, row: any) => sum + (Number(row?.qty || 1) || 1), 0);
            if (inner > 0) {
              count += (inner * qty);
              continue;
            }
          }

          // Fallback: single-TV metadata on line item
          if (meta && (meta.tv_size || meta.mount_type) && Number.isFinite(qty) && qty > 0) {
            count += qty;
            continue;
          }

          // Last resort: name heuristic
          const name = String(it?.name || it?.service_name || it?.service_id || it?.id || '').toLowerCase();
          // Heuristic: treat anything that looks like TV mounting as a TV mount.
          const isTv = name.includes('tv');
          const isMount = name.includes('mount');
          if (isTv && isMount && Number.isFinite(qty) && qty > 0) count += qty;
        }
        return count;
      };

      const tvMountQty = countTvMountsInCart(cart);
      if (promoCodeText === offerCode) {
        offerMeta.offer_code = offerCode;
        offerMeta.offer_amount_off_usd = 50;
        offerMeta.tv_mount_qty = tvMountQty;
        if (tvMountQty >= 2) {
          offerMeta.free_roku = true;
          // One Roku per TV mount (2 TVs => 2 Rokus)
          offerMeta.free_roku_qty = tvMountQty;
        }
      }

      const toStripeMetaValue = (v: any): string | undefined => {
        if (v === null || v === undefined) return undefined;
        if (typeof v === 'string') return v.length > 450 ? v.slice(0, 450) : v;
        if (typeof v === 'number' || typeof v === 'boolean') return String(v);
        // Do not send objects/arrays to Stripe metadata
        return undefined;
      };

      const buildStripeSessionMetadata = (): Record<string, string> => {
        const out: Record<string, string> = {};
        const set = (k: string, v: any) => {
          const sv = toStripeMetaValue(v);
          if (sv !== undefined && sv !== '') out[k] = sv;
        };

        // Always include core fields
        set('customer_name', customer?.name || '');
        set('customer_phone', customer?.phone || '');
        set('customer_email', customer?.email || '');
        set('source', offerMeta?.source || 'shop_rebuilt');

        // Service address fields (these arrive via payload.metadata)
        set('service_address', offerMeta?.service_address);
        set('service_city', offerMeta?.service_city);
        set('service_state', offerMeta?.service_state);
        set('service_zip', offerMeta?.service_zip);

        // Job details (stringify nested object for Stripe)
        if (offerMeta?.job_details) {
          set('job_details_json', JSON.stringify(offerMeta.job_details));
        }

        // Offer fields (optional)
        set('offer_code', offerMeta?.offer_code);
        set('offer_amount_off_usd', offerMeta?.offer_amount_off_usd);
        set('tv_mount_qty', offerMeta?.tv_mount_qty);
        set('free_roku', offerMeta?.free_roku);
        set('free_roku_qty', offerMeta?.free_roku_qty);

        return out;
      };

      // Transform cart items to Stripe line items
      const lineItems = cart.map(item => {
        const productData: any = {
          name: item.name || item.service_name || 'Service'
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
        line_items: lineItems,
        mode: 'payment',
        success_url: success_url || 'https://shop.home2smart.com/bundles?view=shopsuccess&session_id={CHECKOUT_SESSION_ID}',
        cancel_url: cancel_url || 'https://shop.home2smart.com/bundles',
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
      if (promotion_code) {
        console.log('[Checkout] Promo code requested:', promotion_code);
        
        // DETERMINISTIC PATH: Check cache first (no Stripe API call)
        const normalizedCode = promotion_code.toLowerCase();
        const cachedPromo = KNOWN_PROMO_CODES[normalizedCode];
        
        if (cachedPromo && cachedPromo.active && cachedPromo.id) {
          console.log('[Checkout] Using cached promo ID:', cachedPromo.id, '(checkout_promo_mode: cache_id)');
          // Direct use of cached Stripe promotion_code ID - no API lookup needed
          sessionParams.discounts = [{
            promotion_code: cachedPromo.id // Use cached promo_... ID directly
          }];
        } else if (cachedPromo && cachedPromo.active && !cachedPromo.id) {
          // Code is cached but missing Stripe promotion_code_id
          console.error('[Checkout] Promo in cache but missing promotion_code_id:', promotion_code);
          return NextResponse.json({
            ok: false,
            code: 'PROMO_CACHE_MISSING_ID',
            error: `Promo code ${promotion_code} is recognized but cannot be applied to checkout. Contact support.`
          }, { status: 400, headers: corsHeaders(request) });
        } else {
          // Code not in cache - reject to avoid Stripe timeout
          console.warn('[Checkout] Promo code not in cache, rejecting:', promotion_code, '(checkout_promo_mode: rejected)');
          return NextResponse.json({
            ok: false,
            code: 'PROMO_NOT_SUPPORTED',
            error: `Promo code ${promotion_code} is not currently supported. Please try another code or contact support.`
          }, { status: 400, headers: corsHeaders(request) });
        }
      } else {
        console.log('[Checkout] No promo code (checkout_promo_mode: none)');
      }

      // Use client-provided idempotency key if available, otherwise generate deterministic one
      // This prevents duplicate sessions on frontend retries
      const clientIdempotencyKey = body.idempotency_key || body.client_request_id;
      
      // Generate deterministic idempotency key based on customer email + timestamp bucket (5 min windows)
      // This ensures retries within 5 minutes use same key, preventing duplicate sessions
      // Generate GUARANTEED UNIQUE order ID - timestamp + random bytes
      const timestamp = Date.now().toString(36).toUpperCase(); // Base36 timestamp
      const randomPart = crypto.randomBytes(4).toString('hex').toUpperCase();
      const orderId = `ORD-${timestamp}${randomPart}`;
      
      // Generate deterministic key for Stripe session idempotency ONLY (5-minute window)
      const timeBucket = Math.floor(Date.now() / (5 * 60 * 1000));
      const cartFingerprint = cart.map(i => `${i.id || i.name}:${i.qty}`).join(',');
      const deterministicKey = clientIdempotencyKey || 
        crypto.createHash('sha256')
          .update(`${customer.email}|${cartFingerprint}|${timeBucket}`)
          .digest('hex')
          .substring(0, 32);
      
      console.log('[Checkout] Order ID (FORCED UNIQUE):', orderId);
      console.log('[Checkout] Stripe idempotency key (for dedup):', deterministicKey);

      // === CRITICAL CHANGE: Create Order + Job BEFORE Stripe ===
      // This ensures we ALWAYS have a record, even if Stripe fails
      // Pattern: Create with "pending_payment" status, update to "paid" via webhook
      
      const client = getSupabaseDb1() || getSupabase();
      if (!client) {
        await logFailure('DATABASE_UNAVAILABLE', new Error('Database client not available'));
        return NextResponse.json({
          ok: false,
          error: 'Database temporarily unavailable'
        }, { status: 503, headers: corsHeaders(request) });
      }

      console.log('[Checkout] ========== STEP 1: CREATE ORDER + JOB ==========');
      
      // Calculate totals from cart
      let subtotal = 0;
      const items = cart.map(item => {
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
      
      // ✅ DISPATCH FIX: Calculate job value and technician payout
      // CRITICAL: cart prices are in DOLLARS, must convert to cents
      // Job value = pre-discount subtotal (not amount paid, which can be $0 with 100% discount)
      // Payout = 35% of job value (strict business rule)
      const jobValueDollars = subtotal; // subtotal is in dollars (e.g., 2100 for $2,100)
      const jobValueCents = Math.round(jobValueDollars * 100); // Convert to cents (210000)
      const techPayoutCents = Math.round(jobValueCents * 0.35); // 35% in cents (73500)
      const techPayoutDollars = techPayoutCents / 100; // Back to dollars for display (735.00)
      
      console.log('[Checkout] ========== JOB VALUE & PAYOUT CALCULATION ==========');
      console.log('[Checkout] Cart subtotal (DOLLARS):', jobValueDollars);
      console.log('[Checkout] Job value (cents):', jobValueCents);
      console.log('[Checkout] Tech payout @ 35% (cents):', techPayoutCents);
      console.log('[Checkout] Tech payout (DOLLARS):', techPayoutDollars);
      
      // SANITY CHECK: Abort if values are nonsensical
      if (jobValueDollars < 100) {
        console.error('[Checkout] ❌ INVALID JOB VALUE:', jobValueDollars);
        console.error('[Checkout] Cart items:', JSON.stringify(cart, null, 2));
        await logFailure('INVALID_JOB_VALUE', new Error(`Job value too low: $${jobValueDollars}`));
        return NextResponse.json({
          ok: false,
          error: 'Invalid cart value',
          code: 'INVALID_JOB_VALUE'
        }, { status: 400, headers: corsHeaders(request) });
      }
      
      if (techPayoutDollars < 35) {
        console.error('[Checkout] ❌ INVALID PAYOUT:', techPayoutDollars);
        console.error('[Checkout] This should never happen - payout should be 35% of job value');
        console.error('[Checkout] Job value:', jobValueDollars, 'Payout:', techPayoutDollars);
        await logFailure('INVALID_PAYOUT', new Error(`Payout too low: $${techPayoutDollars}`));
        return NextResponse.json({
          ok: false,
          error: 'Payout calculation failed',
          code: 'INVALID_PAYOUT'
        }, { status: 500, headers: corsHeaders(request) });
      }
      
      // Generate complete data summaries (no placeholders)
      const jobDetailsSummary = generateJobDetailsSummary(cart, customer, offerMeta);
      const equipmentProvided = generateEquipmentProvided(cart, offerMeta);
      
      // ✅ BUILD CANONICAL JOB_DETAILS PAYLOAD
      const jobDetails = buildJobDetailsPayload(cart, customer, offerMeta || {});
      
      // Enhanced metadata with computed fields
      const enhancedMetadata = {
        ...offerMeta,
        job_details: jobDetails, // ✅ Canonical job details payload
        job_details_summary: jobDetailsSummary,
        equipment_provided: equipmentProvided,
        schedule_status: 'Scheduling Pending',
        cart_items_count: cart.length,
        cart_total_items: cart.reduce((sum, item) => sum + (item.qty || 1), 0),
        // ✅ PAYOUT CALCULATION - Store in h2s_orders.metadata_json
        job_value_cents: jobValueCents,        // e.g., 210000 for $2,100
        tech_payout_cents: techPayoutCents,    // e.g., 73500 (35%)
        tech_payout_dollars: techPayoutDollars, // e.g., 735.00
        payout_rate: 0.35,
      };
      
      // Insert order with status "pending_payment"
      console.log('[Checkout] Creating order:', orderId);
      await logTrace('ORDER_INSERT_START', { order_id: orderId });
      
      const { error: orderInsertError } = await client.from('h2s_orders').insert({
        order_id: orderId,
        session_id: null, // Will be updated after Stripe session creation
        customer_email: customer.email,
        customer_name: customer.name || '',
        customer_phone: customer.phone || '',
        items: items,
        subtotal: subtotal,
        total: subtotal,
        currency: 'usd',
        status: 'pending_payment', // Critical: shows this order is waiting for payment
        metadata_json: enhancedMetadata,
        created_at: new Date().toISOString(),
        address: offerMeta?.service_address || '',
        city: offerMeta?.service_city || '',
        state: offerMeta?.service_state || '',
        zip: offerMeta?.service_zip || ''
      });
      
      if (orderInsertError) {
        console.error('[Checkout] ❌ ORDER INSERT FAILED:', {
          error: orderInsertError.message,
          code: orderInsertError.code,
          order_id: orderId
        });
        await logFailure('ORDER_INSERT', orderInsertError, { order_id: orderId });
        
        // FAIL HARD - No order means no checkout
        return NextResponse.json({
          ok: false,
          error: 'Failed to create order record',
          code: 'ORDER_INSERT_FAILED',
          details: orderInsertError.message
        }, { status: 500, headers: corsHeaders(request) });
      }
      
      console.log('[Checkout] ✅ Order created successfully:', orderId);
      await logTrace('ORDER_INSERTED', { order_id: orderId });

      // Now create dispatch job
      console.log('[Checkout] Creating dispatch job for order:', orderId);
      await logTrace('JOB_CREATE_START', { order_id: orderId });
      
      let jobId: string | null = null;
      
      try {
        const dispatch = getSupabaseDispatch() || client;
        
        if (!dispatch) {
          throw new Error('Dispatch database client not available');
        }
        
        const DEFAULT_SEQUENCE_ID = '88297425-c134-4a51-8450-93cb35b1b3cb';
        const DEFAULT_STEP_ID = 'd30da333-3a54-4598-8ac1-f3b276185ea1';

        // Resolve or create recipient
        let recipientId = null;
        const customerEmail = customer.email;

        try {
          const { data: existingRecipient } = await dispatch
            .from('h2s_recipients')
            .select('recipient_id')
            .eq('email_normalized', customerEmail)
            .maybeSingle();

          if (existingRecipient) {
            recipientId = existingRecipient.recipient_id;
            console.log('[Checkout] Found existing recipient:', recipientId);
          }
        } catch (findErr) {
          console.warn('[Checkout] Error finding recipient:', findErr);
        }

        if (!recipientId) {
          console.log('[Checkout] Creating new recipient for:', customerEmail);
          try {
            const { data: newRecipient, error: createRecipErr } = await dispatch
              .from('h2s_recipients')
              .insert({
                email_normalized: customerEmail,
                first_name: customer.name || 'Customer',
                recipient_key: `customer-${crypto.randomUUID()}`
              })
              .select('recipient_id')
              .single();

            if (createRecipErr) {
              console.error('[Checkout] Failed to create recipient:', createRecipErr);
              throw createRecipErr;
            } else {
              recipientId = newRecipient.recipient_id;
              console.log('[Checkout] ✅ Created recipient:', recipientId);
            }
          } catch (createErr) {
            console.error('[Checkout] Exception creating recipient:', createErr);
            throw createErr;
          }
        }

        if (!recipientId) {
          throw new Error('Failed to resolve or create recipient');
        }

        // Create dispatch job - MINIMAL DATA ONLY
        // NOTE: If constraint h2s_dispatch_jobs_recipient_step_uq still exists, this will fail for repeat customers
        // The migration should have dropped it and added order_id uniqueness instead
        
        // ✅ SCHEMA COMPLIANCE: h2s_dispatch_jobs has ONLY 13 columns
        // NO metadata column, NO payout columns - all financial data lives in h2s_orders.metadata_json
        // This table only tracks job workflow state and links to order via order_id
        
        const insertJob: any = filterDispatchJobPayload({
          order_id: orderId,                   // ✅ Links to h2s_orders (source of payout data)
          status: 'queued',                    // ✅ Required by DB check constraint
          created_at: new Date().toISOString(),
          due_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // Temporary - will be updated when scheduled
          recipient_id: recipientId,
          sequence_id: DEFAULT_SEQUENCE_ID,
          step_id: DEFAULT_STEP_ID,
          attempt_count: 0,
          // ❌ NO metadata field (column doesn't exist)
          // ❌ NO payout_estimated field (column doesn't exist)
          // ✅ All payout data is in h2s_orders.metadata_json (linked via order_id)
        });
        
        console.log('[Checkout] ========== DISPATCH JOB CREATION ==========');
        console.log('[Checkout] Job value (cents):', jobValueCents);
        console.log('[Checkout] Tech payout @ 35%:', techPayoutDollars);
        console.log('[Checkout] ✅ Payout stored in h2s_orders.metadata_json.tech_payout_dollars');
        console.log('[Checkout] ✅ Dispatch job links to order via order_id:', orderId);
        console.log('[Checkout] Install date/window: Will be set when customer schedules appointment');

        console.log('[Checkout] Creating dispatch job:', JSON.stringify(insertJob));

        const { data: jobData, error: jobError } = await dispatch
          .from('h2s_dispatch_jobs')
          .insert(insertJob)
          .select()
          .single();

        if (jobError) {
          console.error('[Checkout] ❌ DISPATCH JOB INSERT FAILED:', {
            error: jobError.message,
            code: jobError.code,
            details: jobError.details,
            hint: jobError.hint,
            order_id: orderId,
            recipient_id: recipientId,
            full_error: JSON.stringify(jobError)
          });

          // Check if it's the old constraint blocking us
          if (jobError.code === '23505') {
            console.error('[Checkout] ⚠️  UNIQUE CONSTRAINT VIOLATION!');
            console.error('[Checkout] ⚠️  Message:', jobError.message);
            console.error('[Checkout] ⚠️  Details:', jobError.details);
            console.error('[Checkout] ⚠️  This means the constraint STILL EXISTS in the database!');
          }

          await logFailure('JOB_INSERT', jobError, { order_id: orderId, recipient_id: recipientId });
          
          // Return detailed error to client for debugging
          return NextResponse.json({
            ok: false,
            error: 'Failed to create dispatch job',
            code: 'JOB_INSERT_FAILED',
            details: jobError.message,
            supabase_error: {
              code: jobError.code,
              details: jobError.details,
              hint: jobError.hint,
              message: jobError.message
            }
          }, { status: 500, headers: corsHeaders(request) });
        }

        jobId = jobData?.job_id;
        console.log('[Checkout] ✅ Dispatch job created:', jobId);
        console.log('[Checkout] ========== JOB WRITTEN TO DATABASE ==========');
        console.log('[Checkout] Job ID:', jobId);
        console.log('[Checkout] Status:', jobData?.status);
        console.log('[Checkout] Due at (temporary):', jobData?.due_at);
        console.log('[Checkout] Payout (metadata->tech_payout_dollars):', jobData?.metadata?.tech_payout_dollars);
        console.log('[Checkout] Metadata includes:', {
          job_value_cents: jobData?.metadata?.job_value_cents,
          tech_payout_cents: jobData?.metadata?.tech_payout_cents,
          job_value_dollars: jobData?.metadata?.job_value_dollars,
          tech_payout_dollars: jobData?.metadata?.tech_payout_dollars,
          scheduled_status: jobData?.metadata?.scheduled_status
        });
        await logTrace('JOB_CREATED', { 
          order_id: orderId, 
          job_id: jobId, 
          recipient_id: recipientId,
          job_value_cents: jobValueCents,
          tech_payout_cents: techPayoutCents,
          payout_estimated: techPayoutDollars
        });

        // Link job to order metadata - CRITICAL STEP
        if (jobId) {
          const { data: orderData, error: fetchErr } = await client
            .from('h2s_orders')
            .select('metadata_json')
            .eq('order_id', orderId)
            .single();

          if (fetchErr) {
            console.error('[Checkout] ❌ Failed to fetch order for metadata update:', fetchErr);
            throw new Error(`Cannot link job to order: ${fetchErr.message}`);
          }

          const currentMeta = (orderData?.metadata_json && typeof orderData.metadata_json === 'object')
            ? orderData.metadata_json
            : {};

          const { error: updateErr } = await client
            .from('h2s_orders')
            .update({
              metadata_json: {
                ...currentMeta,
                dispatch_job_id: jobId,
                dispatch_recipient_id: recipientId
              }
            })
            .eq('order_id', orderId);

          if (updateErr) {
            console.error('[Checkout] ❌ Failed to link job to order metadata:', updateErr);
            throw new Error(`Metadata update failed: ${updateErr.message}`);
          }

          console.log('[Checkout] ✅ Linked job to order metadata (VERIFIED)');
          await logTrace('JOB_LINKED_TO_ORDER', { order_id: orderId, job_id: jobId });
        } else {
          console.error('[Checkout] ❌ No jobId to link!');
          throw new Error('Job creation returned no job_id');
        }
      } catch (jobCreateErr: any) {
        console.error('[Checkout] ❌ Job creation failed:', {
          error: jobCreateErr.message,
          stack: jobCreateErr.stack,
          order_id: orderId
        });
        await logFailure('JOB_CREATE_EXCEPTION', jobCreateErr, { order_id: orderId });
        
        // FAIL HARD - No job means checkout is incomplete
        // Clean up the order we just created
        try {
          await client.from('h2s_orders').delete().eq('order_id', orderId);
          console.log('[Checkout] Cleaned up order after job creation failure');
        } catch (cleanupErr) {
          console.error('[Checkout] Failed to clean up order:', cleanupErr);
        }
        
        return NextResponse.json({
          ok: false,
          error: `Failed to create dispatch job: ${jobCreateErr.message}`,
          code: jobCreateErr.code || 'JOB_CREATE_FAILED',
          details: jobCreateErr.details || jobCreateErr.message,
          hint: jobCreateErr.hint || '',
          supabase_error: {
            message: jobCreateErr.message,
            code: jobCreateErr.code,
            details: jobCreateErr.details,
            hint: jobCreateErr.hint
          }
        }, { status: 500, headers: corsHeaders(request) });
      }

      console.log('[Checkout] ========== STEP 2: CREATE STRIPE SESSION ==========');

      // Prefer Stripe Relay if configured; otherwise fall back to direct Stripe.
      // Direct Stripe API calls are now verified via /api/stripe_smoke, so this is safe.
      const relayUrl = process.env.STRIPE_RELAY_URL;
      const relaySecret = process.env.STRIPE_RELAY_SECRET;

      console.log(`[Checkout] Using idempotency key: ${deterministicKey}`);
      await logTrace('SESSION_CREATE_START', { order_id: orderId, idempotency_key: deterministicKey });

      let session: { id: string; url: string | null };
      try {
        if (relayUrl && relaySecret) {
          console.log(`[Checkout] Calling relay: ${relayUrl}/stripe/checkout`);

          // Fetch with timeout control (8 seconds max)
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 8000);

          const relayResponse = await fetch(`${relayUrl}/stripe/checkout`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${relaySecret}`
            },
            body: JSON.stringify({
              sessionParams,
              idempotencyKey: deterministicKey // Use deterministic key for retry safety
            }),
            signal: controller.signal
          });

          clearTimeout(timeoutId);
          const relayData = await relayResponse.json();

          if (!relayResponse.ok || !relayData.ok) {
            console.error('[Checkout] Relay returned error:', relayData);
            return NextResponse.json({
              ok: false,
              error: relayData.error || 'Payment system error',
              code: relayData.code || 'RELAY_ERROR'
            }, { status: relayResponse.status, headers: corsHeaders(request) });
          }

          session = { id: relayData.session.id, url: relayData.session.url };
          console.log(`[Checkout] ✓ Session created via relay: ${session.id}`);
          await logTrace('SESSION_CREATED', { stripe_session_id: session.id, order_id: orderId, via: 'relay' });
        } else if (stripe) {
          console.warn('[Checkout] Stripe relay not configured; falling back to direct Stripe API');
          const created = await stripe.checkout.sessions.create(
            sessionParams,
            { idempotencyKey: deterministicKey }
          );
          session = { id: created.id, url: created.url };
          console.log(`[Checkout] ✓ Session created via direct Stripe: ${session.id}`);
          await logTrace('SESSION_CREATED', { stripe_session_id: session.id, order_id: orderId, via: 'direct' });
        } else {
          console.error('[Checkout] Neither Stripe Relay nor STRIPE_SECRET_KEY configured');
          throw new Error('PAYMENT_NOT_CONFIGURED');
        }

      } catch (stripeCreateError: any) {
        console.error('[Checkout] ❌ Session creation failed:', stripeCreateError);
        await logFailure('SESSION_CREATE_FAILED', stripeCreateError, { order_id: orderId });

        // Clean up order and job since Stripe session failed
        try {
          await client.from('h2s_orders').delete().eq('order_id', orderId);
          if (jobId) {
            const dispatch = getSupabaseDispatch() || client;
            await dispatch.from('h2s_dispatch_jobs').delete().eq('job_id', jobId);
          }
          console.log('[Checkout] Cleaned up order+job after Stripe failure');
        } catch (cleanupErr) {
          console.error('[Checkout] Failed to clean up after Stripe failure:', cleanupErr);
        }

        if (stripeCreateError?.name === 'AbortError') {
          return NextResponse.json({
            ok: false,
            error: 'Payment system timeout. Please try again.',
            code: 'PAYMENT_TIMEOUT'
          }, { status: 504, headers: corsHeaders(request) });
        }

        if (stripeCreateError?.message === 'PAYMENT_NOT_CONFIGURED') {
          return NextResponse.json({
            ok: false,
            error: 'Payment system configuration error. Please contact support.',
            code: 'PAYMENT_NOT_CONFIGURED'
          }, { status: 500, headers: corsHeaders(request) });
        }

        return NextResponse.json({
          ok: false,
          error: 'Unable to connect to payment system. Please try again.',
          code: 'PAYMENT_CONNECTION_ERROR',
          details: stripeCreateError?.message
        }, { status: 500, headers: corsHeaders(request) });
      }

      // Update order and job with Stripe session_id
      console.log('[Checkout] ========== STEP 3: UPDATE ORDER+JOB WITH SESSION ID ==========');
      console.log('[Checkout] Updating order with session_id:', session.id);
      
      try {
        const { error: updateError } = await client
          .from('h2s_orders')
          .update({
            session_id: session.id,
            status: 'pending' // Payment pending (webhook will update to "paid")
          })
          .eq('order_id', orderId);

        if (updateError) {
          console.error('[Checkout] ❌ Failed to update order with session_id:', updateError);
          await logFailure('ORDER_UPDATE_SESSION', updateError, { order_id: orderId, session_id: session.id });
          // Continue anyway - order exists, session exists, just not linked perfectly
        } else {
          console.log('[Checkout] ✅ Order updated with session_id');
          await logTrace('ORDER_UPDATED_WITH_SESSION', { order_id: orderId, session_id: session.id });
        }
      } catch (updateErr) {
        console.error('[Checkout] Exception updating order:', updateErr);
        // Continue anyway
      }

      console.log('[Checkout] ========== CHECKOUT COMPLETE ==========');
      console.log('[Checkout] Order ID:', orderId);
      console.log('[Checkout] Job ID:', jobId);
      console.log('[Checkout] Session ID:', session.id);
      console.log('[Checkout] Deployment timestamp:', new Date().toISOString()); // Force cache bust
      await logTrace('COMPLETE_SUCCESS', { order_id: orderId, job_id: jobId, stripe_session_id: session.id });

      return NextResponse.json({
        ok: true,
        checkout_trace_id: reqId,
        order_id: orderId,
        job_id: jobId,
        pay: {
          session_url: session.url,
          session_id: session.id
        },
        __debug: {
          job_created: !!jobId,
          deployment_timestamp: new Date().toISOString()
        }
      }, { status: 200, headers: corsHeaders(request) });
    }

    if (__action === 'promo_check_cart') {
      // Check if promo code applies to cart items
      const { promotion_code, line_items } = body;

      if (!stripe) {
        return NextResponse.json({
          ok: false,
          error: 'Stripe not configured'
        }, { status: 503, headers: corsHeaders(request) });
      }

      if (!promotion_code) {
        return NextResponse.json({
          ok: false,
          applicable: false,
          error: 'No promotion code provided'
        }, { status: 400, headers: corsHeaders(request) });
      }

      if (!Array.isArray(line_items) || line_items.length === 0) {
        return NextResponse.json({
          ok: false,
          applicable: false,
          error: 'No items in cart'
        }, { status: 400, headers: corsHeaders(request) });
      }

      try {
        console.log('[Promo Check] ========================================');
        console.log('[Promo Check] Searching for code:', promotion_code);
        console.log('[Promo Check] Cart has', line_items.length, 'items');
        console.log('[Promo Check] Items:', line_items.map(i => `${i.name || 'Unnamed'} x${i.quantity || 1} @ $${(i.unit_amount || 0)/100}`).join(', '));
        
        // FAST PATH: Check cache first to avoid Stripe API timeout issues
        const normalizedCode = promotion_code.toLowerCase();
        const cachedPromo = KNOWN_PROMO_CODES[normalizedCode];
        let coupon: any;
        let promoCode: any;
        
        if (cachedPromo && cachedPromo.active) {
          console.log('[Promo Check] Found in cache:', cachedPromo.code);
          coupon = cachedPromo.coupon;
          promoCode = cachedPromo;
        } else {
          console.log('[Promo Check] Not in cache, trying Stripe API...');
          const startTime = Date.now();
          // SLOW PATH: Search for the promotion code in Stripe
          const promoCodes = await stripe.promotionCodes.list({
            code: promotion_code,
            limit: 1,
            active: true
          });

          console.log('[Promo Check] Stripe response time:', Date.now() - startTime, 'ms');
          console.log('[Promo Check] Search results:', promoCodes.data?.length || 0, 'codes found');

          if (!promoCodes.data || promoCodes.data.length === 0) {
            return NextResponse.json({
              ok: true,
              applicable: false,
              error: 'Promotion code not found or inactive'
            }, { headers: corsHeaders(request) });
          }

          const promoCodeId = promoCodes.data[0].id;
          promoCode = promoCodes.data[0];
          console.log('[Promo Check] Found promo code ID:', promoCodeId);
          console.log('[Promo Check] Active:', promoCode.active);
          console.log('[Promo Check] Restrictions:', JSON.stringify(promoCode.restrictions || {}));
          
          // Use coupon from list response
          coupon = promoCode.coupon;
        }
        
        console.log('[Promo Check] Coupon object exists:', !!coupon);
        if (coupon) {
          console.log('[Promo Check] Coupon ID:', coupon.id);
          console.log('[Promo Check] Coupon percent_off:', coupon.percent_off);
          console.log('[Promo Check] Coupon amount_off:', coupon.amount_off);
          console.log('[Promo Check] Coupon applies_to:', JSON.stringify(coupon.applies_to || {}));
        }
        
        if (!coupon) {
          console.log('[Promo Check] ERROR: Coupon not found on promo code');
          return NextResponse.json({
            ok: false,
            applicable: false,
            error: 'Unable to retrieve coupon details'
          }, { status: 500, headers: corsHeaders(request) });
        }

        console.log('[Promo Check] SUCCESS: Coupon found:', coupon.id, coupon.percent_off ? `${coupon.percent_off}%` : `$${coupon.amount_off/100}`);

        // Calculate subtotal
        let subtotalCents = 0;
        for (const item of line_items) {
          const unitAmount = item.unit_amount || 0;
          const quantity = item.quantity || 1;
          subtotalCents += unitAmount * quantity;
        }

        console.log('[Promo Check] Subtotal:', subtotalCents, 'cents ($' + (subtotalCents/100).toFixed(2) + ')');

        // Calculate discount
        let savingsCents = 0;
        if (coupon.percent_off) {
          savingsCents = Math.round(subtotalCents * (coupon.percent_off / 100));
          console.log('[Promo Check] Calculated discount:', coupon.percent_off, '% of', subtotalCents, '=', savingsCents, 'cents');
        } else if (coupon.amount_off) {
          savingsCents = coupon.amount_off;
          console.log('[Promo Check] Fixed discount:', savingsCents, 'cents');
        }

        // Ensure discount doesn't exceed subtotal
        savingsCents = Math.min(savingsCents, subtotalCents);

        const totalCents = subtotalCents - savingsCents;

        console.log('[Promo Check] Final calculation:');
        console.log('[Promo Check]   Subtotal: $' + (subtotalCents/100).toFixed(2));
        console.log('[Promo Check]   Savings: -$' + (savingsCents/100).toFixed(2));
        console.log('[Promo Check]   Total: $' + (totalCents/100).toFixed(2));
        console.log('[Promo Check] ========================================');

        return NextResponse.json({
          ok: true,
          applicable: true,
          promotion_code: promoCode.code,
          estimate: {
            subtotal_cents: subtotalCents,
            savings_cents: savingsCents,
            total_cents: totalCents,
            currency: coupon.currency || 'usd'
          }
        }, { headers: corsHeaders(request) });

      } catch (stripeError: any) {
        console.error('[Promo Check] ERROR: Stripe error occurred!');
        console.error('[Promo Check] Error type:', stripeError.type);
        console.error('[Promo Check] Error message:', stripeError.message);
        console.error('[Promo Check] Error code:', stripeError.code);
        console.error('[Promo Check] Full error:', JSON.stringify(stripeError, null, 2));
        console.error('[Promo Check] ========================================');
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


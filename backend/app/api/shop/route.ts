import { NextResponse } from 'next/server';
import { getSupabaseDb1, getSupabase, getSupabaseDispatch } from '@/lib/supabase';
import { resolveDispatchRequiredIds } from '@/lib/dispatchRequiredIds';
import OpenAI from 'openai';
import Stripe from 'stripe';
import crypto from 'crypto';

const openai = process.env.OPENAI_API_KEY 
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' as any })
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
    const { __action, customer, cart, promotion_code, success_url, cancel_url, metadata } = body;

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
        try {
          // Search for the promotion code in Stripe (same as promo_check_cart)
          const promoCodes = await stripe.promotionCodes.list({
            code: promotion_code,
            limit: 1,
            active: true
          });

          if (promoCodes.data && promoCodes.data.length > 0) {
            const promoCodeId = promoCodes.data[0].id;
            console.log('[Checkout] Found promo code ID:', promoCodeId, 'for code:', promotion_code);
            // Stripe needs the promo code ID, not the code string
            sessionParams.discounts = [{
              promotion_code: promoCodeId
            }];
          } else {
            console.warn('[Checkout] Promo code not found:', promotion_code);
            return NextResponse.json({
              ok: false,
              error: `No such promotion code: '${promotion_code}'`
            }, { status: 500, headers: corsHeaders(request) });
          }
        } catch (promoError: any) {
          console.error('[Checkout] Error looking up promo code:', promoError);
          return NextResponse.json({
            ok: false,
            error: `Promotion code error: ${promoError.message}`
          }, { status: 500, headers: corsHeaders(request) });
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
            metadata_json: offerMeta || {},
            created_at: new Date().toISOString(),
            address: offerMeta?.service_address || '',
            city: offerMeta?.service_city || '',
            state: offerMeta?.service_state || '',
            zip: offerMeta?.service_zip || ''
          });

          // Create a dispatch job immediately (even before scheduling) so ops/portal can see it.
          // The schedule-appointment API will later find and update this job to `scheduled`.
          try {
            const dispatch = getSupabaseDispatch() || client;
            if (dispatch) {
              const lookupKeys = Array.from(new Set([orderId, session.id].filter(Boolean)));
              let exists = false;
              for (const k of lookupKeys) {
                try {
                    const { data } = await dispatch.from('h2s_dispatch_jobs').select('job_id').eq('order_id', k).maybeSingle();
                    if (data?.job_id) {
                      exists = true;
                      break;
                    }
                  } catch {
                    // ignore
                  }

                  try {
                    const { data } = await dispatch.from('h2s_dispatch_jobs').select('job_id').eq('order_ref', k).maybeSingle();
                    if (data?.job_id) {
                      exists = true;
                      break;
                    }
                  } catch {
                    // ignore
                  }

                  try {
                    const { data } = await dispatch.from('h2s_dispatch_jobs').select('job_id').eq('order_number', k).maybeSingle();
                    if (data?.job_id) {
                      exists = true;
                      break;
                    }
                } catch {
                  // ignore
                }
              }

              if (!exists) {
                const serviceId = String(offerMeta?.service_id || cart?.[0]?.id || cart?.[0]?.service_id || cart?.[0]?.name || '').trim() || null;
                const customerName = String(customer?.name || '').trim();
                const customerEmail = String(customer?.email || '').trim();
                const customerPhone = String(customer?.phone || '').trim();
                const address = String(offerMeta?.service_address || '').trim();
                const city = String(offerMeta?.service_city || '').trim();
                const state = String(offerMeta?.service_state || '').trim();
                const zip = String(offerMeta?.service_zip || '').trim();

                const enrichedMetadata: any = {
                  ...(offerMeta || {}),
                  order_id_text: orderId,
                  session_id: session.id,
                  created_via: 'api/shop:create_checkout_session',
                  items_json: items,
                  customer_name: customerName || (metadata as any)?.customer_name,
                  customer_email: customerEmail || (metadata as any)?.customer_email,
                  customer_phone: customerPhone || (metadata as any)?.customer_phone,
                  service_address: address || (metadata as any)?.service_address,
                  service_city: city || (metadata as any)?.service_city,
                  service_state: state || (metadata as any)?.service_state,
                  service_zip: zip || (metadata as any)?.service_zip,
                  service_id: serviceId,
                };

                const insertJob: any = {
                  status: 'queued',
                  order_id: orderId,
                  created_at: new Date().toISOString(),
                  due_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
                  metadata: enrichedMetadata,
                };

                if (customerName) insertJob.customer_name = customerName;
                if (customerEmail) insertJob.customer_email = customerEmail;
                if (customerPhone) insertJob.customer_phone = customerPhone;
                if (address) insertJob.service_address = address;
                if (city) insertJob.service_city = city;
                if (state) insertJob.service_state = state;
                if (zip) insertJob.service_zip = zip;
                if (serviceId) insertJob.service_id = serviceId;

                const extractMissingColumn = (err: any): string | null => {
                  const msg = String(err?.message || '');
                  const m = msg.match(/Could not find the '([^']+)' column/i);
                  return m?.[1] || null;
                };

                const extractNotNullColumn = (err: any): string | null => {
                  const msg = String(err?.message || '');
                  const m = msg.match(/null value in column\s+"([^"]+)"(?:\s+of\s+relation\s+"[^"]+")?\s+violates not-null constraint/i);
                  return m?.[1] || null;
                };

                const computeNextSequenceId = async (): Promise<number | null> => {
                  try {
                    const { data, error } = await dispatch
                      .from('h2s_dispatch_jobs')
                      .select('sequence_id')
                      .order('sequence_id', { ascending: false })
                      .limit(1)
                      .maybeSingle();
                    if (error) return null;
                    const current = (data as any)?.sequence_id;
                    const n = typeof current === 'number' ? current : Number(current);
                    if (!Number.isFinite(n)) return 1;
                    return Math.max(1, Math.floor(n) + 1);
                  } catch {
                    return null;
                  }
                };

                const pickExistingSequenceId = async (): Promise<string | number | null> => {
                  try {
                    const { data, error } = await dispatch
                      .from('h2s_dispatch_jobs')
                      .select('sequence_id')
                      .order('created_at', { ascending: false })
                      .limit(5);
                    if (error || !Array.isArray(data)) return null;
                    for (const row of data) {
                      const v = (row as any)?.sequence_id;
                      if (v === null || v === undefined) continue;
                      const s = String(v).trim();
                      if (s) return v;
                    }
                    return null;
                  } catch {
                    return null;
                  }
                };

                const pickDispatchSequenceId = async (): Promise<string | number | null> => {
                  const fromEnv = String(
                    process.env.DEFAULT_DISPATCH_SEQUENCE_ID || process.env.DISPATCH_DEFAULT_SEQUENCE_ID || ''
                  ).trim();
                  if (fromEnv) return fromEnv;

                  const fromJobs = await pickExistingSequenceId();
                  if (fromJobs !== null) return fromJobs;

                  for (const table of [
                    'h2s_dispatch_sequences',
                    'dispatch_sequences',
                    'h2s_sequences',
                    'sequences',
                    'h2s_job_sequences',
                    'job_sequences'
                  ]) {
                    try {
                      const { data, error } = await dispatch.from(table).select('*').limit(1);
                      if (error) continue;
                      const row = Array.isArray(data) ? data[0] : null;
                      if (!row) continue;
                      const candidates = [row.sequence_id, row.id, row.uuid];
                      for (const c of candidates) {
                        if (c === null || c === undefined) continue;
                        const s = String(c).trim();
                        if (s) return c;
                      }
                    } catch {
                      // ignore
                    }
                  }

                  return null;
                };

                const pickExistingRecipientId = async (): Promise<string | null> => {
                  try {
                    const { data, error } = await dispatch
                      .from('h2s_dispatch_jobs')
                      .select('recipient_id')
                      .order('created_at', { ascending: false })
                      .limit(5);
                    if (error || !Array.isArray(data)) return null;
                    for (const row of data) {
                      const rid = String((row as any)?.recipient_id ?? '').trim();
                      if (rid) return rid;
                    }
                    return null;
                  } catch {
                    return null;
                  }
                };

                const pickDispatchRecipientId = async (): Promise<string | null> => {
                  const fromEnv = String(
                    process.env.DEFAULT_DISPATCH_RECIPIENT_ID || process.env.DISPATCH_DEFAULT_RECIPIENT_ID || ''
                  ).trim();
                  if (fromEnv) return fromEnv;

                  const fromJobs = await pickExistingRecipientId();
                  if (fromJobs) return fromJobs;

                  for (const table of ['h2s_dispatch_recipients', 'dispatch_recipients', 'recipients']) {
                    try {
                      const { data, error } = await dispatch.from(table).select('*').limit(1);
                      if (error) continue;
                      const row = Array.isArray(data) ? data[0] : null;
                      if (!row) continue;
                      const candidates = [row.recipient_id, row.id, row.uuid, row.user_id];
                      for (const c of candidates) {
                        const s = String(c || '').trim();
                        if (s) return s;
                      }
                    } catch {
                      // ignore
                    }
                  }

                  try {
                    const { data: pros, error } = await dispatch.from('h2s_dispatch_pros').select('*').limit(25);
                    if (!error && Array.isArray(pros)) {
                      for (const p of pros) {
                        const candidates = [p?.pro_id, p?.tech_id, p?.user_id, p?.id];
                        for (const c of candidates) {
                          const s = String(c || '').trim();
                          if (s) return s;
                        }
                      }
                    }
                  } catch {
                    // ignore
                  }

                  return null;
                };

                const pickDispatchIdForColumn = async (column: string): Promise<string | null> => {
                  const col = String(column || '').trim();
                  if (!col) return null;

                  const envKeyA = `DEFAULT_DISPATCH_${col.toUpperCase()}`;
                  const envKeyB = `DISPATCH_DEFAULT_${col.toUpperCase()}`;
                  const envVal = String((process.env as any)?.[envKeyA] || (process.env as any)?.[envKeyB] || '').trim();
                  if (envVal) return envVal;

                  try {
                    const { data, error } = await dispatch
                      .from('h2s_dispatch_jobs')
                      .select(col)
                      .order('created_at', { ascending: false })
                      .limit(5);
                    if (!error && Array.isArray(data)) {
                      for (const row of data) {
                        const v = String((row as any)?.[col] ?? '').trim();
                        if (v) return v;
                      }
                    }
                  } catch {
                    // ignore
                  }

                  const base = col.endsWith('_id') ? col.slice(0, -3) : col;
                  const candidatesTables = Array.from(
                    new Set([
                      `h2s_dispatch_${base}s`,
                      `dispatch_${base}s`,
                      `${base}s`,
                      `h2s_${base}s`,
                      `h2s_dispatch_${base}`,
                      `dispatch_${base}`,
                      `${base}`,
                      `h2s_${base}`,
                    ])
                  );

                  for (const table of candidatesTables) {
                    try {
                      const { data, error } = await dispatch.from(table).select('*').limit(1);
                      if (error) continue;
                      const row = Array.isArray(data) ? data[0] : null;
                      if (!row) continue;
                      const idCandidates = [
                        (row as any)?.[col],
                        (row as any)?.[`${base}_id`],
                        (row as any)?.id,
                        (row as any)?.uuid,
                      ];
                      for (const c of idCandidates) {
                        const s = String(c ?? '').trim();
                        if (s) return s;
                      }
                    } catch {
                      // ignore
                    }
                  }

                  return null;
                };

                const safeInsertDispatchJob = async (initial: any): Promise<{ ok: boolean; error?: any }> => {
                  const payload: any = { ...(initial || {}) };
                  for (const k of Object.keys(payload)) {
                    if (payload[k] === undefined) delete payload[k];
                  }

                  let lastErr: any = null;
                  let triedRecipientSentinel = false;
                  let triedSequenceSentinel = false;
                  const triedIdSentinelByCol: Record<string, boolean> = {};
                  for (let i = 0; i < 25; i++) {
                    const { error } = await dispatch.from('h2s_dispatch_jobs').insert(payload);
                    if (!error) return { ok: true };
                    lastErr = error;

                    if (String(error?.code || '') === '23502') {
                      const col = extractNotNullColumn(error);
                      if ((col === 'sequence_id' || col === 'recipient_id' || col === 'step_id') && (payload as any)[col] == null) {
                        const picked = await resolveDispatchRequiredIds(dispatch);
                        if (col === 'sequence_id' && picked.sequenceId) {
                          payload.sequence_id = picked.sequenceId;
                          continue;
                        }
                        if (col === 'recipient_id' && picked.recipientId) {
                          payload.recipient_id = picked.recipientId;
                          continue;
                        }
                        if (col === 'step_id' && picked.stepId) {
                          payload.step_id = picked.stepId;
                          continue;
                        }
                        break;
                      }

                      if (col && /_id$/i.test(col) && (payload as any)[col] == null) {
                        const picked = await pickDispatchIdForColumn(col);
                        if (picked) {
                          (payload as any)[col] = picked;
                          continue;
                        }

                        if (!triedIdSentinelByCol[col]) {
                          triedIdSentinelByCol[col] = true;
                          (payload as any)[col] = '00000000-0000-0000-0000-000000000000';
                          continue;
                        }
                      }
                    }

                    if (String(error?.code || '') === '22P02') {
                      const msg = String(error?.message || '');
                      if (!triedSequenceSentinel && typeof payload.sequence_id === 'number' && /type\s+uuid/i.test(msg)) {
                        triedSequenceSentinel = true;
                        payload.sequence_id = '00000000-0000-0000-0000-000000000000';
                        continue;
                      }
                    }

                    const missing = extractMissingColumn(error);
                    if (missing && missing in payload) {
                      delete payload[missing];
                      continue;
                    }
                    break;
                  }

                  return { ok: false, error: lastErr };
                };

                const ins = await safeInsertDispatchJob(insertJob);
                if (!ins.ok) {
                  console.warn('[Checkout] Dispatch job insert failed (non-fatal):', ins.error?.message || ins.error);
                } else {
                  console.log('[Checkout] Dispatch job created for order:', orderId);
                }
              } else {
                console.log('[Checkout] Dispatch job already exists for order:', orderId);
              }
            }
          } catch (jobCreateErr) {
            console.warn('[Checkout] Dispatch job creation exception (non-fatal):', jobCreateErr);
          }
          
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
        console.log('[Promo Check] Searching for code:', promotion_code);
        
        // Search for the promotion code in Stripe  
        const promoCodes = await stripe.promotionCodes.list({
          code: promotion_code,
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
        for (const item of line_items) {
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


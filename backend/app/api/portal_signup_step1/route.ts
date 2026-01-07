import { NextResponse } from 'next/server';
import { getSupabaseDispatch } from '@/lib/supabase';
import { issuePortalToken } from '@/lib/portalTokens';
import crypto from 'crypto';

function corsHeaders(request?: Request): Record<string, string> {
  const origin = request?.headers.get('origin') || '';
  const allowedOrigins = [
    'https://home2smart.com',
    'https://www.home2smart.com',
    'https://portal.home2smart.com',
    'http://localhost:3000',
    'http://localhost:8080'
  ];

  const allowOrigin = allowedOrigins.includes(origin) ? origin : '*';

  const headers: Record<string, string> = {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  if (allowOrigin !== '*') {
    headers['Access-Control-Allow-Credentials'] = 'true';
  }

  return headers;
}

export async function OPTIONS(request: Request) {
  return NextResponse.json({}, { headers: corsHeaders(request) });
}

function normalizeEmail(email: any): string {
  return String(email || '').trim().toLowerCase();
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { 
      email, 
      name, 
      phone, 
      address, 
      city, 
      state, 
      zip,
      company_name 
    } = body;

    // Validate required fields
    if (!email || !name) {
      return NextResponse.json(
        { ok: false, error: 'Email and name are required' },
        { status: 400, headers: corsHeaders(request) }
      );
    }

    const normalizedEmail = normalizeEmail(email);
    const client = getSupabaseDispatch();

    if (!client) {
      console.error('[portal_signup_step1] Failed to get Supabase client');
      return NextResponse.json(
        { ok: false, error: 'Database connection failed' },
        { status: 500, headers: corsHeaders(request) }
      );
    }

    // Check if pro already exists
    const { data: existing } = await client
      .from('h2s_pros')
      .select('pro_id, email, is_active')
      .eq('email', normalizedEmail)
      .maybeSingle();

    if (existing) {
      // Pro already exists - return error
      return NextResponse.json(
        { 
          ok: false, 
          error: 'An account with this email already exists. Please log in instead.',
          existing: true
        },
        { status: 409, headers: corsHeaders(request) }
      );
    }

    // Create new Pro account
    const proId = crypto.randomUUID();
    const insertData: any = {
      pro_id: proId,
      email: normalizedEmail,
      name: name,
      phone: phone || null,
      address: address || null,
      city: city || null,
      state: state || null,
      home_zip: zip || null,
      zip: zip || null, // Some schemas use 'zip' instead of 'home_zip'
      company_name: company_name || null,
      is_active: false, // Inactive until admin approves
      is_available_now: false,
      service_radius_miles: 35, // Default service radius
      created_at: new Date().toISOString(),
    };

    const { data: newPro, error: insertError } = await client
      .from('h2s_pros')
      .insert(insertData)
      .select()
      .single();

    if (insertError) {
      console.error('[portal_signup_step1] Insert error:', insertError);
      return NextResponse.json(
        { ok: false, error: `Failed to create account: ${insertError.message}` },
        { status: 500, headers: corsHeaders(request) }
      );
    }

    // Issue JWT token for the new pro
    const token = issuePortalToken({ sub: proId, role: 'pro', email: normalizedEmail });

    return NextResponse.json(
      {
        ok: true,
        token,
        pro_id: proId,
        message: 'Account created successfully. Your account is pending admin approval.',
        pending_approval: true
      },
      { headers: corsHeaders(request) }
    );

  } catch (err: any) {
    console.error('[portal_signup_step1] Error:', err);
    return NextResponse.json(
      { ok: false, error: err.message || 'Internal server error' },
      { status: 500, headers: corsHeaders(request) }
    );
  }
}

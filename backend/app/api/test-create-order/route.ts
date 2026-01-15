import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import crypto from 'crypto';

// TEST ONLY - Direct order creation bypassing Stripe
// This endpoint should be disabled in production or protected

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders() });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { customer, cart, metadata } = body;

    if (!customer?.email || !customer?.name || !cart || cart.length === 0) {
      return NextResponse.json(
        { ok: false, error: 'Missing required fields: customer.email, customer.name, cart' },
        { status: 400, headers: corsHeaders() }
      );
    }

    const supabase = getSupabase();
    if (!supabase) {
      return NextResponse.json(
        { ok: false, error: 'Database not available' },
        { status: 503, headers: corsHeaders() }
      );
    }

    // Generate unique order ID
    const timestamp = Date.now().toString(36).toUpperCase();
    const randomPart = crypto.randomBytes(4).toString('hex').toUpperCase();
    const orderId = `ORD-${timestamp}${randomPart}`;

    // Calculate totals
    const subtotal = cart.reduce((sum: number, item: any) => {
      return sum + ((item.price || 0) * (item.qty || 1));
    }, 0);
    const total = subtotal; // No tax/fees for test

    // Build enriched metadata with job_details
    const enrichedMetadata: any = {
      ...metadata,
      customer_email: customer.email,
      customer_name: customer.name,
      customer_phone: customer.phone || '',
    };

    // If job_details doesn't exist, build it from cart
    if (!enrichedMetadata.job_details) {
      enrichedMetadata.job_details = {
        services: cart.map((item: any) => ({
          name: item.name || 'Service',
          price: item.price || 0,
          qty: item.qty || 1,
        })),
        equipment_provided: 'provider',
      };
    }

    // Insert order
    const { data: order, error: insertError } = await supabase
      .from('h2s_orders')
      .insert({
        order_id: orderId,
        session_id: `test_${crypto.randomUUID()}`,
        customer_email: customer.email,
        customer_name: customer.name,
        customer_phone: customer.phone || '',
        subtotal: subtotal,
        total: total,
        currency: 'usd',
        status: 'pending',
        metadata_json: enrichedMetadata,
        created_at: new Date().toISOString(),
        // Address fields from metadata
        address: metadata?.service_address || '',
        city: metadata?.service_city || '',
        state: metadata?.service_state || '',
        zip: metadata?.service_zip || '',
      })
      .select()
      .single();

    if (insertError) {
      console.error('[Test Create Order] Insert failed:', insertError);
      return NextResponse.json(
        { ok: false, error: insertError.message },
        { status: 500, headers: corsHeaders() }
      );
    }

    console.log('[Test Create Order] Created:', orderId);

    return NextResponse.json(
      {
        ok: true,
        order_id: orderId,
        total: total,
        message: 'Test order created successfully',
      },
      { status: 200, headers: corsHeaders() }
    );
  } catch (error: any) {
    console.error('[Test Create Order] Error:', error);
    return NextResponse.json(
      { ok: false, error: error.message || 'Internal server error' },
      { status: 500, headers: corsHeaders() }
    );
  }
}

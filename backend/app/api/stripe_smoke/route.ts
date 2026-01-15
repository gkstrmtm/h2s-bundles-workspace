import { NextResponse } from 'next/server';
import Stripe from 'stripe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const startTotal = Date.now();
  
  // Environment info
  const env = {
    node: process.version,
    region: process.env.VERCEL_REGION || 'unknown',
    runtime: 'nodejs'
  };

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    return NextResponse.json({
      ok: false,
      error: 'STRIPE_SECRET_KEY not configured',
      timing_ms: { total: Date.now() - startTotal }
    }, { status: 500 });
  }

  const stripe = new Stripe(stripeKey, {
    apiVersion: '2024-06-20' as any,
    timeout: 25000,
    maxNetworkRetries: 3
  });

  const beforeStripe = Date.now();
  const toStripeCall = beforeStripe - startTotal;

  try {
    // Minimal session params - single $1 item
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          unit_amount: 100, // $1.00
          product_data: {
            name: 'Smoke Test Item'
          }
        },
        quantity: 1
      }],
      success_url: 'https://shop.home2smart.com/success',
      cancel_url: 'https://shop.home2smart.com/cancel'
    });

    const afterStripe = Date.now();
    const stripeCall = afterStripe - beforeStripe;
    const total = afterStripe - startTotal;

    return NextResponse.json({
      ok: true,
      session_id: session.id,
      url: session.url,
      timing_ms: {
        total,
        to_stripe_call: toStripeCall,
        stripe_call: stripeCall
      },
      env
    });

  } catch (error: any) {
    const afterError = Date.now();
    const stripeCall = afterError - beforeStripe;
    const total = afterError - startTotal;

    return NextResponse.json({
      ok: false,
      error: error.message,
      error_type: error.type || 'unknown',
      error_code: error.code || null,
      timing_ms: {
        total,
        to_stripe_call: toStripeCall,
        stripe_call: stripeCall
      },
      env
    }, { status: 500 });
  }
}

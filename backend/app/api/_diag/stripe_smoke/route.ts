import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2024-06-20' as any,
  maxNetworkRetries: 0, // No auto-retry for diagnostic
  timeout: 10000,
});

export async function GET(req: NextRequest) {
  const requestId = `diag_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const mode = req.nextUrl.searchParams.get('mode') || 'account';
  
  const result: any = {
    request_id: requestId,
    timestamp: new Date().toISOString(),
    mode,
    ok: false,
    step: '',
    duration_ms: 0,
    error_name: null,
    error_message: null,
  };

  const startTime = performance.now();

  try {
    if (mode === 'account') {
      // Test 1: Simple account retrieval (fast, lightweight)
      result.step = 'accounts.retrieve';
      const account = await stripe.accounts.retrieve();
      result.duration_ms = Math.round(performance.now() - startTime);
      result.ok = true;
      result.account_id = account.id.slice(0, 12) + '***';
      
    } else if (mode === 'session') {
      // Test 2: Minimal checkout session creation
      result.step = 'checkout.sessions.create';
      
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        payment_method_types: ['card'],
        line_items: [
          {
            price_data: {
              currency: 'usd',
              unit_amount: 100, // $1.00
              product_data: {
                name: 'Diagnostic Test Item',
              },
            },
            quantity: 1,
          },
        ],
        success_url: 'https://shop.home2smart.com/test',
        cancel_url: 'https://shop.home2smart.com/test',
        metadata: {
          test: 'diagnostic',
          request_id: requestId,
        },
      });
      
      result.duration_ms = Math.round(performance.now() - startTime);
      result.ok = true;
      result.session_id = session.id.slice(0, 20) + '***';
      
    } else {
      throw new Error(`Invalid mode: ${mode}. Use 'account' or 'session'`);
    }
    
  } catch (error: any) {
    result.duration_ms = Math.round(performance.now() - startTime);
    result.ok = false;
    result.error_name = error.constructor.name;
    result.error_message = error.message || 'Unknown error';
    
    if (error.type) result.error_type = error.type;
    if (error.code) result.error_code = error.code;
  }

  return NextResponse.json(result, {
    headers: {
      'Cache-Control': 'no-store, max-age=0',
    },
  });
}

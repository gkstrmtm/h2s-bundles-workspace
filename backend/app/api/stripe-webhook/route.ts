import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-12-15.clover',
});

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const sig = req.headers.get('stripe-signature');
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!sig || !webhookSecret) {
    console.error('[Webhook] Missing signature or secret');
    return NextResponse.json({ error: 'Webhook signature required' }, { status: 400 });
  }

  let event: Stripe.Event;

  try {
    const body = await req.text();
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
  } catch (err: any) {
    console.error('[Webhook] Signature verification failed:', err.message);
    return NextResponse.json({ error: `Webhook Error: ${err.message}` }, { status: 400 });
  }

  // Initialize Supabase client
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!
  );

  try {
    // Handle checkout.session.completed
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      
      console.log('[Stripe Webhook] Checkout completed:', {
        session_id: session.id,
        customer_email: session.customer_email,
        amount_total: session.amount_total
      });

      // Extract customer data from metadata
      const customerName = session.metadata?.customer_name || session.customer_details?.name || '';
      const customerPhone = session.metadata?.customer_phone || session.customer_details?.phone || '';
      const customerEmail = session.customer_email || session.customer_details?.email || '';

      // Extract address from metadata or customer_details
      const address = session.metadata?.service_address || session.customer_details?.address?.line1 || '';
      const city = session.metadata?.service_city || session.customer_details?.address?.city || '';
      const state = session.metadata?.service_state || session.customer_details?.address?.state || '';
      const zip = session.metadata?.service_zip || session.customer_details?.address?.postal_code || '';

      // Check if order exists
      const { data: existingOrder } = await supabase
        .from('h2s_orders')
        .select('order_id')
        .eq('session_id', session.id)
        .single();

      let order;
      
      if (existingOrder) {
         // Update existing
         const { data: updated, error: updateError } = await supabase
            .from('h2s_orders')
            .update({
               payment_intent_id: session.payment_intent as string,
               status: 'paid',
               metadata_json: session.metadata,
               // Update address fields if missing
               address: address,
               city: city,
               state: state,
               zip: zip,
               customer_name: customerName,
               customer_phone: customerPhone
            })
            .eq('order_id', existingOrder.order_id)
            .select('order_id')
            .single();
         
         if (updateError) {
           console.error('[Stripe Webhook] Failed to update order:', updateError);
         } else {
           console.log('[Stripe Webhook] Updated existing order:', updated?.order_id);
         }
         
         order = updated || existingOrder;
      } else {
         // Generate Order ID
         const orderId = `ORD-${crypto.randomUUID().substring(0, 8).toUpperCase()}`;

         // Insert new order
         const { data: inserted, error: insertError } = await supabase
            .from('h2s_orders')
            .insert({
              order_id: orderId,
              session_id: session.id,
              payment_intent_id: session.payment_intent as string,
              customer_email: customerEmail,
              customer_name: customerName,
              customer_phone: customerPhone,
              subtotal: ((session.amount_subtotal || session.amount_total) || 0) / 100,
              total: (session.amount_total || 0) / 100,
              currency: session.currency,
              status: session.payment_status === 'paid' ? 'paid' : 'pending',
              metadata_json: session.metadata,
              created_at: new Date().toISOString(),
              // Save address fields
              address: address,
              city: city,
              state: state,
              zip: zip,
            })
            .select('order_id')
            .single();

         if (insertError) {
           console.error('[Stripe Webhook] Failed to save order:', insertError);
         } else {
           console.log('[Stripe Webhook] Order saved:', inserted?.order_id);
         }
         
         order = inserted;
      }

      // Get cart items for notification
      const firstName = customerName.split(' ')[0] || 'there';
      const cartItems = JSON.parse(session.metadata?.cart_items || '[]');
      const serviceName = cartItems[0]?.name || 'Service';

      // === MANAGEMENT NOTIFICATION ===
      // Notify management of new booking via SMS
      const amountTotal = (session.amount_total || 0) / 100;
      const notificationType = amountTotal >= 500 ? 'highValueOrder' : 'newBooking';
      
      try {
        const baseUrl = process.env.VERCEL_URL 
          ? `https://${process.env.VERCEL_URL}` 
          : 'https://h2s-backend.vercel.app';
          
        await fetch(`${baseUrl}/api/notify-management`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: notificationType,
              idempotency_key: `stripe_checkout_completed|${session.id}`,
              data: {
              service: serviceName,
              customerName: customerName || 'Unknown',
              orderNumber: order?.order_id || session.id.slice(-8).toUpperCase(),
              amount: amountTotal.toFixed(2),
              city: city || 'Unknown',
              state: state || 'SC',
              phone: customerPhone || 'Not provided'
            }
          })
        });
        console.log('[Stripe Webhook] Management notification sent');
      } catch (mgmtError: any) {
        console.error('[Stripe Webhook] Management notification failed (non-critical):', mgmtError.message);
      }

      console.log('[Stripe Webhook] Processed order:', {
        order_id: order?.order_id,
        customer: customerName,
        total: (session.amount_total || 0) / 100,
        items: cartItems.length
      });

      return NextResponse.json({ received: true, order_id: order?.order_id });
    }

    // Handle payment_intent.succeeded
    if (event.type === 'payment_intent.succeeded') {
      const paymentIntent = event.data.object as Stripe.PaymentIntent;
      
      console.log('[Stripe Webhook] Payment succeeded:', {
        payment_intent_id: paymentIntent.id,
        amount: paymentIntent.amount
      });

      // Update order status
      const { error: updateError } = await supabase
        .from('h2s_orders')
        .update({ status: 'paid' })
        .eq('payment_intent_id', paymentIntent.id);

      if (updateError) {
        console.error('[Stripe Webhook] Failed to update payment status:', updateError);
      }

      return NextResponse.json({ received: true });
    }

    // Other event types
    console.log('[Stripe Webhook] Unhandled event type:', event.type);
    return NextResponse.json({ received: true });

  } catch (error: any) {
    console.error('[Stripe Webhook] Processing error:', error);
    return NextResponse.json(
      { error: 'Webhook processing failed', details: error.message },
      { status: 500 }
    );
  }
}

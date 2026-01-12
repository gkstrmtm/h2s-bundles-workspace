import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { getSupabase, getSupabaseDispatch } from '../../../lib/supabase';

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
         // Parse job_details if present
         const enrichedMetadata = { ...session.metadata };
         if (session.metadata?.job_details_json) {
           try {
             enrichedMetadata.job_details = JSON.parse(session.metadata.job_details_json);
             delete enrichedMetadata.job_details_json;
           } catch (e) {
             console.error('[Stripe Webhook] Failed to parse job_details_json:', e);
           }
         }
         
         // Update existing
         const { data: updated, error: updateError } = await supabase
            .from('h2s_orders')
            .update({
               payment_intent_id: session.payment_intent as string,
               status: 'paid',
               metadata_json: enrichedMetadata,
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
           
           // CRITICAL: Activate the dispatch job (change from pending_payment to queued)
           const orderId = existingOrder.order_id;
           const dispatchClient = getSupabaseDispatch() || supabase;
           
           try {
             const { data: jobData, error: jobUpdateError } = await dispatchClient
               .from('h2s_dispatch_jobs')
               .update({ status: 'queued' })
               .eq('order_id', orderId)
               .eq('status', 'pending_payment')
               .select('job_id')
               .maybeSingle();
             
             if (jobUpdateError) {
               console.error('[Stripe Webhook] Failed to activate job:', jobUpdateError);
             } else if (jobData) {
               console.log('[Stripe Webhook] ✅ Activated dispatch job:', jobData.job_id);
             } else {
               console.log('[Stripe Webhook] No pending job found to activate');
             }
           } catch (jobErr: any) {
             console.error('[Stripe Webhook] Job activation exception:', jobErr);
           }
         }
         
         order = updated || existingOrder;
      } else {
         // Generate Order ID
         const orderId = `ORD-${crypto.randomUUID().substring(0, 8).toUpperCase()}`;

         // Parse job_details if present
         const enrichedMetadata = { ...session.metadata };
         if (session.metadata?.job_details_json) {
           try {
             enrichedMetadata.job_details = JSON.parse(session.metadata.job_details_json);
             delete enrichedMetadata.job_details_json; // Remove the stringified version
           } catch (e) {
             console.error('[Stripe Webhook] Failed to parse job_details_json:', e);
           }
         }

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
              metadata_json: enrichedMetadata,
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

      // === CREATE DISPATCH JOB ===
      // Create dispatch job for this order (if not already exists)
      const orderId = order?.order_id;
      if (orderId) {
        try {
          console.log('[Stripe Webhook] Creating dispatch job for order:', orderId);
          
          const dispatchClient = getSupabaseDispatch() || supabase;
          
          // Check if job already exists for this order
          const { data: existingJob } = await dispatchClient
            .from('h2s_dispatch_jobs')
            .select('job_id')
            .eq('order_id', orderId)
            .maybeSingle();

          if (existingJob) {
            console.log('[Stripe Webhook] Job already exists:', existingJob.job_id);
          } else {
            // Resolve or create recipient
            let recipientId = null;
            
            try {
              const { data: existingRecipient } = await dispatchClient
                .from('h2s_recipients')
                .select('recipient_id')
                .eq('email_normalized', customerEmail.toLowerCase())
                .maybeSingle();

              if (existingRecipient) {
                recipientId = existingRecipient.recipient_id;
                console.log('[Stripe Webhook] Found existing recipient:', recipientId);
              } else {
                // Create new recipient
                const { data: newRecipient, error: recipientError } = await dispatchClient
                  .from('h2s_recipients')
                  .insert({
                    email_normalized: customerEmail.toLowerCase(),
                    first_name: customerName || 'Customer',
                    recipient_key: `customer-${crypto.randomUUID()}`
                  })
                  .select('recipient_id')
                  .single();

                if (recipientError) {
                  console.error('[Stripe Webhook] Failed to create recipient:', recipientError);
                  throw recipientError;
                }
                
                recipientId = newRecipient.recipient_id;
                console.log('[Stripe Webhook] Created new recipient:', recipientId);
              }
            } catch (recipientErr: any) {
              console.error('[Stripe Webhook] Recipient resolution failed:', recipientErr);
              // Continue without recipient - job creation will fail but won't block webhook
            }

            if (recipientId) {
              // Create dispatch job
              const DEFAULT_SEQUENCE_ID = '88297425-c134-4a51-8450-93cb35b1b3cb';
              const DEFAULT_STEP_ID = 'd30da333-3a54-4598-8ac1-f3b276185ea1';

              const jobPayload = {
                order_id: orderId,
                status: 'queued',
                created_at: new Date().toISOString(),
                due_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
                recipient_id: recipientId,
                sequence_id: DEFAULT_SEQUENCE_ID,
                step_id: DEFAULT_STEP_ID,
              };

              const { data: jobData, error: jobError } = await dispatchClient
                .from('h2s_dispatch_jobs')
                .insert(jobPayload)
                .select('job_id')
                .single();

              if (jobError) {
                console.error('[Stripe Webhook] Job creation failed:', jobError);
                // Log but don't block webhook processing
              } else {
                const jobId = jobData?.job_id;
                console.log('[Stripe Webhook] ✅ Dispatch job created:', jobId);

                // Update order metadata with job_id
                try {
                  const { data: orderData } = await supabase
                    .from('h2s_orders')
                    .select('metadata_json')
                    .eq('order_id', orderId)
                    .single();

                  const currentMeta = (orderData?.metadata_json && typeof orderData.metadata_json === 'object')
                    ? orderData.metadata_json
                    : {};

                  await supabase
                    .from('h2s_orders')
                    .update({
                      metadata_json: {
                        ...currentMeta,
                        dispatch_job_id: jobId,
                        dispatch_recipient_id: recipientId
                      }
                    })
                    .eq('order_id', orderId);

                  console.log('[Stripe Webhook] ✅ Linked job to order metadata');
                } catch (metaErr: any) {
                  console.error('[Stripe Webhook] Failed to update order metadata:', metaErr);
                }
              }
            }
          }
        } catch (jobCreateErr: any) {
          console.error('[Stripe Webhook] Job creation exception:', jobCreateErr);
          // Continue - webhook should not fail if job creation fails
        }
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

import Stripe from 'stripe';
import { getSupabase } from '@/lib/supabase';
import { stripeForMode, requireTransactions, recordSession, paymentRecord, salesChecked, flow, identifier, BusinessError } from '@/lib/fieldCommerce';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const supported = new Set(['checkout.session.completed','checkout.session.async_payment_succeeded','checkout.session.async_payment_failed',
  'checkout.session.expired','payment_intent.succeeded','payment_intent.payment_failed','payment_intent.canceled',
  'charge.refunded','charge.dispute.created','charge.dispute.updated','charge.dispute.closed','refund.updated','refund.failed']);
export async function POST(request: Request) {
  try {
    requireTransactions();
    const signature = request.headers.get('stripe-signature');
    if (!signature) throw new BusinessError('Stripe signature required.', 400);
    const raw = await request.text();
    let event: Stripe.Event | undefined, stripe: Stripe | undefined;
    const modes = ['test', ...(process.env.H2S_FIELD_STRIPE_LIVE_ENABLED === 'true' ? ['live'] : [])] as Array<'test' | 'live'>;
    let configured = false;
    for (const mode of modes) {
      const secret = mode === 'live' ? process.env.H2S_FIELD_STRIPE_LIVE_WEBHOOK_SECRET : process.env.H2S_FIELD_STRIPE_TEST_WEBHOOK_SECRET;
      if (!secret) continue;
      configured = true;
      const candidate = stripeForMode(mode);
      try {
        const verified = candidate.webhooks.constructEvent(raw, signature, secret);
        if (verified.livemode !== (mode === 'live')) throw new BusinessError('Stripe event mode does not match the configured signature authority.', 400);
        event = verified; stripe = candidate; break;
      } catch (error) { if (error instanceof BusinessError) throw error; }
    }
    if (!configured) throw new BusinessError('Field payment reconciliation is not configured; event must retry.', 503);
    if (!event || !stripe) throw new BusinessError('Invalid Stripe signature.', 400);
    if (!supported.has(event.type)) return Response.json({ received: true, ignored: true });
    const object = event.data.object;
    if (!('id' in object) || typeof object.id !== 'string') throw new BusinessError('Stripe event object identity is missing.', 400);
    const metadata = 'metadata' in object ? object.metadata : null;
    if (process.env.H2S_STAGING_SYNTHETIC_ONLY === 'true' && process.env.VERCEL_ENV === 'preview'
      && !event.livemode && event.type === 'payment_intent.canceled' && metadata
      && 'h2s_staging_run' in metadata && metadata.h2s_staging_run === process.env.H2S_STAGING_SANDBOX_RUN_ID
      && 'h2s_flow' in metadata && metadata.h2s_flow === 'staging_connectivity_probe') {
      salesChecked(await getSupabase().from('h2s_test_webhooks').upsert({
        event_id: event.id, run_id: metadata.h2s_staging_run, type: event.type, livemode: false,
      }, { onConflict: 'event_id' }));
      return Response.json({ received: true, ignored: true, stagingConnectivityOnly: true });
    }
    let checkoutId = metadata && 'h2s_flow' in metadata && metadata.h2s_flow === flow ? identifier(metadata.checkout_id) : null;
    if (!checkoutId) {
      const intentId = event.type.startsWith('payment_intent.') ? object.id :
        'payment_intent' in object ? (typeof object.payment_intent === 'string' ? object.payment_intent : object.payment_intent?.id) : null;
      if (intentId) {
        const payment = salesChecked(await getSupabase().from('field_sales_checkouts').select('checkout_id').eq('payment_intent_id', intentId).maybeSingle());
        checkoutId = payment?.checkout_id || null;
      }
    }
    if (!checkoutId) return Response.json({ received: true, ignored: true });
    const { payment } = await paymentRecord(checkoutId);
    if (event.livemode !== (payment.stripe_mode === 'live')) throw new BusinessError('Event mode does not match the reserved provider mode.', 409);
    let sessionId = event.type.startsWith('checkout.session.') ? object.id : payment.session_id;
    if (!sessionId) {
      const intentId = event.type.startsWith('payment_intent.') ? object.id : null;
      if (!intentId) throw new BusinessError('Checkout binding requires management reconciliation.', 409);
      const sessions = await stripe.checkout.sessions.list({ payment_intent: intentId, limit: 2 });
      if (sessions.data.length !== 1) throw new BusinessError('Stripe checkout relationship is ambiguous.', 409);
      sessionId = sessions.data[0].id;
    }
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    await recordSession(stripe, checkoutId, 'stripe:' + event.id, session, event.type);
    return Response.json({ received: true });
  } catch (error) {
    console.error('Field Stripe reconciliation failed', { type: error instanceof Error ? error.name : 'Unknown' });
    return Response.json({ ok: false, error: error instanceof BusinessError ? error.message : 'Stripe reconciliation failed; retry required.' },
      { status: error instanceof BusinessError ? error.status : 503, headers: { 'Cache-Control': 'no-store' } });
  }
}

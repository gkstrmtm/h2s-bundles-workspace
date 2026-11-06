import { timingSafeEqual } from 'node:crypto';
import { fieldStripe } from '@/lib/fieldCommerce';
import { getSupabase } from '@/lib/supabase';
import { stagingSandboxIdentity } from '@/lib/stagingSandbox';

export const runtime = 'nodejs';
export const maxDuration = 120;
export async function POST(request: Request) {
  const expected = process.env.H2S_STAGING_CERTIFICATION_TOKEN || '';
  const supplied = request.headers.get('x-h2s-certification') || '';
  const expires = Number(process.env.H2S_STAGING_CERTIFICATION_EXPIRES || '0');
  if (!/^[a-f0-9]{64}$/.test(expected) || supplied.length !== expected.length
    || !timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))
    || !Number.isFinite(expires) || expires <= Date.now() || expires > Date.now() + 2 * 3600000
    || process.env.VERCEL_ENV !== 'preview') return Response.json({ ok: false }, { status: 404 });
  let phase = 'test scope';
  try {
    const run = stagingSandboxIdentity();
    if (!run) throw Error('Verified private run required');
    const body: unknown = await request.json();
    if (!body || typeof body !== 'object' || !('action' in body)) {
      return Response.json({ ok: false, error: 'Exact certification action required' }, { status: 400 });
    }
    const stripe = fieldStripe(), endpointId = 'we_1UYbioLuMP6aPhGZBXa9lU79';
    const account = await stripe.accounts.retrieve();
    if (account.id !== 'acct_1KgfHxLuMP6aPhGZ') throw Error('Unexpected Stripe account');
    if (body.action === 'resume' || body.action === 'pause') {
      phase = 'test endpoint';
      const current = await stripe.webhookEndpoints.retrieve(endpointId);
      if (current.livemode || new URL(current.url).hostname !== 'h2s-staging-backend-tabari-ropers-projects-6f2e090b.vercel.app'
        || new URL(current.url).pathname !== '/api/field-sales-stripe-webhook') throw Error('Exact test endpoint required');
      const endpoint = await stripe.webhookEndpoints.update(endpointId, { disabled: body.action === 'pause' });
      return Response.json({ ok: true, runId: run.runId, endpointId, status: endpoint.status, livemode: endpoint.livemode });
    }
    if (body.action !== 'inspect_checkout' || !('checkoutId' in body) || typeof body.checkoutId !== 'string'
      || !/^[a-f0-9-]{36}$/.test(body.checkoutId)) {
      return Response.json({ ok: false, error: 'Exact scoped checkout required' }, { status: 400 });
    }
    phase = 'native checkout';
    const row = await getSupabase().from('field_sales_checkouts').select('*').eq('checkout_id', body.checkoutId).single();
    if (row.error || !row.data?.session_id || row.data.stripe_mode !== 'test') throw Error('Native test checkout is unavailable');
    phase = 'provider verification';
    const session = await stripe.checkout.sessions.retrieve(row.data.session_id);
    if (session.livemode || session.metadata?.checkout_id !== row.data.checkout_id
      || session.metadata?.quote_id !== row.data.quote_id) throw Error('Provider relationship mismatch');
    const events = await stripe.events.list({ type: 'checkout.session.completed', limit: 100,
      created: { gte: Math.floor(Date.parse(row.data.created_at) / 1000) - 5 } });
    const event = events.data.find(e => 'id' in e.data.object && e.data.object.id === session.id);
    const intent = session.payment_intent
      ? await stripe.paymentIntents.retrieve(typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent.id,
        { expand: ['latest_charge.balance_transaction'] }) : null;
    const charge = intent && typeof intent.latest_charge !== 'string' ? intent.latest_charge : null;
    const fee = charge && typeof charge.balance_transaction !== 'string' ? charge.balance_transaction : null;
    return Response.json({ ok: true, runId: run.runId, checkoutId: row.data.checkout_id,
      sessionId: session.id, livemode: session.livemode, amountTotal: session.amount_total,
      paymentStatus: session.payment_status, status: session.status,
      intentId: intent?.id, amountReceived: intent?.amount_received, chargeId: charge?.id,
      feeCents: fee?.fee, balanceTransactionId: fee?.id,
      actualStripeEvent: event ? { id: event.id, type: event.type, pendingWebhooks: event.pending_webhooks } : null,
      externalTransferInitiated: false }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Staging certification request failed', { phase, type: error instanceof Error ? error.name : 'Unknown' });
    return Response.json({ ok: false, phase, error: 'Native/provider certification operation failed; no success is implied' },
      { status: 503 });
  }
}

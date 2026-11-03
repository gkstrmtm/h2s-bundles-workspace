import { createHash, createHmac } from 'node:crypto';
import Stripe from 'stripe';
import { getSupabase } from '@/lib/supabase';
import { salesAccess, salesActor, salesChecked, ownedOpportunity, BusinessError, identifier, readJson, text } from '@/lib/fieldSales';
import { calculateFieldQuote, QuoteCatalog } from '@/lib/fieldQuote';
export { salesActor, salesChecked, BusinessError, identifier, readJson, text };
export const flow = 'field_sales_v1';
export const transactionEnabled = () => process.env.H2S_FIELD_TRANSACTIONS_ENABLED === 'true';
export function requireTransactions() {
  if (!transactionEnabled()) throw new BusinessError('Field Sales transactions are disabled. No checkout or agreement was activated.', 503);
}
export async function commerceActor(request: Request) {
  const actor = await salesActor(request); requireTransactions(); await salesAccess(actor.userId); return actor;
}
export async function transactionRead(actor: string, leadId: string | null) {
  return salesChecked(await getSupabase().rpc('field_sales_transaction_read', { p_actor: actor, p_lead: leadId }));
}
export function customerToken(agreementId: string, quoteHash: string) {
  const key = process.env.H2S_FIELD_AGREEMENT_TOKEN_KEY || '';
  if (key.length < 32) throw new BusinessError('Secure customer agreement handoff is not configured.', 503);
  return createHmac('sha256', key).update(flow + ':' + agreementId + ':' + quoteHash).digest('hex');
}
export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
export function frontendOrigin() {
  const raw = process.env.H2S_FIELD_SALES_ORIGIN;
  if (!raw) throw new BusinessError('Approved Field Sales return origin is not configured.', 503);
  const url = new URL(raw);
  if (url.pathname !== '/' || url.search || url.hash || url.username || url.password
    || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost','127.0.0.1'].includes(url.hostname)))) {
    throw new BusinessError('Field Sales return origin is invalid.', 503);
  }
  return url.origin;
}
export function fieldStripe() {
  requireTransactions();
  const key = process.env.H2S_FIELD_STRIPE_TEST_SECRET_KEY || '';
  if (!key.startsWith('sk_test_')) throw new BusinessError('A separate Stripe test-mode credential is required. Live keys are not supported by this phase.', 503);
  return new Stripe(key, { timeout: 25000, maxNetworkRetries: 2 });
}
type Payment = { checkout_id: string; quote_id: string; agreement_id: string; lead_id: string; amount_cents: number | string;
  kind: string; session_id: string | null; created_at: string; expires_at: string; state: string };
type Quote = { quote_id: string; quote_hash: string; snapshot: { totalCents: number }; order_uuid: string };
export function stripeMetadata(payment: Payment, quote: Quote) {
  return { h2s_flow: flow, checkout_id: payment.checkout_id, quote_id: payment.quote_id, agreement_id: payment.agreement_id,
    lead_id: payment.lead_id, quote_hash: quote.quote_hash };
}
export async function verifyFieldSession(stripe: Stripe, payment: Payment, quote: Quote, session: Stripe.Checkout.Session) {
  const expected = stripeMetadata(payment, quote), amount = Number(payment.amount_cents);
  if (session.livemode !== false || session.mode !== 'payment' || session.currency !== 'usd' || session.amount_total !== amount
    || session.client_reference_id !== payment.checkout_id || Object.entries(expected).some(([key, value]) => session.metadata?.[key] !== value)
    || (payment.session_id && payment.session_id !== session.id)) throw new BusinessError('Stripe checkout does not match the reserved quote/customer/amount.', 409);
  let capturedCents = 0, refundedCents = 0, disputed = false, paymentIntentId: string | null = null;
  let paymentIntentStatus: Stripe.PaymentIntent.Status | null = null;
  let state = session.status === 'expired' ? 'expired' : session.status === 'complete' ? 'pending' : 'open';
  if (session.payment_intent) {
    const intent = typeof session.payment_intent === 'string' ? await stripe.paymentIntents.retrieve(session.payment_intent, { expand: ['latest_charge'] }) : session.payment_intent;
    paymentIntentId = intent.id;
    paymentIntentStatus = intent.status;
    if (intent.livemode !== false || intent.amount !== amount || intent.currency !== 'usd'
      || Object.entries(expected).some(([key, value]) => intent.metadata?.[key] !== value)) throw new BusinessError('Stripe payment identity/amount does not match the agreement.', 409);
    if (intent.status === 'succeeded') {
      const charge = typeof intent.latest_charge === 'string' ? await stripe.charges.retrieve(intent.latest_charge) : intent.latest_charge;
      if (!charge || charge.livemode !== false || !charge.paid || !charge.captured || charge.amount !== amount || charge.currency !== 'usd'
        || intent.amount_received !== amount || session.payment_status !== 'paid'
        || (typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id) !== intent.id
        || !Number.isSafeInteger(charge.amount_refunded) || charge.amount_refunded < 0 || charge.amount_refunded > amount) {
        throw new BusinessError('Stripe capture/refund facts require reconciliation.', 409);
      }
      capturedCents = intent.amount_received; refundedCents = charge.amount_refunded; disputed = charge.disputed; state = 'paid';
    } else if (session.status === 'expired') state = 'expired';
    else if (['requires_payment_method','canceled'].includes(intent.status)) state = 'failed';
    else state = 'pending';
  } else if (session.payment_status === 'paid') throw new BusinessError('Paid redirect/session has no verified payment intent.', 409);
  return { ...expected, quoteId: payment.quote_id, agreementId: payment.agreement_id, leadId: payment.lead_id, quoteHash: quote.quote_hash,
    sessionId: session.id, paymentIntentId, amountCents: amount, currency: 'usd', livemode: false, capturedCents, refundedCents, disputed, state,
    checkoutUrl: session.url, paymentIntentStatus, sessionStatus: session.status };
}
export async function paymentRecord(id: string) {
  const payment = salesChecked(await getSupabase().from('field_sales_checkouts').select('*').eq('checkout_id', id).maybeSingle());
  if (!payment) throw new BusinessError('Reserved checkout is unavailable; management reconciliation required.', 404);
  const quote = salesChecked(await getSupabase().from('field_sales_quotes').select('*').eq('quote_id', payment.quote_id).single());
  return { payment: payment as Payment, quote: quote as Quote };
}
export async function recordSession(stripe: Stripe, checkoutId: string, eventId: string, session: Stripe.Checkout.Session, eventType = 'authenticated_verification') {
  const { payment, quote } = await paymentRecord(checkoutId);
  const receipt = await verifyFieldSession(stripe, payment, quote, session);
  return salesChecked(await getSupabase().rpc('field_sales_record_receipt', { p_checkout: checkoutId, p_event: eventId, p_receipt: { ...receipt, sourceEventType: eventType } }));
}
export async function checkout(actor: string, operationId: string, leadId: string, quoteId: string, kind: string) {
  const stripe = fieldStripe(), origin = frontendOrigin();
  const payment = salesChecked(await getSupabase().rpc('field_sales_reserve_checkout', {
    p_actor: actor, p_operation: operationId, p_lead: leadId, p_quote: quoteId, p_kind: kind,
  })) as Payment;
  const { quote } = await paymentRecord(payment.checkout_id);
  let session: Stripe.Checkout.Session;
  if (payment.session_id) session = await stripe.checkout.sessions.retrieve(payment.session_id);
  else {
    if (Date.now() - Date.parse(payment.created_at) > 20 * 3600000 || Date.parse(payment.expires_at) <= Date.now()) {
      throw new BusinessError('Uncertain checkout must be reconciled before another session can be created.', 409);
    }
    await ownedOpportunity(actor, leadId);
    const metadata = stripeMetadata(payment, quote);
    session = await stripe.checkout.sessions.create({ mode: 'payment', client_reference_id: payment.checkout_id,
      expires_at: Math.floor(Date.parse(payment.expires_at) / 1000), metadata, payment_intent_data: { metadata },
      line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: Number(payment.amount_cents),
        product_data: { name: `Home2Smart ${kind} payment - approved quote ${quoteId}` } } }],
      success_url: origin + '/field-agreement.html#checkout-returned', cancel_url: origin + '/field-agreement.html#checkout-cancelled',
    }, { idempotencyKey: flow + ':' + payment.checkout_id });
  }
  const result = await recordSession(stripe, payment.checkout_id, 'verification:' + operationId, session);
  await ownedOpportunity(actor, leadId);
  if (session.url && (!session.url.startsWith('https://checkout.stripe.com/'))) throw new BusinessError('Stripe returned an unexpected checkout destination.', 503);
  return { ...result, checkoutId: payment.checkout_id, checkoutUrl: session.status === 'open' ? session.url : null };
}
export async function command(actor: { userId: string; role: string }, body: Record<string, unknown>) {
  const action = text(body.action, 30), operationId = identifier(body.operationId), leadId = identifier(body.leadId);
  const permitted = ['action','operationId','leadId',...(action === 'quote' ? ['catalogId','lines'] :
    action === 'approve' ? ['quoteId','reason','scopeConfirmation','amountCents'] :
    action === 'reject' ? ['quoteId','reason'] : action === 'checkout' ? ['quoteId','kind'] :
    action === 'refresh_payment' ? ['checkoutId'] : ['quoteId'])];
  if (Object.keys(body).some(key => !permitted.includes(key))) throw new BusinessError('Unsupported transaction field; client totals are not accepted.');
  const snapshot = await transactionRead(actor.userId, leadId);
  let payload: Record<string, unknown>;
  if (action === 'quote') {
    const catalog = (snapshot.catalogs as QuoteCatalog[]).find(c => c.catalog_id === identifier(body.catalogId));
    if (!catalog) throw new BusinessError('Select a configured catalog version.');
    const owned = await ownedOpportunity(actor.userId, leadId);
    payload = { catalogId: catalog.catalog_id, catalogHash: catalog.digest, opportunityRevision: owned.opportunity.revision,
      snapshot: calculateFieldQuote(catalog, body.lines, owned.lead.attribution.market) };
  } else if (action === 'checkout') return checkout(actor.userId, operationId, leadId, identifier(body.quoteId), text(body.kind, 20));
  else if (action === 'refresh_payment') {
    const id = identifier(body.checkoutId), { payment } = await paymentRecord(id);
    if (payment.lead_id !== leadId || !payment.session_id) throw new BusinessError('A linked Stripe session is required for verification.', 409);
    const stripe = fieldStripe(), session = await stripe.checkout.sessions.retrieve(payment.session_id);
    const result = await recordSession(stripe, id, 'verification:' + operationId, session);
    await ownedOpportunity(actor.userId, leadId); return result;
  } else {
    const quoteId = identifier(body.quoteId), quote = snapshot.quotes.find((q: { quote_id: string }) => q.quote_id === quoteId);
    if (!quote) throw new BusinessError('Quote is not available on this assigned inquiry.', 404);
    payload = { quoteId };
    if (['approve','reject'].includes(action)) {
      if (actor.role !== 'ADMIN') throw new BusinessError('Management approval required.', 403);
      payload.reason = text(body.reason, 2000);
      if (action === 'approve') {
        payload.scopeConfirmation = text(body.scopeConfirmation, 6000);
        if (body.amountCents !== undefined) {
          if (!Number.isSafeInteger(body.amountCents) || Number(body.amountCents) < 1 || Number(body.amountCents) > 100000000) throw new BusinessError('Review the approved amount in whole cents.');
          payload.amountCents = body.amountCents;
        }
      }
    }
    const agreement = snapshot.agreements.find((a: { quote_id: string }) => a.quote_id === quoteId);
    if (action === 'agreement_link' || (action === 'agreement' && agreement)) {
      if (!agreement || Date.parse(agreement.expires_at) <= Date.now()) throw new BusinessError('Current agreement link is unavailable.', 409);
      return { agreementUrl: frontendOrigin() + '/field-agreement.html#token=' + customerToken(agreement.agreement_id, quote.quote_hash) };
    }
    if (action === 'agreement') {
      frontendOrigin();
      payload.tokenHash = tokenHash(customerToken(operationId, quote.quote_hash));
    }
  }
  if (!['quote','submit','approve','reject','agreement'].includes(action)) throw new BusinessError('Unsupported transaction action.');
  const result = salesChecked(await getSupabase().rpc('field_sales_transaction_command', {
    p_actor: actor.userId, p_operation: operationId, p_lead: leadId, p_action: action, p_payload: payload,
  }));
  if (action === 'agreement') {
    const quote = snapshot.quotes.find((q: { quote_id: string }) => q.quote_id === body.quoteId);
    return { ...result, agreementUrl: frontendOrigin() + '/field-agreement.html#token=' + customerToken(operationId, quote.quote_hash) };
  }
  return result;
}

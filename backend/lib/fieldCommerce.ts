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
  const result = salesChecked(await getSupabase().rpc('field_sales_transaction_read', { p_actor: actor, p_lead: leadId }));
  if (process.env.H2S_FIELD_WORKFLOW_ENABLED === 'true') {
    const workflow = salesChecked(await getSupabase().rpc('field_sales_workflow_read', { p_actor: actor, p_lead: leadId, p_quote: null }));
    return { ...result, workflows: workflow.workflows };
  }
  return result;
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
  return stripeForMode('test');
}
export type FieldStripeMode = 'test' | 'live';
export function enrolledStripeMode(): FieldStripeMode {
  const mode = process.env.H2S_FIELD_STRIPE_MODE || 'test';
  if (!['test', 'live'].includes(mode)) throw new BusinessError('Explicit Field Stripe mode must be test or live.', 503);
  if (mode === 'live' && process.env.H2S_FIELD_STRIPE_LIVE_ENABLED !== 'true') throw new BusinessError('Distinct Field Stripe live payment gate is disabled.', 503);
  return mode as FieldStripeMode;
}
export function stripeForMode(mode: FieldStripeMode) {
  requireTransactions();
  if (mode === 'live' && process.env.H2S_FIELD_STRIPE_LIVE_ENABLED !== 'true') throw new BusinessError('Distinct Field Stripe live payment gate is disabled.', 503);
  const key = (mode === 'live' ? process.env.H2S_FIELD_STRIPE_LIVE_SECRET_KEY : process.env.H2S_FIELD_STRIPE_TEST_SECRET_KEY) || '';
  if (!key.startsWith(mode === 'live' ? 'sk_live_' : 'sk_test_')) throw new BusinessError(`A separate Stripe ${mode}-mode credential matching the selected mode is required.`, 503);
  return new Stripe(key, { timeout: 25000, maxNetworkRetries: 2 });
}
type Payment = { checkout_id: string; quote_id: string; agreement_id: string; lead_id: string; amount_cents: number | string;
  kind: string; session_id: string | null; payment_intent_id?: string | null; created_at: string; expires_at: string; state: string; stripe_mode?: FieldStripeMode };
type Quote = { quote_id: string; quote_hash: string; snapshot: { totalCents: number }; order_uuid: string };
export function stripeMetadata(payment: Payment, quote: Quote) {
  return { h2s_flow: flow, checkout_id: payment.checkout_id, quote_id: payment.quote_id, agreement_id: payment.agreement_id,
    lead_id: payment.lead_id, quote_hash: quote.quote_hash };
}
export async function verifyFieldSession(stripe: Stripe, payment: Payment, quote: Quote, session: Stripe.Checkout.Session) {
  const expected = stripeMetadata(payment, quote), amount = Number(payment.amount_cents);
  const live = payment.stripe_mode === 'live';
  if (live && process.env.H2S_FIELD_STRIPE_LIVE_ENABLED !== 'true') throw new BusinessError('Live receipt reconciliation is disabled; event must retry.', 503);
  if (session.livemode !== live || session.mode !== 'payment' || session.currency !== 'usd' || session.amount_total !== amount
    || session.client_reference_id !== payment.checkout_id || Object.entries(expected).some(([key, value]) => session.metadata?.[key] !== value)
    || (payment.session_id && payment.session_id !== session.id)) throw new BusinessError('Stripe checkout does not match the reserved quote/customer/amount.', 409);
  let capturedCents = 0, refundedCents = 0, disputed = false, paymentIntentId: string | null = null;
  let processingFeeCents: number | null = null, processingFeeEvidence: Record<string, unknown> | null = null;
  let paymentIntentStatus: Stripe.PaymentIntent.Status | null = null;
  let state = session.status === 'expired' ? 'expired' : session.status === 'complete' ? 'pending' : 'open';
  if (session.payment_intent) {
    const intent = typeof session.payment_intent === 'string' ? await stripe.paymentIntents.retrieve(session.payment_intent, { expand: ['latest_charge'] }) : session.payment_intent;
    paymentIntentId = intent.id;
    paymentIntentStatus = intent.status;
    if (intent.livemode !== live || intent.amount !== amount || intent.currency !== 'usd'
      || Object.entries(expected).some(([key, value]) => intent.metadata?.[key] !== value)) throw new BusinessError('Stripe payment identity/amount does not match the agreement.', 409);
    if (intent.status === 'succeeded') {
      const charge = typeof intent.latest_charge === 'string' ? await stripe.charges.retrieve(intent.latest_charge) : intent.latest_charge;
      if (!charge || charge.livemode !== live || !charge.paid || !charge.captured || charge.amount !== amount || charge.currency !== 'usd'
        || intent.amount_received !== amount || session.payment_status !== 'paid'
        || (typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id) !== intent.id
        || !Number.isSafeInteger(charge.amount_refunded) || charge.amount_refunded < 0 || charge.amount_refunded > amount) {
        throw new BusinessError('Stripe capture/refund facts require reconciliation.', 409);
      }
      capturedCents = intent.amount_received; refundedCents = charge.amount_refunded; disputed = charge.disputed; state = 'paid';
      if (charge.balance_transaction) {
        const balance = typeof charge.balance_transaction === 'string'
          ? await stripe.balanceTransactions.retrieve(charge.balance_transaction) : charge.balance_transaction;
        const source = typeof balance.source === 'string' ? balance.source : balance.source?.id;
        if (source !== charge.id || balance.currency !== 'usd' || balance.amount !== amount
          || !Number.isSafeInteger(balance.fee) || balance.fee < 0 || balance.net !== balance.amount - balance.fee) {
          throw new BusinessError('Stripe processing fee identity/amount requires reconciliation.', 409);
        }
        processingFeeCents = balance.fee;
        processingFeeEvidence = { verified: true, source: 'stripe.balance_transaction', balanceTransactionId: balance.id,
          chargeId: charge.id, paymentIntentId: intent.id, amountCents: balance.amount, feeCents: balance.fee,
          netCents: balance.net, currency: balance.currency, feeDetails: balance.fee_details, livemode: live };
      }
    } else if (session.status === 'expired') state = 'expired';
    else if (['requires_payment_method','canceled'].includes(intent.status)) state = 'failed';
    else state = 'pending';
  } else if (session.payment_status === 'paid') throw new BusinessError('Paid redirect/session has no verified payment intent.', 409);
  return { ...expected, quoteId: payment.quote_id, agreementId: payment.agreement_id, leadId: payment.lead_id, quoteHash: quote.quote_hash,
    sessionId: session.id, paymentIntentId, amountCents: amount, currency: 'usd', livemode: live, capturedCents, refundedCents, disputed, state,
    processingFeeCents, processingFeeEvidence, checkoutUrl: session.url, paymentIntentStatus, sessionStatus: session.status };
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
  const origin = frontendOrigin();
  const enrolled = process.env.H2S_FIELD_WORKFLOW_ENABLED === 'true'
    ? salesChecked(await getSupabase().from('field_sales_workflows').select('quote_id').eq('quote_id', quoteId).maybeSingle()) : null;
  const mode = enrolled ? enrolledStripeMode() : 'test', stripe = stripeForMode(mode);
  const payment = salesChecked(await getSupabase().rpc('field_sales_reserve_checkout', {
    p_actor: actor, p_operation: operationId, p_lead: leadId, p_quote: quoteId, p_kind: kind,
  })) as Payment;
  if (enrolled) {
    salesChecked(await getSupabase().rpc('field_sales_workflow_bind_mode', { p_actor: actor, p_checkout: payment.checkout_id, p_mode: mode }));
    payment.stripe_mode = mode;
  }
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
export async function customerPayment(token: string, body: Record<string, unknown>) {
  if (process.env.H2S_FIELD_WORKFLOW_ENABLED !== 'true') throw new BusinessError('Customer payment handoff is disabled.', 503);
  const action = text(body.action, 30);
  const permitted = action === 'checkout' ? ['action','operationId','kind'] : ['action','operationId','checkoutId'];
  if (!['checkout','refresh_payment'].includes(action) || Object.keys(body).some(key => !permitted.includes(key))) throw new BusinessError('Unsupported customer payment field.');
  const operationId = identifier(body.operationId);
  const context = salesChecked(await getSupabase().rpc('field_sales_workflow_customer_context', { p_token_hash: tokenHash(token) }));
  if (action === 'checkout') {
    const kind = text(body.kind, 20);
    if (!['deposit','balance'].includes(kind)) throw new BusinessError('Choose the eligible deposit or post-installation balance.');
    return checkout(context.actorId, operationId, context.leadId, context.quoteId, kind);
  }
  const checkoutId = identifier(body.checkoutId), { payment } = await paymentRecord(checkoutId);
  if (payment.quote_id !== context.quoteId || !payment.session_id) throw new BusinessError('Exact customer checkout relationship required.', 403);
  const stripe = stripeForMode(payment.stripe_mode || 'test'), session = await stripe.checkout.sessions.retrieve(payment.session_id);
  return recordSession(stripe, checkoutId, 'verification:' + operationId, session);
}
export async function refundFieldPayment(actor: string, operationId: string, checkoutId: string, amountCents: unknown, evidence: unknown) {
  if (!Number.isSafeInteger(amountCents) || Number(amountCents) < 1) throw new BusinessError('Approved refund amount must be whole cents.');
  const reservation = salesChecked(await getSupabase().rpc('field_sales_workflow_reserve_refund', {
    p_actor: actor, p_operation: operationId, p_checkout: checkoutId, p_amount: amountCents, p_evidence: evidence,
  }));
  const { payment } = await paymentRecord(checkoutId);
  if (!payment.session_id || !payment.payment_intent_id) throw new BusinessError('Refund requires a linked provider checkout and captured intent.', 409);
  const stripe = stripeForMode(payment.stripe_mode || 'test');
  const refund = reservation.provider_refund_id
    ? await stripe.refunds.retrieve(reservation.provider_refund_id)
    : await stripe.refunds.create({ payment_intent: payment.payment_intent_id,
      amount: Number(amountCents), metadata: { h2s_flow: flow, checkout_id: checkoutId, operation_id: operationId } },
    { idempotencyKey: flow + ':refund:' + operationId });
  const intent = typeof refund.payment_intent === 'string' ? refund.payment_intent : refund.payment_intent?.id;
  const receipt = { refundId: refund.id, paymentIntentId: intent, amountCents: refund.amount, currency: refund.currency,
    livemode: payment.stripe_mode === 'live', status: refund.status };
  salesChecked(await getSupabase().rpc('field_sales_workflow_refund_result', { p_actor: actor, p_operation: operationId, p_receipt: receipt }));
  const session = await stripe.checkout.sessions.retrieve(payment.session_id);
  const verified = await recordSession(stripe, checkoutId, 'refund-verification:' + operationId, session);
  const result = salesChecked(await getSupabase().rpc('field_sales_workflow_refund_result', { p_actor: actor, p_operation: operationId, p_receipt: receipt }));
  return { refund: result, ...verified, providerVerificationRequired: result.state !== 'verified' };
}
export async function command(actor: { userId: string; role: string }, body: Record<string, unknown>) {
  const action = text(body.action, 30), operationId = identifier(body.operationId), leadId = identifier(body.leadId);
  const permitted = ['action','operationId','leadId',...(action === 'quote' ? ['catalogId','lines'] :
    action === 'approve' ? ['quoteId','reason','scopeConfirmation','amountCents'] :
    action === 'reject' ? ['quoteId','reason'] : action === 'checkout' ? ['quoteId','kind'] :
    action === 'refresh_payment' || action === 'expire_checkout' ? ['checkoutId'] :
    action === 'refund' ? ['checkoutId','amountCents','evidence'] : ['quoteId'])];
  if (Object.keys(body).some(key => !permitted.includes(key))) throw new BusinessError('Unsupported transaction field; client totals are not accepted.');
  const snapshot = await transactionRead(actor.userId, leadId);
  let payload: Record<string, unknown>;
  if (action === 'refund' || action === 'expire_checkout') {
    if (actor.role !== 'ADMIN' || process.env.H2S_FIELD_WORKFLOW_ENABLED !== 'true') throw new BusinessError('Enabled management workflow authority required.', 403);
    const checkoutId = identifier(body.checkoutId), { payment } = await paymentRecord(checkoutId);
    if (payment.lead_id !== leadId) throw new BusinessError('Exact assigned payment required.', 404);
    const enrolled = salesChecked(await getSupabase().from('field_sales_workflows').select('quote_id').eq('quote_id', payment.quote_id).maybeSingle());
    if (!enrolled) throw new BusinessError('This operation is restricted to enrolled sales.', 403);
    if (action === 'refund') return refundFieldPayment(actor.userId, operationId, checkoutId, body.amountCents, body.evidence);
    if (!payment.session_id) throw new BusinessError('Uncertain provider creation must be reconciled before cancellation.', 409);
    const stripe = stripeForMode(payment.stripe_mode || 'test');
    let session = await stripe.checkout.sessions.retrieve(payment.session_id);
    if (session.status === 'open') session = await stripe.checkout.sessions.expire(session.id);
    return recordSession(stripe, checkoutId, 'expiration:' + operationId, session);
  }
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
    const stripe = stripeForMode(payment.stripe_mode || 'test'), session = await stripe.checkout.sessions.retrieve(payment.session_id);
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
      const workflow = snapshot.workflows?.find((w: { quoteId: string }) => w.quoteId === quoteId);
      if (workflow && agreement?.accepted_at) {
        const minutes = Number(process.env.H2S_FIELD_AGREEMENT_HANDOFF_MINUTES);
        if (!Number.isSafeInteger(minutes) || minutes < 1 || minutes > 1440) throw new BusinessError('Finite customer balance/document capability lifespan is not configured.', 503);
        const token = customerToken(operationId, quote.quote_hash);
        const renewed = salesChecked(await getSupabase().rpc('field_sales_workflow_renew_handoff', {
          p_actor: actor.userId, p_operation: operationId, p_quote: quoteId, p_token_hash: tokenHash(token), p_minutes: minutes,
        }));
        return { ...renewed, agreementUrl: frontendOrigin() + '/field-agreement.html#token=' + token };
      }
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

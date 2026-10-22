import Stripe from 'stripe';

export type CommercialPaymentOrder = {
  total: number | string | null;
  currency: string | null;
  session_id: string | null;
  payment_intent_id: string | null;
};

// Order.status is also written by older checkout/admin paths. It is not proof of payment.
export async function verifyCommercialPayment(order: CommercialPaymentOrder, stripe: Stripe | null) {
  if (!stripe) return { status: 'unavailable', detail: 'Stripe verification is not configured.' };
  const amount = Number(order.total);
  const cents = Math.round(amount * 100);
  const currency = String(order.currency || '').toLowerCase();
  if (!Number.isFinite(amount) || amount <= 0 || Math.abs(cents - amount * 100) > 0.00001 || !/^[a-z]{3}$/.test(currency)) {
    return { status: 'unverified', detail: 'Order amount/currency requires reconciliation.' };
  }
  let intentId = order.payment_intent_id;
  if (order.session_id) {
    const session = await stripe.checkout.sessions.retrieve(order.session_id);
    if (session.amount_total !== cents || session.currency !== currency) {
      return { status: 'unverified', detail: 'Stripe checkout amount/currency does not match the linked order.' };
    }
    const sessionIntent = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
    if (intentId && sessionIntent && intentId !== sessionIntent) {
      return { status: 'unverified', detail: 'Order and checkout payment references disagree.' };
    }
    intentId = sessionIntent || intentId;
    if (!intentId) return { status: 'unpaid', detail: 'No completed Stripe payment is recorded.' };
  }
  if (!intentId) return { status: 'unverified', detail: 'No Stripe payment reference is recorded.' };
  const intent = await stripe.paymentIntents.retrieve(intentId, { expand: ['latest_charge'] });
  if (intent.currency !== currency || intent.amount !== cents) {
    return { status: 'unverified', detail: 'Stripe payment amount/currency does not match the linked order.' };
  }
  if (intent.status !== 'succeeded' || intent.amount_received !== cents) {
    return { status: 'unpaid', detail: `Stripe payment state: ${intent.status}.` };
  }
  const charge = intent.latest_charge;
  if (!charge || typeof charge === 'string') {
    return { status: 'unverified', detail: 'Charge/refund verification is unavailable.' };
  }
  if (charge.disputed) return { status: 'disputed', detail: 'Stripe reports a disputed charge.' };
  if (charge.amount_refunded > 0) return {
    status: charge.amount_refunded >= cents ? 'refunded' : 'partially_refunded',
    detail: 'Stripe reports a refund; the original payment is not the outstanding balance.',
  };
  return { status: 'paid', detail: 'Full order payment verified with Stripe; no recorded refund or dispute.', checkedAt: new Date().toISOString() };
}

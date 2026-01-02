import fs from 'fs';
import Stripe from 'stripe';

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const txt = fs.readFileSync(filePath, 'utf8');
  const out = {};
  for (const line of txt.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

async function readJson(resp) {
  const text = await resp.text();
  try {
    return JSON.parse(text);
  } catch {
    return { __raw: text };
  }
}

async function main() {
  const env = loadEnvFile('.env.local');
  const stripeKey = String(env.STRIPE_SECRET_KEY || '').trim();
  if (!stripeKey) {
    throw new Error('STRIPE_SECRET_KEY not found in backend/.env.local. Run `vercel env pull .env.local` in backend/.');
  }

  const stripe = new Stripe(stripeKey, { apiVersion: '2025-12-15.clover' });

  const BASE = process.env.HOST || 'https://h2s-backend.vercel.app';
  const api = `${BASE}/api`;

  const bundlesData = await readJson(await fetch(`${api}/bundles-data`));
  const bundles = Array.isArray(bundlesData?.bundles) ? bundlesData.bundles : [];
  if (!bundles.length) throw new Error('No bundles returned from /api/bundles-data');

  const title = (b) => b?.name || b?.title || b?.bundle_id || 'Bundle';
  const tv =
    bundles.find((b) => String(title(b)).toLowerCase().includes('tv')) ||
    bundles.find((b) => String(title(b)).toLowerCase().includes('mount')) ||
    bundles[0];

  if (!tv?.stripe_price_id) throw new Error('Selected bundle missing stripe_price_id');

  const unitAmount = Math.round(Number(tv?.bundle_price || 0) * 100);
  if (!unitAmount || unitAmount <= 0) throw new Error('Selected bundle missing/invalid bundle_price');

  const promoLineItems = [{ price: tv.stripe_price_id, unit_amount: unitAmount, quantity: 1 }];

  console.log('HOST', BASE);
  console.log('Picked bundle', {
    name: title(tv),
    bundle_id: tv.bundle_id,
    stripe_price_id: tv.stripe_price_id,
    bundle_price: tv.bundle_price,
    currency: tv.currency,
  });

  const promoCodes = (await stripe.promotionCodes.list({ active: true, limit: 100 })).data || [];
  console.log('Active Stripe promotion codes:', promoCodes.length);

  let chosen = null;
  for (const pc of promoCodes) {
    const code = String(pc?.code || '').trim();
    if (!code) continue;

    const resp = await fetch(`${api}/shop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ __action: 'promo_check_cart', promotion_code: code, line_items: promoLineItems }),
    });

    const data = await readJson(resp);
    const savings = Number(data?.estimate?.savings_cents || 0);

    if (resp.status === 200 && data?.ok && data?.applicable && savings > 0) {
      chosen = {
        code,
        savings_cents: savings,
        subtotal_cents: Number(data?.estimate?.subtotal_cents || 0),
        total_cents: Number(data?.estimate?.total_cents || 0),
      };
      console.log('Chosen promo (applies to cart):', chosen);
      break;
    }
  }

  if (!chosen) {
    console.log('No active promo code applied to this cart. (Promo endpoint works; there may simply be no applicable codes.)');
    process.exit(2);
  }

  const checkoutResp = await fetch(`${api}/shop`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      __action: 'create_checkout_session',
      line_items: [{ price: tv.stripe_price_id, quantity: 1 }],
      customer_email: 'test-customer@home2smart.com',
      promotion_code: chosen.code,
      success_url: 'https://home2smart.com/bundles?view=shopsuccess&session_id={CHECKOUT_SESSION_ID}',
      cancel_url: 'https://home2smart.com/bundles',
      metadata: {
        bundle_id: tv.bundle_id,
        bundle_title: title(tv),
        promotion_code: chosen.code,
      },
    }),
  });

  const checkoutData = await readJson(checkoutResp);
  const sessionId = checkoutData?.pay?.session_id;

  console.log('create_checkout_session', checkoutResp.status, 'ok', checkoutData?.ok, 'session_id', sessionId);
  if (!sessionId) {
    console.log('checkout response', checkoutData);
    process.exit(1);
  }

  const session = await stripe.checkout.sessions.retrieve(sessionId);
  const lineItems = await stripe.checkout.sessions.listLineItems(sessionId, {
    limit: 10,
    expand: ['data.price.product'],
  });

  console.log('Stripe session totals (cents):', {
    amount_subtotal: session.amount_subtotal,
    amount_total: session.amount_total,
    currency: session.currency,
  });

  console.log(
    'Stripe line items:',
    (lineItems.data || []).map((li) => ({
      description: li.description,
      quantity: li.quantity,
      unit_amount: li.price?.unit_amount,
      amount_total: li.amount_total,
    }))
  );

  const packResp = await fetch(`${api}/shop?action=orderpack&session_id=${encodeURIComponent(sessionId)}`);
  const pack = await readJson(packResp);
  console.log('orderpack', packResp.status, 'ok', pack?.ok, {
    total: pack?.summary?.total,
    discount_code: pack?.summary?.discount_code,
    lines: Array.isArray(pack?.lines) ? pack.lines.length : null,
  });
  if (Array.isArray(pack?.lines) && pack.lines[0]) console.log('orderpack line0', pack.lines[0]);

  const detailsResp = await fetch(`${api}/get-order-details?session_id=${encodeURIComponent(sessionId)}`);
  const details = await readJson(detailsResp);
  console.log('get-order-details', detailsResp.status, 'ok', details?.ok, {
    amount_total: details?.order?.amount_total,
    order_value: details?.order?.order_value,
    discount_code: details?.order?.discount_code,
    items: Array.isArray(details?.order?.items) ? details.order.items.length : null,
    source: details?.order?.source,
  });
}

main().catch((e) => {
  console.error('FATAL', e?.message || String(e));
  process.exit(1);
});

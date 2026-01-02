/*
  Terminal-side promo/cart audit for Home2Smart bundles.

  Usage:
    node tools/h2s-promo-cart-audit.js --code YOURCODE

  Options:
    --code <PROMO>
    --html <path/to/bundles.html>   (default: Home2Smart-Dashboard/bundles.html)
    --bundle <bundle_id>           (optional; else picks first priced bundle)

  What it does:
    - Reads SHOP_ORIGIN + SCHED_ORIGIN from bundles.html (the same origins used by the fetch shim)
    - Fetches /api/bundles-data from SCHED_ORIGIN
    - Builds a Stripe-like line_items array from one bundle
    - Calls:
        GET  /api/promo_validate?code=...
        POST /api/shop { __action:'promo_check_cart', promotion_code, line_items }
    - Prints raw HTTP status + JSON bodies and compares subtotal math.
*/

const fs = require('node:fs');
const path = require('node:path');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      out[key] = next;
      i++;
    } else {
      out[key] = true;
    }
  }
  return out;
}

function extractOriginsFromHtml(htmlText) {
  const pick = (re) => {
    const m = htmlText.match(re);
    return m ? m[1] : '';
  };
  const shop = pick(/\bvar\s+SHOP_ORIGIN\s*=\s*'([^']+)'/);
  const sched = pick(/\bvar\s+SCHED_ORIGIN\s*=\s*'([^']+)'/);
  const old = pick(/\bvar\s+OLD_ORIGIN\s*=\s*'([^']+)'/);
  return {
    SHOP_ORIGIN: shop || old,
    SCHED_ORIGIN: sched || old,
    OLD_ORIGIN: old,
  };
}

async function fetchJson(url, init) {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: {
      Accept: 'application/json',
      ...(init && init.headers ? init.headers : {}),
    },
    ...init,
  });

  const contentType = res.headers.get('content-type') || '';
  const text = await res.text();

  let json = null;
  try {
    json = JSON.parse(text);
  } catch (_) {}

  return { res, contentType, text, json };
}

function pickBundle(catalog, wantedId) {
  const bundles = Array.isArray(catalog?.bundles) ? catalog.bundles : [];
  if (wantedId) {
    return bundles.find((b) => String(b.bundle_id) === String(wantedId)) || null;
  }
  const candidates = bundles.filter((b) => {
    if (!b) return false;
    const priceId = b.stripe_price_id || b.stripe_price || b.price_id || b.stripePriceId;
    const price = Number(
      b.bundle_price ??
      b.price ??
      b.amount ??
      b.unit_price ??
      b.display_price ??
      0
    );
    return Boolean(priceId) && Number.isFinite(price) && price > 0;
  });
  return candidates[0] || null;
}

function buildLineItemsFromBundle(bundle) {
  const priceId = bundle?.stripe_price_id || bundle?.stripe_price || bundle?.price_id || bundle?.stripePriceId;
  const bundlePrice = Number(
    bundle?.bundle_price ??
    bundle?.price ??
    bundle?.amount ??
    bundle?.unit_price ??
    bundle?.display_price ??
    0
  );
  const unitAmount = Math.round(100 * bundlePrice);
  if (!priceId || !unitAmount) return [];
  return [{ price: priceId, unit_amount: unitAmount, quantity: 1 }];
}

function cents(n) {
  return Math.round(Number(n || 0));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const code = (args.code || '').trim();
  if (!code) {
    console.error('Missing --code');
    console.error('Example: node tools/h2s-promo-cart-audit.js --code SAVE10');
    process.exit(2);
  }

  const htmlPath = path.resolve(process.cwd(), args.html || 'Home2Smart-Dashboard/bundles.html');
  if (!fs.existsSync(htmlPath)) {
    console.error('bundles.html not found at:', htmlPath);
    process.exit(2);
  }

  const htmlText = fs.readFileSync(htmlPath, 'utf8');
  const { SHOP_ORIGIN, SCHED_ORIGIN, OLD_ORIGIN } = extractOriginsFromHtml(htmlText);
  if (!SHOP_ORIGIN || !SCHED_ORIGIN) {
    console.error('Could not extract origins from bundles.html');
    console.error('Found:', { SHOP_ORIGIN, SCHED_ORIGIN, OLD_ORIGIN });
    process.exit(2);
  }

  console.log('[Origins]');
  console.log('  SHOP_ORIGIN :', SHOP_ORIGIN);
  console.log('  SCHED_ORIGIN:', SCHED_ORIGIN);
  console.log('  OLD_ORIGIN  :', OLD_ORIGIN || '(none)');

  // The page fetches /api/bundles-data first, but falls back to /api/shop?action=catalog
  // when bundles-data is missing or incomplete. Mirror that behavior.
  let catalog = null;

  const bundlesDataUrl = new URL('/api/bundles-data', SCHED_ORIGIN).toString();
  console.log('\n[Fetch] bundles-data:', bundlesDataUrl);
  const bundlesData = await fetchJson(bundlesDataUrl, { method: 'GET' });
  console.log('  HTTP:', bundlesData.res.status, bundlesData.res.statusText);
  console.log('  content-type:', bundlesData.contentType || '(none)');

  if (bundlesData.res.ok) {
    catalog = bundlesData.json?.catalog || bundlesData.json?.data?.catalog || bundlesData.json?.payload?.catalog || null;
  }

  const bundlesLen = Array.isArray(catalog?.bundles) ? catalog.bundles.length : 0;
  const servicesLen = Array.isArray(catalog?.services) ? catalog.services.length : 0;

  if (!catalog || (bundlesLen === 0 && servicesLen === 0)) {
    const fallbackUrl = new URL('/api/shop', SHOP_ORIGIN);
    fallbackUrl.searchParams.set('action', 'catalog');
    console.log('\n[Fallback] shop?action=catalog:', fallbackUrl.toString());
    const fallback = await fetchJson(fallbackUrl.toString(), { method: 'GET' });
    console.log('  HTTP:', fallback.res.status, fallback.res.statusText);
    console.log('  content-type:', fallback.contentType || '(none)');
    if (!fallback.res.ok) {
      console.error('\n[Error] Fallback catalog request failed. Body (first 500 chars):');
      console.error(String(fallback.text || '').slice(0, 500));
      process.exit(1);
    }
    if (!fallback.json?.ok || !fallback.json?.catalog) {
      console.error('\n[Error] Fallback returned unexpected JSON:', fallback.json);
      process.exit(1);
    }
    catalog = fallback.json.catalog;
  }

  const bundle = pickBundle(catalog, args.bundle);
  if (!bundle) {
    console.error('\n[Error] Could not auto-pick a bundle with Stripe price id + numeric price.');
    const bundles = Array.isArray(catalog?.bundles) ? catalog.bundles : [];
    console.error('Tip: pass --bundle <bundle_id>. Available bundle_id values (first 25):');
    const rows = bundles.slice(0, 25).map((b) => {
      const id = b?.bundle_id ?? b?.id ?? '(missing bundle_id)';
      const name = b?.name ?? b?.title ?? '';
      const priceId = b?.stripe_price_id || b?.stripe_price || b?.price_id || b?.stripePriceId || '';
      const price = b?.bundle_price ?? b?.price ?? b?.amount ?? b?.unit_price ?? b?.display_price;
      return { id: String(id), name: String(name).slice(0, 48), priceId: String(priceId), price: price };
    });
    console.error(rows);
    process.exit(1);
  }

  const line_items = buildLineItemsFromBundle(bundle);
  if (!line_items.length) {
    console.error('\n[Error] Failed to build line_items from bundle:', bundle.bundle_id);
    process.exit(1);
  }

  const expectedSubtotal = line_items.reduce((sum, li) => sum + cents(li.unit_amount) * cents(li.quantity), 0);
  console.log('\n[Cart]');
  console.log('  bundle_id:', bundle.bundle_id);
  console.log('  bundle_name:', bundle.name || bundle.title || '(unnamed)');
  console.log('  stripe_price_id:', bundle.stripe_price_id);
  console.log('  bundle_price:', bundle.bundle_price);
  console.log('  line_items:', JSON.stringify(line_items));
  console.log('  expected subtotal_cents:', expectedSubtotal);

  const promoValidateUrl = new URL('/api/promo_validate', SHOP_ORIGIN);
  promoValidateUrl.searchParams.set('code', code);
  console.log('\n[Fetch] promo_validate:', promoValidateUrl.toString());
  const promoVal = await fetchJson(promoValidateUrl.toString(), { method: 'GET' });
  console.log('  HTTP:', promoVal.res.status, promoVal.res.statusText);
  console.log('  content-type:', promoVal.contentType || '(none)');
  console.log('  json:', promoVal.json);
  if (!promoVal.json) {
    console.log('  body (first 500 chars):', String(promoVal.text || '').slice(0, 500));
  }

  const shopUrl = new URL('/api/shop', SHOP_ORIGIN).toString();
  const body = { __action: 'promo_check_cart', promotion_code: code, line_items };
  console.log('\n[Fetch] promo_check_cart:', shopUrl);
  console.log('  request body:', JSON.stringify(body));
  const promoCheck = await fetchJson(shopUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  console.log('  HTTP:', promoCheck.res.status, promoCheck.res.statusText);
  console.log('  content-type:', promoCheck.contentType || '(none)');
  console.log('  json:', promoCheck.json);
  if (!promoCheck.json) {
    console.log('  body (first 500 chars):', String(promoCheck.text || '').slice(0, 500));
  }

  const est = promoCheck.json?.estimate;
  if (promoCheck.json?.ok && promoCheck.json?.applicable && est) {
    console.log('\n[Estimate sanity]');
    console.log('  estimate.subtotal_cents:', est.subtotal_cents);
    console.log('  estimate.savings_cents :', est.savings_cents);
    console.log('  estimate.total_cents   :', est.total_cents);

    if (typeof est.subtotal_cents === 'number' && est.subtotal_cents !== expectedSubtotal) {
      console.log('\n[Note] Server subtotal_cents != local subtotal (unit_amount sum).');
      console.log('  This often means the backend is not using unit_amount as-is (or taxes/fees/tiers are applied).');
    }
  } else {
    console.log('\n[Result] Promo not applicable or request failed.');
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});

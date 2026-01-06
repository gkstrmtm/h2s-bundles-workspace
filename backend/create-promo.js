const fs = require('fs');
const Stripe = require('stripe');

function readStripeKeyFromEnvFile(envPath) {
  try {
    if (!fs.existsSync(envPath)) return null;
    const envContent = fs.readFileSync(envPath, 'utf8');
    const lines = envContent.split(/\r?\n/);
    const keyLine = lines.find((line) => line && line.trim().startsWith('STRIPE_SECRET_KEY='));
    if (!keyLine) return null;
    const parts = keyLine.split('=');
    if (parts.length < 2) return null;
    let key = parts.slice(1).join('=');
    key = String(key).trim().replace(/^["']|["']$/g, '');
    return key;
  } catch {
    return null;
  }
}

const envPath = process.env.ENV_FILE || '.env.production.local';
let stripeKey = process.env.STRIPE_SECRET_KEY || readStripeKeyFromEnvFile(envPath);

// Clean up the key - remove quotes and whitespace
if (stripeKey) {
  stripeKey = stripeKey.trim().replace(/^["']|["']$/g, '');
}

if (!stripeKey || !stripeKey.startsWith('sk_')) {
  console.error(`❌ Missing/invalid STRIPE_SECRET_KEY (expected in ${envPath} or process env)`);
  console.error('   Tip: run `vercel env pull .env.production.local --environment=production` from the backend folder.');
  process.exit(1);
}

async function createPromoCode() {
  // Pin API version so behavior is consistent regardless of account default.
  const stripe = new Stripe(stripeKey, { apiVersion: '2024-06-20' });
  
  try {
    const CODE = (process.env.PROMO_CODE || 'NEWYEAR50').toUpperCase();
    const AMOUNT_OFF_CENTS = Number(process.env.AMOUNT_OFF_CENTS || 5000);
    const CURRENCY = (process.env.CURRENCY || 'usd').toLowerCase();
    const COUPON_ID = (process.env.COUPON_ID || 'newyear50_50off').toLowerCase();

    // If code already exists, do nothing.
    const existing = await stripe.promotionCodes.list({ code: CODE, limit: 1 });
    if (existing.data && existing.data.length > 0) {
      console.log(`✅ Promo code already exists: ${CODE}`);
      console.log(`   promotion_code_id: ${existing.data[0].id}`);
      return;
    }

    // Create/reuse a deterministic coupon so reruns are idempotent.
    let coupon;
    try {
      coupon = await stripe.coupons.retrieve(COUPON_ID);
      console.log('✅ Coupon already exists:', coupon.id);
    } catch (err) {
      const notFound = err && (err.statusCode === 404 || (err.raw && err.raw.statusCode === 404));
      if (!notFound) throw err;
      console.log(`Creating coupon: $${(AMOUNT_OFF_CENTS / 100).toFixed(2)} off (${CURRENCY.toUpperCase()})...`);
      coupon = await stripe.coupons.create({
        id: COUPON_ID,
        amount_off: AMOUNT_OFF_CENTS,
        currency: CURRENCY,
        duration: 'once',
        name: 'New Year - $50 Off',
      });
      console.log('✅ Coupon created:', coupon.id);
    }

    console.log(`Creating promotion code: ${CODE} ...`);
    const promo = await stripe.promotionCodes.create({
      code: CODE,
      coupon: coupon.id,
    });

    console.log(`✅ Promotion code created: ${promo.code}`);
    console.log(`   promotion_code_id: ${promo.id}`);
    console.log(`   coupon_id: ${coupon.id}`);
    
  } catch (error) {
    console.error('❌ Error:', error && error.message ? error.message : String(error));
    if (error && error.raw) {
      const details = {
        type: error.type,
        code: error.code,
        param: error.raw.param,
        requestId: error.raw.requestId,
        statusCode: error.raw.statusCode,
      };
      console.error('   Details:', details);
    }
    if (error && error.code === 'resource_already_exists') {
      console.log('💡 Code already exists.');
    }
  }
}

createPromoCode();

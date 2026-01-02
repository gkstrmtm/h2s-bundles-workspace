const fs = require('fs');
const Stripe = require('stripe');

const envContent = fs.readFileSync('.env.production.local', 'utf8');
const lines = envContent.split('\n');
const keyLine = lines.find(line => line.includes('STRIPE_SECRET_KEY='));
let stripeKey = keyLine ? keyLine.split('=')[1] : null;

if (stripeKey) {
  stripeKey = stripeKey.trim().replace(/^["']|["']$/g, '');
}

const stripe = new Stripe(stripeKey);

async function listPromos() {
  try {
    const promos = await stripe.promotionCodes.list({ limit: 50 });
    console.log('TOTAL PROMOTION CODES:', promos.data.length);
    console.log('');
    
    if (promos.data.length === 0) {
      console.log('❌ NO PROMOTION CODES FOUND');
      console.log('   You have coupons but no promotion codes.');
      console.log('   Customers need PROMOTION CODES to apply discounts.');
    } else {
      console.log('Available codes:');
      promos.data.forEach(p => {
        const couponId = p.coupon && typeof p.coupon === 'object' ? p.coupon.id : (typeof p.coupon === 'string' ? p.coupon : 'unknown');
        console.log(`  - ${p.code} (Active: ${p.active}, Coupon: ${couponId})`);
      });
    }
  } catch (error) {
    console.error('Error:', error.message);
  }
}

listPromos();

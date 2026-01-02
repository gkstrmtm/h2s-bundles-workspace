const fs = require('fs');
const Stripe = require('stripe');

// Load env vars manually
const envContent = fs.readFileSync('.env.production.local', 'utf8');
const lines = envContent.split('\n');
const keyLine = lines.find(line => line.includes('STRIPE_SECRET_KEY='));
let stripeKey = keyLine ? keyLine.split('=')[1] : null;

// Clean up the key - remove quotes and whitespace
if (stripeKey) {
  stripeKey = stripeKey.trim().replace(/^["']|["']$/g, '');
}

if (!stripeKey || !stripeKey.startsWith('sk_')) {
  console.error('❌ Invalid STRIPE_SECRET_KEY in .env.production.local');
  console.error('   Key starts with:', stripeKey ? stripeKey.substring(0, 10) : 'null');
  process.exit(1);
}

async function createPromoCode() {
  const stripe = new Stripe(stripeKey);
  
  try {
    // Step 1: Create a 100% off coupon
    console.log('Creating 100% off coupon...');
    const coupon = await stripe.coupons.create({
      percent_off: 100,
      duration: 'once',
      name: 'H2S QA Test - 100% Off',
    });
    console.log('✅ Coupon created:', coupon.id);
    
    // Step 2: First get an existing coupon ID from your account
    console.log('\nListing existing coupons...');
    const coupons = await stripe.coupons.list({ limit: 10 });
    console.log('Found coupons:', coupons.data.map(c => ({ id: c.id, name: c.name, percent_off: c.percent_off })));
    
    // Use the coupon we just created
    console.log('\nCreating promotion code for coupon:', coupon.id);
    const response = await fetch('https://api.stripe.com/v1/promotion_codes', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${stripeKey}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        code: 'H2SQA100',
        coupon: coupon.id
      }).toString()
    });
    
    const promoCode = await response.json();
    
    if (!response.ok) {
      console.error('Stripe API error:', promoCode);
      throw new Error(promoCode.error?.message || 'Failed to create promo code');
    }
    
    console.log('✅ Promotion code created:', promoCode.code);
    console.log('\n🎉 SUCCESS! Use code: H2SQA100');
    console.log('   Discount: 100% off');
    console.log('   Coupon ID:', coupon.id);
    console.log('   Promo ID:', linkedPromo.id);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.code === 'resource_already_exists') {
      console.log('\n💡 Code already exists. Try using: H2SQA100');
    }
  }
}

createPromoCode();

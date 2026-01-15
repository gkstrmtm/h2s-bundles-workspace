#!/usr/bin/env node
require('dotenv').config({ path: '.env.production.local' });

async function listStripeCodes() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  STRIPE PROMOTION CODES');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  
  if (!stripeKey) {
    console.error('❌ STRIPE_SECRET_KEY not found in environment');
    process.exit(1);
  }
  
  console.log('✅ Stripe key found');
  
  try {
    const { default: Stripe } = await import('stripe');
    const stripe = new Stripe(stripeKey, { apiVersion: '2024-06-20' });
    
    console.log('\n📋 Fetching all promotion codes...\n');
    
    const promoCodes = await stripe.promotionCodes.list({
      limit: 100,
    });
    
    console.log(`Found ${promoCodes.data.length} promotion codes:\n`);
    
    if (promoCodes.data.length === 0) {
      console.log('⚠️  NO PROMOTION CODES FOUND IN STRIPE ACCOUNT');
      console.log('\nTo create a test promo code:');
      console.log('1. Go to https://dashboard.stripe.com/coupons');
      console.log('2. Create a new coupon (e.g., 10% off)');
      console.log('3. Create a promotion code for that coupon');
      console.log('4. Use the code in your shop\n');
    } else {
      for (const code of promoCodes.data) {
        const coupon = code.coupon;
        const discount = coupon.percent_off 
          ? `${coupon.percent_off}% off` 
          : `$${(coupon.amount_off / 100).toFixed(2)} off`;
        
        console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        console.log(`Code: ${code.code}`);
        console.log(`ID: ${code.id}`);
        console.log(`Discount: ${discount}`);
        console.log(`Active: ${code.active ? '✅ YES' : '❌ NO'}`);
        console.log(`Times used: ${code.times_redeemed || 0}`);
        if (code.expires_at) {
          const expDate = new Date(code.expires_at * 1000);
          console.log(`Expires: ${expDate.toLocaleString()}`);
        }
        console.log('');
      }
    }
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
  } catch (error) {
    console.error('\n❌ ERROR:', error.message);
    console.error(error.stack);
  }
}

listStripeCodes();

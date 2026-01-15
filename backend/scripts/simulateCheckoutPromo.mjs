// Checkout Promo Simulation Test
// Tests checkout with and without promo to ensure no 500 errors

const API = 'https://h2s-backend.vercel.app/api/shop';

const TEST_CUSTOMER = {
  email: 'test@home2smart.com',
  name: 'Test User',
  phone: '555-123-4567',
  address: {
    line1: '123 Main St',
    city: 'Greenwood',
    state: 'SC',
    postal_code: '29646',
    country: 'US'
  }
};

const TEST_CART = [
  {
    id: 'tv_mount',
    name: 'TV Mount Installation',
    price: 599,
    qty: 1,
    type: 'package',
    bundle_id: 'tv_mount',
    stripe_price_id: 'price_test'
  }
];

async function testCheckout(scenario, promoCode = null) {
  console.log(`\n[${'='.repeat(60)}]`);
  console.log(`[TEST] ${scenario}`);
  console.log(`[${'='.repeat(60)}]`);
  
  const payload = {
    __action: 'create_checkout_session',
    customer: TEST_CUSTOMER,
    cart: TEST_CART,
    promotion_code: promoCode,
    success_url: 'https://shop.home2smart.com/success',
    cancel_url: 'https://shop.home2smart.com/cancel'
  };
  
  console.log('[REQUEST] Promo code:', promoCode || 'none');
  
  try {
    const start = Date.now();
    const resp = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const duration = Date.now() - start;
    
    const data = await resp.json();
    
    console.log('[RESPONSE]');
    console.log('  Status:', resp.status);
    console.log('  Duration:', duration + 'ms');
    console.log('  Body:', JSON.stringify(data, null, 2));
    
    // Validate response
    if (resp.status === 500) {
      console.log('\n❌ FAIL: Got 500 error (forbidden)');
      return false;
    } else if (!resp.ok && !data.ok) {
      console.log(`\n✓ PASS: Clean error response (${resp.status})`);
      console.log('  Error code:', data.code);
      console.log('  Error message:', data.error);
      return true;
    } else if (data.ok && data.url) {
      console.log('\n✓ PASS: Checkout session created');
      console.log('  Session URL:', data.url.substring(0, 50) + '...');
      return true;
    } else {
      console.log('\n⚠ UNEXPECTED: Response format not recognized');
      return false;
    }
    
  } catch (error) {
    console.log('\n❌ FAIL: Exception thrown');
    console.log('  Error:', error.message);
    return false;
  }
}

async function runTests() {
  console.log('\n' + '='.repeat(70));
  console.log('CHECKOUT PROMO SIMULATION TESTS');
  console.log('Backend:', API);
  console.log('='.repeat(70));
  
  const results = [];
  
  // Test 1: Checkout without promo
  results.push({
    name: 'Checkout without promo',
    pass: await testCheckout('Scenario 1: Checkout without promo code')
  });
  
  await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1s between tests
  
  // Test 2: Checkout with valid cached promo (h2sqa-e2e-2025)
  results.push({
    name: 'Checkout with h2sqa-e2e-2025 (100% off)',
    pass: await testCheckout('Scenario 2: Checkout with cached promo (h2sqa-e2e-2025)', 'h2sqa-e2e-2025')
  });
  
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Test 3: Checkout with invalid/uncached promo
  results.push({
    name: 'Checkout with uncached promo (INVALID999)',
    pass: await testCheckout('Scenario 3: Checkout with uncached promo (INVALID999)', 'INVALID999')
  });
  
  // Summary
  console.log('\n' + '='.repeat(70));
  console.log('TEST SUMMARY');
  console.log('='.repeat(70));
  
  const passed = results.filter(r => r.pass).length;
  const failed = results.filter(r => !r.pass).length;
  
  results.forEach(r => {
    console.log(`${r.pass ? '✓' : '❌'} ${r.name}`);
  });
  
  console.log(`\nTotal: ${results.length} tests`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  
  if (failed === 0) {
    console.log('\n✓ ALL TESTS PASSED - Checkout is deterministic and 500-free!');
  } else {
    console.log('\n❌ SOME TESTS FAILED - Review errors above');
  }
  
  console.log('='.repeat(70) + '\n');
}

runTests().catch(console.error);

#!/usr/bin/env node

/**
 * Stripe Checkout Reliability Test
 * Runs 20 attempts against production backend
 * Reports success/failure rates and timing
 */

const BACKEND_URL = 'https://h2s-backend.vercel.app';
const RUNS = 20;

// Test 1: Diagnostic endpoint
async function testDiagnostic(mode) {
  const start = Date.now();
  try {
    const res = await fetch(`${BACKEND_URL}/api/_diag/stripe_smoke?mode=${mode}`, {
      method: 'GET',
    });
    const data = await res.json();
    return {
      success: data.ok === true,
      duration: Date.now() - start,
      data,
    };
  } catch (error) {
    return {
      success: false,
      duration: Date.now() - start,
      error: error.message,
    };
  }
}

// Test 2: Full checkout session creation
async function testCheckoutSession() {
  const start = Date.now();
  try {
    const res = await fetch(`${BACKEND_URL}/api/shop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        __action: 'create_checkout_session',
        customer: {
          name: 'Test Customer',
          email: 'test@diagnostic.com',
          phone: '5555555555',
        },
        cart: [
          {
            id: 'cam_bundle_2',
            name: '2-Camera Bundle',
            price: 49900,
            qty: 1,
          },
        ],
        success_url: 'https://shop.home2smart.com/bundles?view=shopsuccess',
        cancel_url: 'https://shop.home2smart.com/bundles',
      }),
    });

    const data = await res.json();
    return {
      success: res.ok && data.ok === true,
      duration: Date.now() - start,
      status: res.status,
      data,
    };
  } catch (error) {
    return {
      success: false,
      duration: Date.now() - start,
      error: error.message,
    };
  }
}

// Test 3: Checkout with promo code
async function testCheckoutWithPromo() {
  const start = Date.now();
  try {
    const res = await fetch(`${BACKEND_URL}/api/shop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        __action: 'create_checkout_session',
        customer: {
          name: 'Test Customer',
          email: 'test@diagnostic.com',
          phone: '5555555555',
        },
        cart: [
          {
            id: 'cam_bundle_2',
            name: '2-Camera Bundle',
            price: 49900,
            qty: 1,
          },
        ],
        promo_code: 'SAVE20',
        success_url: 'https://shop.home2smart.com/bundles?view=shopsuccess',
        cancel_url: 'https://shop.home2smart.com/bundles',
      }),
    });

    const data = await res.json();
    return {
      success: res.ok && data.ok === true,
      duration: Date.now() - start,
      status: res.status,
      data,
    };
  } catch (error) {
    return {
      success: false,
      duration: Date.now() - start,
      error: error.message,
    };
  }
}

function calculateStats(results) {
  const durations = results.map(r => r.duration).sort((a, b) => a - b);
  const successes = results.filter(r => r.success).length;
  
  return {
    total: results.length,
    successes,
    failures: results.length - successes,
    success_rate: ((successes / results.length) * 100).toFixed(1) + '%',
    min_ms: durations[0],
    max_ms: durations[durations.length - 1],
    p50_ms: durations[Math.floor(durations.length * 0.5)],
    p95_ms: durations[Math.floor(durations.length * 0.95)],
    avg_ms: Math.round(durations.reduce((a, b) => a + b, 0) / durations.length),
  };
}

async function runTests() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  STRIPE CHECKOUT RELIABILITY TEST');
  console.log('═══════════════════════════════════════════════════════════\n');
  console.log(`Backend: ${BACKEND_URL}`);
  console.log(`Runs per test: ${RUNS}\n`);

  // Test 1: Diagnostic - Account
  console.log('━━━ Test 1: Diagnostic Endpoint (account mode) ━━━');
  const diagAccountResults = [];
  for (let i = 0; i < RUNS; i++) {
    process.stdout.write(`  Run ${i + 1}/${RUNS}...\r`);
    diagAccountResults.push(await testDiagnostic('account'));
  }
  console.log('\n');
  console.log('Results:', calculateStats(diagAccountResults));
  const sampleDiagAccount = diagAccountResults.find(r => r.success);
  if (sampleDiagAccount) {
    console.log('Sample success:', JSON.stringify(sampleDiagAccount.data, null, 2));
  }
  console.log('');

  // Test 2: Diagnostic - Session
  console.log('━━━ Test 2: Diagnostic Endpoint (session mode) ━━━');
  const diagSessionResults = [];
  for (let i = 0; i < RUNS; i++) {
    process.stdout.write(`  Run ${i + 1}/${RUNS}...\r`);
    diagSessionResults.push(await testDiagnostic('session'));
  }
  console.log('\n');
  console.log('Results:', calculateStats(diagSessionResults));
  const sampleDiagSession = diagSessionResults.find(r => r.success);
  if (sampleDiagSession) {
    console.log('Sample success:', JSON.stringify(sampleDiagSession.data, null, 2));
  }
  const failedDiagSession = diagSessionResults.find(r => !r.success);
  if (failedDiagSession) {
    console.log('Sample failure:', JSON.stringify(failedDiagSession.data || failedDiagSession.error, null, 2));
  }
  console.log('');

  // Test 3: Full Checkout (no promo)
  console.log('━━━ Test 3: Full Checkout Session (no promo) ━━━');
  const checkoutResults = [];
  for (let i = 0; i < RUNS; i++) {
    process.stdout.write(`  Run ${i + 1}/${RUNS}...\r`);
    checkoutResults.push(await testCheckoutSession());
  }
  console.log('\n');
  console.log('Results:', calculateStats(checkoutResults));
  const sampleCheckout = checkoutResults.find(r => r.success);
  if (sampleCheckout) {
    console.log('Sample success (session URL):', sampleCheckout.data?.pay?.session_url?.slice(0, 80) + '...');
  }
  const failedCheckout = checkoutResults.find(r => !r.success);
  if (failedCheckout) {
    console.log('Sample failure:', JSON.stringify(failedCheckout.data || failedCheckout.error, null, 2));
  }
  console.log('');

  // Test 4: Checkout with promo
  console.log('━━━ Test 4: Checkout Session (with promo SAVE20) ━━━');
  const checkoutPromoResults = [];
  for (let i = 0; i < RUNS; i++) {
    process.stdout.write(`  Run ${i + 1}/${RUNS}...\r`);
    checkoutPromoResults.push(await testCheckoutWithPromo());
  }
  console.log('\n');
  console.log('Results:', calculateStats(checkoutPromoResults));
  const sampleCheckoutPromo = checkoutPromoResults.find(r => r.success);
  if (sampleCheckoutPromo) {
    console.log('Sample success (session URL):', sampleCheckoutPromo.data?.pay?.session_url?.slice(0, 80) + '...');
  }
  const failedCheckoutPromo = checkoutPromoResults.find(r => !r.success);
  if (failedCheckoutPromo) {
    console.log('Sample failure:', JSON.stringify(failedCheckoutPromo.data || failedCheckoutPromo.error, null, 2));
  }
  console.log('');

  // Summary
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  SUMMARY');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('Diagnostic (account):', calculateStats(diagAccountResults).success_rate, 'success');
  console.log('Diagnostic (session):', calculateStats(diagSessionResults).success_rate, 'success');
  console.log('Checkout (no promo): ', calculateStats(checkoutResults).success_rate, 'success');
  console.log('Checkout (with promo):', calculateStats(checkoutPromoResults).success_rate, 'success');
  console.log('');

  // Failure analysis
  const allFailures = [
    ...diagAccountResults.filter(r => !r.success),
    ...diagSessionResults.filter(r => !r.success),
    ...checkoutResults.filter(r => !r.success),
    ...checkoutPromoResults.filter(r => !r.success),
  ];

  if (allFailures.length > 0) {
    console.log('━━━ Failure Breakdown ━━━');
    const errorTypes = {};
    allFailures.forEach(f => {
      const errName = f.data?.error_name || f.error || 'Unknown';
      errorTypes[errName] = (errorTypes[errName] || 0) + 1;
    });
    Object.entries(errorTypes).forEach(([err, count]) => {
      console.log(`  ${err}: ${count}`);
    });
  }

  console.log('');
  console.log('Test complete!');
}

runTests().catch(console.error);

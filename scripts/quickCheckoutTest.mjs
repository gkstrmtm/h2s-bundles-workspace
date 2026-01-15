#!/usr/bin/env node

/**
 * Quick Checkout Regression Test
 * Tests if checkout is working on production right now
 */

const BACKEND_URL = 'https://h2s-backend.vercel.app';
const TEST_EMAIL = `regtest-${Date.now()}@test.com`;

console.log('🔍 REGRESSION TEST: Checkout Flow\n');
console.log('Backend:', BACKEND_URL);
console.log('Test Email:', TEST_EMAIL);
console.log('='.repeat(60));

const payload = {
  customer: {
    email: TEST_EMAIL,
    name: 'Regression Test',
    phone: '8645551234'
  },
  cart: [
    {
      id: 'tv-mount-1',
      name: 'TV Mount Installation',
      price: 99,
      qty: 1
    }
  ],
  metadata: {
    customer_email: TEST_EMAIL,
    customer_name: 'Regression Test',
    service_address: '123 Test St',
    service_city: 'Greenwood',
    service_state: 'SC',
    service_zip: '29649'
  }
};

console.log('\n📤 Sending checkout request...');
console.log('Payload:', JSON.stringify(payload, null, 2));

try {
  const response = await fetch(`${BACKEND_URL}/api/shop`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload)
  });

  console.log('\n📥 Response Status:', response.status);
  
  const data = await response.json();
  console.log('📥 Response Body:', JSON.stringify(data, null, 2));

  if (!response.ok) {
    console.error('\n❌ CHECKOUT FAILED');
    console.error('Status:', response.status);
    console.error('Error:', data.error);
    console.error('Code:', data.code);
    console.error('Details:', data.details);
    process.exit(1);
  }

  if (data.ok && data.order_id && data.job_id) {
    console.log('\n✅ CHECKOUT SUCCEEDED');
    console.log('Order ID:', data.order_id);
    console.log('Job ID:', data.job_id);
    console.log('Session ID:', data.pay?.session_id);
    process.exit(0);
  } else {
    console.error('\n❌ CHECKOUT INCOMPLETE');
    console.error('Missing fields:', {
      ok: data.ok,
      order_id: data.order_id,
      job_id: data.job_id
    });
    process.exit(1);
  }
} catch (err) {
  console.error('\n❌ REQUEST FAILED');
  console.error('Error:', err.message);
  console.error('Stack:', err.stack);
  process.exit(1);
}

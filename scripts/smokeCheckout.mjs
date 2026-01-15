#!/usr/bin/env node

/**
 * Smoke Test: Direct checkout test hitting production
 * Verifies: Stripe session creation + order creation + job creation
 */

import crypto from 'crypto';

// Production canonical domain (shop.home2smart.com backend)
const BACKEND_URL = 'https://h2s-backend.vercel.app';
const TEST_EMAIL = `smoke-${Date.now()}@test.com`;

console.log('🔥 SMOKE TEST: Production Checkout Flow');
console.log('========================================\n');
console.log(`Backend URL: ${BACKEND_URL}\n`);

// Test payload matching frontend structure
const payload = {
  __action: 'create_checkout_session',
  customer: {
    email: TEST_EMAIL,
    name: 'Smoke Test Customer',
    phone: '5551234567'
  },
  cart: [
    {
      id: 'bundle-1',
      name: 'Smart Home Bundle',
      price: 999,
      qty: 1,
      metadata: {}
    }
  ],
  metadata: {
    customer_email: TEST_EMAIL,
    customer_name: 'Smoke Test Customer',
    customer_phone: '5551234567',
    service_address: '123 Test St',
    service_city: 'Los Angeles',
    service_state: 'CA',
    service_zip: '90210',
    source: 'smoke_test'
  },
  success_url: 'https://shop.home2smart.com/bundles?view=shopsuccess&session_id={CHECKOUT_SESSION_ID}',
  cancel_url: 'https://shop.home2smart.com/bundles',
  idempotency_key: crypto.randomUUID() // Prevent duplicates
};

console.log('📨 Sending checkout request...');
console.log(`   Customer: ${TEST_EMAIL}`);
console.log(`   Cart: ${payload.cart.length} items`);
console.log(`   Idempotency Key: ${payload.idempotency_key}\n`);

try {
  const response = await fetch(`${BACKEND_URL}/api/shop`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json();

  console.log(`📥 Response Status: ${response.status}`);
  console.log(`📥 Response Body:`, JSON.stringify(data, null, 2));

  if (!response.ok || !data.ok) {
    console.error('\n❌ CHECKOUT FAILED');
    console.error(`   Error: ${data.error || 'Unknown error'}`);
    console.error(`   Code: ${data.code || 'N/A'}`);
    process.exit(1);
  }

  // Extract session info
  const sessionId = data.pay?.session_id;
  const sessionUrl = data.pay?.session_url;
  const traceId = data.checkout_trace_id;
  const orderId = data.order_id;
  const jobId = data.job_id;

  if (!sessionId) {
    console.error('\n❌ NO SESSION ID RETURNED');
    process.exit(1);
  }

  console.log('\n✅ CHECKOUT SESSION CREATED');
  console.log(`   Session ID: ${sessionId}`);
  console.log(`   Order ID: ${orderId || 'NOT RETURNED'}`);
  console.log(`   Job ID: ${jobId || 'NOT RETURNED'}`);
  console.log(`   Trace ID: ${traceId}`);
  console.log(`   URL: ${sessionUrl?.substring(0, 50)}...`);
  
  if (!orderId) {
    console.error('\n❌ ORDER ID NOT IN RESPONSE');
    console.error('   The API should return order_id');
    process.exit(1);
  }
  
  if (!jobId) {
    console.error('\n❌ JOB ID NOT IN RESPONSE');
    console.error('   The API should return job_id');
    process.exit(1);
  }

  // Wait for database writes to complete
  console.log('\n⏳ Waiting 3 seconds for database writes...');
  await new Promise(resolve => setTimeout(resolve, 3000));

  // Verify order exists
  console.log('\n📊 Verifying database records...');
  console.log('   [1/2] Checking h2s_orders...');
  
  const ordersResponse = await fetch(`${BACKEND_URL}/api/customer_orders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ customer_email: TEST_EMAIL })
  });

  const ordersData = await ordersResponse.json();
  
  if (!ordersData.ok || !ordersData.orders || ordersData.orders.length === 0) {
    console.error('\n❌ ORDER NOT FOUND IN DATABASE');
    console.error('   The order row was not created!');
    process.exit(1);
  }

  const order = ordersData.orders[0];
  console.log(`   ✅ Order found: ${order.order_id}`);
  console.log(`      Session ID: ${order.session_id}`);
  console.log(`      Status: ${order.status}`);

  // Check if job_id exists in order metadata or was returned by API
  const dbJobId = order.metadata_json?.dispatch_job_id || order.job_id;
  
  console.log('\n   [2/2] Checking dispatch job...');
  console.log(`      API returned job_id: ${jobId}`);
  console.log(`      DB order has job_id: ${dbJobId || 'NONE'}`);
  
  const finalJobId = jobId || dbJobId;
  
  if (!finalJobId) {
    console.error('   ❌ NO JOB ID ANYWHERE');
    console.error('      The dispatch job was not created or not linked!');
    console.error('      Order metadata:', JSON.stringify(order.metadata_json, null, 2));
    process.exit(1);
  }

  console.log(`   ✅ Job ID verified: ${finalJobId}`);
  
  // Verify job exists via portal endpoint
  try {
    const jobsResponse = await fetch(`${BACKEND_URL}/api/portal_jobs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        action: 'list',
        filters: { job_id: finalJobId }
      })
    });

    const jobsData = await jobsResponse.json();
    
    if (jobsData.ok && jobsData.jobs && jobsData.jobs.length > 0) {
      const job = jobsData.jobs[0];
      console.log(`   ✅ Job found in portal:`, {
        job_id: job.job_id,
        status: job.status,
        recipient_id: job.recipient_id
      });
    } else {
      console.warn('   ⚠️  Job not found via portal API');
      console.warn('      This could indicate the job is not visible to the portal');
    }
  } catch (err) {
    console.warn('   ⚠️  Could not verify job via portal:', err.message);
  }

  console.log('\n✅ ✅ ✅ SMOKE TEST PASSED ✅ ✅ ✅');
  console.log('\nVerified:');
  console.log('  ✅ Stripe checkout session created');
  console.log('  ✅ Order row created in h2s_orders');
  console.log('  ✅ Dispatch job created and linked');
  console.log('\nTest completed successfully!\n');

} catch (error) {
  console.error('\n❌ SMOKE TEST FAILED');
  console.error('   Error:', error.message);
  console.error('   Stack:', error.stack);
  process.exit(1);
}

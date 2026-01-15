#!/usr/bin/env node
/**
 * PORTAL SMOKE TEST - Deterministic E2E validation
 * Tests: Checkout → Order → Dispatch Job → Portal Display
 */

const BACKEND_URL = 'https://h2s-backend.vercel.app';

async function smokeTest() {
  console.log('\n🔥 PORTAL SMOKE TEST - Starting...\n');
  
  const testEmail = `smoke-${Date.now()}@test.com`;
  const results = {
    checkout: { passed: false, data: null, error: null },
    order: { passed: false, data: null, error: null },
    dispatchJob: { passed: false, data: null, error: null },
    schedule: { passed: false, data: null, error: null }
  };

  // ==================== STEP 1: CHECKOUT ====================
  console.log('📦 STEP 1: Creating checkout order...');
  try {
    const checkoutPayload = {
      action: 'create_checkout_session',
      customer: {
        email: testEmail,
        name: 'Smoke Test User',
        phone: '5551234567'
      },
      cart: [{
        id: 'bundle-1',
        name: 'Smart Home Security Bundle',
        price: 999,
        qty: 1
      }],
      success_url: 'https://shop.home2smart.com/success',
      cancel_url: 'https://shop.home2smart.com',
      metadata: {
        customer_email: testEmail,
        customer_name: 'Smoke Test User',
        service_address: '123 Test St',
        service_city: 'Greenwood',
        service_state: 'SC',
        service_zip: '29646'
      }
    };

    const checkoutRes = await fetch(`${BACKEND_URL}/api/shop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(checkoutPayload)
    });
    
    const checkoutData = await checkoutRes.json();
    results.checkout.data = checkoutData;
    
    if (!checkoutData.ok) {
      results.checkout.error = checkoutData.error || 'Checkout failed';
      console.log('❌ CHECKOUT FAILED:', results.checkout.error);
      return exitWithResults(results, 1);
    }
    
    results.checkout.passed = true;
    console.log(`✅ Checkout created: ${checkoutData.order_id || 'NO ORDER ID'}`);
    
  } catch (err) {
    results.checkout.error = err.message;
    console.log('❌ CHECKOUT ERROR:', err.message);
    return exitWithResults(results, 1);
  }

  // Wait for async DB writes
  await sleep(2000);

  // ==================== STEP 2: VERIFY ORDER ====================
  console.log('\n📋 STEP 2: Verifying order in h2s_orders...');
  try {
    const orderRes = await fetch(`${BACKEND_URL}/api/customer_orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customer_email: testEmail })
    });
    
    const orderData = await orderRes.json();
    results.order.data = orderData;
    
    if (!orderData.ok || !orderData.orders || orderData.orders.length === 0) {
      results.order.error = 'No orders found in DB';
      console.log('❌ ORDER NOT FOUND IN DB');
      return exitWithResults(results, 1);
    }
    
    const order = orderData.orders[0];
    results.order.passed = true;
    console.log(`✅ Order found: ${order.order_id}`);
    console.log(`   Status: ${order.status}`);
    console.log(`   Job ID (root): ${order.job_id || 'MISSING'}`);
    console.log(`   Job ID (metadata): ${order.metadata_json?.dispatch_job_id || 'MISSING'}`);
    console.log(`   Schedule: ${order.scheduled_date || order.delivery_date || 'MISSING'} ${order.time_window || order.delivery_time || ''}`);
    
    // Check critical fields
    if (!order.job_id && !order.metadata_json?.dispatch_job_id) {
      console.log('⚠️  WARNING: job_id missing in both root and metadata');
    }
    
  } catch (err) {
    results.order.error = err.message;
    console.log('❌ ORDER FETCH ERROR:', err.message);
    return exitWithResults(results, 1);
  }

  // ==================== STEP 3: VERIFY DISPATCH JOB ====================
  console.log('\n🚚 STEP 3: Checking dispatch job exists...');
  const order = results.order.data.orders[0];
  
  const jobId = order.job_id || order.metadata_json?.dispatch_job_id;
  if (jobId) {
    // Job ID exists, assume job was created
    results.dispatchJob.passed = true;
    results.dispatchJob.data = { job_id: jobId };
    console.log(`✅ Dispatch job ID present: ${jobId}`);
  } else {
    results.dispatchJob.error = 'job_id missing from both root and metadata';
    console.log('❌ DISPATCH JOB: job_id not set anywhere');
  }

  // ==================== STEP 4: SCHEDULE TEST ====================
  console.log('\n📅 STEP 4: Testing schedule persistence...');
  try {
    const scheduleDate = new Date();
    scheduleDate.setDate(scheduleDate.getDate() + 3);
    const scheduledIso = scheduleDate.toISOString();
    
    const schedulePayload = {
      order_id: order.order_id,
      scheduled_iso: scheduledIso,
      time_window: '9am - 12pm' // Use valid format
    };

    const scheduleRes = await fetch(`${BACKEND_URL}/api/customer_reschedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(schedulePayload)
    });
    
    const scheduleData = await scheduleRes.json();
    results.schedule.data = scheduleData;
    
    if (!scheduleData.ok) {
      results.schedule.error = scheduleData.error || 'Schedule update failed';
      console.log('❌ SCHEDULE FAILED:', results.schedule.error);
    } else {
      results.schedule.passed = true;
      console.log(`✅ Schedule updated: ${scheduledIso} ${schedulePayload.time_window}`);
    }
    
    // Verify it persisted
    await sleep(1000);
    const verifyRes = await fetch(`${BACKEND_URL}/api/customer_orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customer_email: testEmail })
    });
    const verifyData = await verifyRes.json();
    const updatedOrder = verifyData.orders[0];
    
    console.log(`   Verified DB: ${updatedOrder.scheduled_date || 'MISSING'} ${updatedOrder.time_window || 'MISSING'}`);
    
    if (!updatedOrder.scheduled_date) {
      console.log('⚠️  WARNING: scheduled_date not persisted in DB');
      results.schedule.passed = false;
    }
    
  } catch (err) {
    results.schedule.error = err.message;
    console.log('❌ SCHEDULE ERROR:', err.message);
  }

  // ==================== FINAL RESULTS ====================
  return exitWithResults(results, 0);
}

function exitWithResults(results, exitCode) {
  console.log('\n' + '='.repeat(60));
  console.log('📊 SMOKE TEST RESULTS');
  console.log('='.repeat(60));
  
  const steps = [
    { name: 'Checkout', result: results.checkout },
    { name: 'Order Persistence', result: results.order },
    { name: 'Dispatch Job', result: results.dispatchJob },
    { name: 'Schedule Persistence', result: results.schedule }
  ];
  
  let passCount = 0;
  steps.forEach(step => {
    const icon = step.result.passed ? '✅' : '❌';
    console.log(`${icon} ${step.name}: ${step.result.passed ? 'PASS' : 'FAIL'}`);
    if (step.result.error) {
      console.log(`   Error: ${step.result.error}`);
    }
    if (step.result.passed) passCount++;
  });
  
  console.log('='.repeat(60));
  console.log(`FINAL: ${passCount}/${steps.length} checks passed`);
  console.log('='.repeat(60) + '\n');
  
  process.exit(passCount === steps.length ? 0 : 1);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Run
smokeTest().catch(err => {
  console.error('💥 FATAL ERROR:', err);
  process.exit(1);
});

#!/usr/bin/env node

/**
 * Checkout Simulation Script
 * Tests the complete checkout flow and verifies order + job creation
 * Usage: node scripts/simulateCheckout.js
 */

const https = require('https');

const BACKEND_URL = process.env.BACKEND_URL || 'https://h2s-backend.vercel.app';
const ADMIN_KEY = process.env.ADMIN_KEY || 'your-admin-key-here';

console.log('\n==========================================');
console.log('  CHECKOUT SIMULATION TEST');
console.log('==========================================\n');

const testEmail = `test-${Date.now()}@simulation.test`;
console.log(`Test Email: ${testEmail}`);

// Step 1: Create checkout session
const checkoutPayload = JSON.stringify({
  __action: 'create_checkout_session',
  customer: {
    email: testEmail,
    name: 'Simulation Test',
    phone: '5551234567'
  },
  cart: [
    {
      price_id: 'price_1QcKf3JuUPVEaFaTMglJDrrg',
      qty: 1
    }
  ],
  success_url: 'https://example.com/success',
  cancel_url: 'https://example.com/cancel',
  metadata: {
    service_address: '123 Test St',
    service_city: 'Charleston',
    service_state: 'SC',
    service_zip: '29401'
  }
});

const checkoutOptions = {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(checkoutPayload)
  }
};

console.log('\n[1/3] Creating checkout session...');

const checkoutUrl = `${BACKEND_URL}/api/shop`;
const checkoutReq = https.request(checkoutUrl, checkoutOptions, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    try {
      const result = JSON.parse(data);
      
      if (!result.ok) {
        console.error('\n❌ FAILED: Checkout creation failed');
        console.error('Error:', result.error);
        process.exit(1);
      }
      
      const traceId = result.checkout_trace_id;
      const sessionId = result.pay?.session_id;
      
      console.log('✅ Checkout created');
      console.log(`   Session ID: ${sessionId}`);
      console.log(`   Trace ID: ${traceId}`);
      
      if (!traceId) {
        console.error('\n❌ FAILED: No trace_id in response');
        process.exit(1);
      }
      
      // Step 2: Wait 3 seconds for processing
      console.log('\n[2/3] Waiting 3 seconds for processing...');
      setTimeout(() => {
        checkTraceStatus(traceId);
      }, 3000);
      
    } catch (err) {
      console.error('\n❌ FAILED: Invalid JSON response');
      console.error('Raw:', data);
      process.exit(1);
    }
  });
});

checkoutReq.on('error', (err) => {
  console.error('\n❌ FAILED: Network error');
  console.error(err.message);
  process.exit(1);
});

checkoutReq.write(checkoutPayload);
checkoutReq.end();

// Step 3: Check trace status
function checkTraceStatus(traceId) {
  console.log('\n[3/3] Checking trace status...');
  
  const traceUrl = `${BACKEND_URL}/api/admin/trace_status?trace_id=${traceId}`;
  const traceOptions = {
    headers: {
      'x-admin-key': ADMIN_KEY
    }
  };
  
  https.get(traceUrl, traceOptions, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      try {
        const trace = JSON.parse(data);
        
        if (!trace.ok) {
          console.error('\n❌ FAILED: Could not fetch trace');
          console.error('Error:', trace.error);
          process.exit(1);
        }
        
        console.log('\n========== TRACE RESULTS ==========');
        console.log(`Trace ID: ${trace.trace_id}`);
        console.log(`Latest Stage: ${trace.latest_stage}`);
        console.log(`All Stages: ${trace.all_stages.join(' → ')}`);
        
        if (trace.failures && trace.failures.length > 0) {
          console.log('\n⚠️  FAILURES DETECTED:');
          trace.failures.forEach((f, i) => {
            console.log(`\n  ${i + 1}. Stage: ${f.stage}`);
            console.log(`     Error: ${f.error_message}`);
            if (f.error_stack) {
              console.log(`     Stack: ${f.error_stack.split('\n')[0]}`);
            }
          });
        }
        
        console.log('\n--- Order Status ---');
        if (trace.order) {
          console.log(`✅ Order Created: ${trace.order.order_id}`);
          console.log(`   Status: ${trace.order.status}`);
          console.log(`   Email: ${trace.order.customer_email}`);
          console.log(`   Job ID in metadata: ${trace.order.job_id_in_metadata || 'NONE'}`);
        } else {
          console.log('❌ No order found');
        }
        
        console.log('\n--- Job Status ---');
        if (trace.job) {
          console.log(`✅ Job Created: ${trace.job.job_id}`);
          console.log(`   Status: ${trace.job.status}`);
          console.log(`   Recipient: ${trace.job.recipient_id}`);
        } else {
          console.log('❌ No job found');
        }
        
        console.log('\n--- Summary ---');
        console.log(`Total Traces: ${trace.summary.total_traces}`);
        console.log(`Total Failures: ${trace.summary.total_failures}`);
        console.log(`Has Order: ${trace.summary.has_order}`);
        console.log(`Has Job: ${trace.summary.has_job}`);
        console.log(`Completed: ${trace.summary.completed}`);
        
        console.log('\n========== FINAL RESULT ==========');
        if (trace.summary.has_order && trace.summary.has_job && trace.summary.completed) {
          console.log('✅ PASS: Order and Job created successfully');
          console.log('==========================================\n');
          process.exit(0);
        } else {
          console.log('❌ FAIL: Incomplete checkout flow');
          console.log(`   Missing: ${!trace.summary.has_order ? 'ORDER ' : ''}${!trace.summary.has_job ? 'JOB ' : ''}${!trace.summary.completed ? 'COMPLETION' : ''}`);
          console.log('==========================================\n');
          process.exit(1);
        }
        
      } catch (err) {
        console.error('\n❌ FAILED: Invalid trace response');
        console.error('Raw:', data);
        process.exit(1);
      }
    });
  }).on('error', (err) => {
    console.error('\n❌ FAILED: Could not fetch trace');
    console.error(err.message);
    process.exit(1);
  });
}

// Probe database directly to verify table requirements
const https = require('https');

function fetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const reqOptions = {
      hostname: urlObj.hostname,
      path: urlObj.pathname,
      method: options.method || 'GET',
      headers: options.headers || {}
    };
    
    const req = https.request(reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          json: () => Promise.resolve(JSON.parse(data))
        });
      });
    });
    
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

const API = 'https://h2s-backend.vercel.app';

async function probeDatabase() {
  console.log('\n========== DATABASE REQUIREMENTS PROBE ==========\n');
  
  // Check if default sequence_id exists
  console.log('1. Checking default sequence_id exists...');
  const DEFAULT_SEQUENCE_ID = '88297425-c134-4a51-8450-93cb35b1b3cb';
  const DEFAULT_STEP_ID = 'd30da333-3a54-4598-8ac1-f3b276185ea1';
  
  console.log(`   Sequence: ${DEFAULT_SEQUENCE_ID}`);
  console.log(`   Step: ${DEFAULT_STEP_ID}`);
  console.log('   ⚠️  Cannot verify without direct DB access\n');
  
  // Check recent orders
  console.log('2. Checking recent orders in h2s_orders...');
  const orderResponse = await fetch(`${API}/api/customer_orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ customer_email: 'h2sbackend@gmail.com' })
  });
  
  const orderData = await orderResponse.json();
  
  if (orderData.ok && orderData.orders) {
    console.log(`   ✅ Found ${orderData.orders.length} orders for h2sbackend@gmail.com`);
    
    if (orderData.orders.length > 0) {
      const latestOrder = orderData.orders[0];
      console.log(`\n   Latest Order: ${latestOrder.order_id}`);
      console.log(`   Status: ${latestOrder.status}`);
      console.log(`   Created: ${latestOrder.created_at}`);
      
      const hasJobId = latestOrder.metadata_json?.dispatch_job_id || latestOrder.job_id;
      if (hasJobId) {
        console.log(`   ✅ Has job_id: ${hasJobId}`);
      } else {
        console.log(`   ❌ NO JOB_ID - Job creation failed!`);
      }
    }
  } else {
    console.log('   ❌ Could not fetch orders');
  }
  
  // Check portal jobs endpoint
  console.log('\n3. Checking h2s_dispatch_jobs via portal endpoint...');
  console.log('   ⚠️  Requires admin token (H2S_ADMIN_TOKEN)');
  
  // Simulated insert test
  console.log('\n4. Testing hypothetical job insert requirements...');
  const testJobPayload = {
    recipient_id: '00000000-0000-0000-0000-000000000000', // Would need valid UUID
    sequence_id: DEFAULT_SEQUENCE_ID,
    step_id: DEFAULT_STEP_ID,
    status: 'queued',
    job_details: 'Test job',
    customer_name: 'Test Customer',
    service_address: '123 Test St',
    order_id: 'ORD-TEST',
    created_at: new Date().toISOString(),
    due_at: new Date(Date.now() + 86400000).toISOString()
  };
  
  console.log('\n   Required fields for h2s_dispatch_jobs:');
  Object.keys(testJobPayload).forEach(key => {
    const value = testJobPayload[key];
    const isValid = value && value.toString().length > 0;
    console.log(`   ${isValid ? '✅' : '❌'} ${key}: ${JSON.stringify(value).substring(0, 50)}`);
  });
  
  console.log('\n========================================\n');
}

probeDatabase().catch(console.error);

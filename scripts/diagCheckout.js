// Check what happened with the recent checkout via API call
const https = require('https');

const orderId = 'ORD-FA1392A0';
const email = 'smoke-1767999331031@test.com';

console.log('=== CHECKING RECENT CHECKOUT ===\n');
console.log('Order ID:', orderId);
console.log('Email:', email);
console.log('\n[1/2] Checking h2s_orders...\n');

// Check order
const orderReq = https.request({
  hostname: 'h2s-backend.vercel.app',
  path: '/api/customer_orders',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  }
}, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const result = JSON.parse(data);
    
    if (!result.ok || !result.orders || result.orders.length === 0) {
      console.error('❌ Order not found or error');
      console.error(JSON.stringify(result, null, 2));
      return;
    }
    
    const order = result.orders[0];
    console.log('✅ Order found:');
    console.log('  order_id:', order.order_id);
    console.log('  session_id:', order.session_id);
    console.log('  status:', order.status);
    console.log('  created_at:', order.created_at);
    console.log('\n  metadata_json:', JSON.stringify(order.metadata_json, null, 2));
    
    const jobId = order.metadata_json?.dispatch_job_id || order.job_id;
    
    if (!jobId) {
      console.log('\n❌ NO JOB ID FOUND IN ORDER!');
      console.log('  Expected: metadata_json.dispatch_job_id or job_id field');
      console.log('  This means dispatch job was NOT created or NOT linked');
    } else {
      console.log('\n✅ Job ID found:', jobId);
    }
    
    // Check if there's a trace_id
    const traceId = order.metadata_json?.checkout_trace_id;
    if (traceId) {
      console.log('  Trace ID:', traceId);
      console.log('\n  To see trace details, query:');
      console.log(`  SELECT * FROM h2s_checkout_traces WHERE checkout_trace_id = '${traceId}' ORDER BY created_at;`);
      console.log(`  SELECT * FROM h2s_checkout_failures WHERE checkout_trace_id = '${traceId}';`);
    }
  });
});

orderReq.write(JSON.stringify({ customer_email: email }));
orderReq.end();

orderReq.on('error', (err) => {
  console.error('Request error:', err.message);
});

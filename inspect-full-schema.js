// Direct database queries using existing API
const https = require('https');

function httpRequest(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Parse error: ${e.message}`));
        }
      });
    }).on('error', reject);
  });
}

function httpPost(url, body) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const postData = JSON.stringify(body);
    
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };
    
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Parse error: ${e.message}`));
        }
      });
    });
    
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function main() {
  console.log('\n========== FULL SCHEMA INSPECTION ==========\n');
  
  // 1. Get h2s_dispatch_jobs schema (working GET endpoint)
  console.log('1. h2s_dispatch_jobs schema:');
  const dispatchSchema = await httpRequest('https://h2s-backend.vercel.app/api/get_table_schema');
  console.log(`   ✓ Columns (${dispatchSchema.columns.length}):`, dispatchSchema.columns.join(', '));
  console.log(`   ✓ Sample jobs: ${dispatchSchema.sample_count}`);
  
  // 2. Get sample order to see h2s_orders structure
  console.log('\n2. h2s_orders structure (from customer_orders API):');
  const testEmail = 'freshtest-1757616936@test.com'; // Recent test order
  const ordersResult = await httpPost('https://h2s-backend.vercel.app/api/customer_orders', {
    customer_email: testEmail
  });
  
  if (ordersResult.orders && ordersResult.orders.length > 0) {
    const sampleOrder = ordersResult.orders[0];
    console.log(`   ✓ Found order: ${sampleOrder.order_id}`);
    console.log(`   ✓ Columns in h2s_orders:`);
    
    Object.keys(sampleOrder).sort().forEach(key => {
      const value = sampleOrder[key];
      const type = typeof value;
      const preview = type === 'object' && value !== null 
        ? `{${Object.keys(value).length} keys}` 
        : String(value).substring(0, 50);
      console.log(`      - ${key.padEnd(20)} (${type}): ${preview}`);
    });
    
    // 3. Show metadata_json structure
    if (sampleOrder.metadata_json) {
      console.log('\n3. metadata_json structure:');
      console.log(JSON.stringify(sampleOrder.metadata_json, null, 2));
    }
    
    // 4. Show items structure
    if (sampleOrder.items) {
      console.log('\n4. items structure:');
      console.log(JSON.stringify(sampleOrder.items, null, 2));
    }
  } else {
    console.log('   ✗ No orders found, trying generic query...');
    
    // Try getting recent orders another way
    const recentOrders = await httpPost('https://h2s-backend.vercel.app/api/admin/orders', {
      limit: 1
    });
    
    if (recentOrders.orders && recentOrders.orders.length > 0) {
      const sampleOrder = recentOrders.orders[0];
      console.log(`   ✓ Found order: ${sampleOrder.order_id}`);
      console.log(`   ✓ h2s_orders columns:`, Object.keys(sampleOrder).sort().join(', '));
    }
  }
  
  // 5. Summary
  console.log('\n========== SCHEMA SUMMARY ==========');
  console.log('\nh2s_dispatch_jobs (CONFIRMED):');
  console.log('  ✓ 13 columns total');
  console.log('  ✗ NO metadata column');
  console.log('  ✗ NO payout_estimated column');
  console.log('  ✗ NO financial columns');
  console.log('  ✓ Has order_id (links to h2s_orders)');
  
  console.log('\nh2s_orders (TO BE DOCUMENTED):');
  console.log('  ? Total columns: TBD');
  console.log('  ? Has metadata_json: TBD');
  console.log('  ? Has delivery_date: TBD');
  console.log('  ? Has delivery_time: TBD');
  console.log('  ? Has subtotal: TBD');
  
  console.log('\n========================================\n');
}

main().catch(err => {
  console.error('\n❌ ERROR:', err.message);
  console.error(err.stack);
});

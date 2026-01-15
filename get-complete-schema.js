// Query complete schema for both tables and sample data

const BACKEND_URL = 'https://h2s-backend.vercel.app';

async function querySchema(tableName) {
  try {
    const response = await fetch(`${BACKEND_URL}/api/get_table_schema`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ table_name: tableName })
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const text = await response.text();
    console.log(`   Raw response for ${tableName}:`, text.substring(0, 100));
    
    const data = JSON.parse(text);
    return data;
  } catch (error) {
    console.error(`Error querying ${tableName}:`, error.message);
    return null;
  }
}

async function getSampleOrders() {
  try {
    const response = await fetch(`${BACKEND_URL}/api/admin/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ limit: 3 })
    });
    
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error getting sample orders:', error.message);
    return null;
  }
}

async function main() {
  console.log('\n=== COMPLETE SCHEMA INSPECTION ===\n');
  
  // 1. Get h2s_orders schema
  console.log('1. Querying h2s_orders schema...');
  const ordersSchema = await querySchema('h2s_orders');
  if (ordersSchema) {
    console.log('\n✅ h2s_orders COLUMNS:');
    console.log(`   Sample Count: ${ordersSchema.sample_count}`);
    console.log(`   Total Columns: ${ordersSchema.columns.length}\n`);
    
    ordersSchema.columns.forEach((col, idx) => {
      console.log(`   ${String(idx + 1).padStart(2)}. ${col.column_name.padEnd(25)} (${col.data_type}${col.is_nullable === 'YES' ? ', nullable' : ''})`);
    });
  }
  
  // 2. Get h2s_dispatch_jobs schema (reconfirm)
  console.log('\n\n2. Querying h2s_dispatch_jobs schema...');
  const jobsSchema = await querySchema('h2s_dispatch_jobs');
  if (jobsSchema) {
    console.log('\n✅ h2s_dispatch_jobs COLUMNS:');
    console.log(`   Sample Count: ${jobsSchema.sample_count}`);
    console.log(`   Total Columns: ${jobsSchema.columns.length}\n`);
    
    jobsSchema.columns.forEach((col, idx) => {
      console.log(`   ${String(idx + 1).padStart(2)}. ${col.column_name.padEnd(25)} (${col.data_type}${col.is_nullable === 'YES' ? ', nullable' : ''})`);
    });
  }
  
  // 3. Get sample orders to see metadata_json structure
  console.log('\n\n3. Getting sample orders with metadata_json...');
  const sampleOrders = await getSampleOrders();
  if (sampleOrders && sampleOrders.orders && sampleOrders.orders.length > 0) {
    console.log(`\n✅ Found ${sampleOrders.orders.length} sample orders\n`);
    
    sampleOrders.orders.forEach((order, idx) => {
      console.log(`\n   ORDER ${idx + 1}: ${order.order_id}`);
      console.log(`   ├─ Subtotal: ${order.subtotal || order.order_subtotal || 'N/A'}`);
      console.log(`   ├─ Total: ${order.total || order.order_total || 'N/A'}`);
      console.log(`   ├─ Status: ${order.status || 'N/A'}`);
      console.log(`   ├─ Created: ${order.created_at ? new Date(order.created_at).toISOString() : 'N/A'}`);
      console.log(`   ├─ Delivery Date: ${order.delivery_date || 'Not set'}`);
      console.log(`   ├─ Delivery Time: ${order.delivery_time || 'Not set'}`);
      
      if (order.metadata_json) {
        console.log(`   └─ metadata_json STRUCTURE:`);
        console.log(`      ${JSON.stringify(order.metadata_json, null, 6).replace(/\n/g, '\n      ')}`);
      } else {
        console.log(`   └─ metadata_json: NULL or empty`);
      }
    });
  }
  
  // 4. Summary
  console.log('\n\n=== SCHEMA SUMMARY ===\n');
  console.log('h2s_orders:');
  console.log(`  ✓ Total columns: ${ordersSchema?.columns.length || 'ERROR'}`);
  console.log(`  ✓ Has metadata_json: ${ordersSchema?.columns.some(c => c.column_name === 'metadata_json') ? 'YES' : 'NO'}`);
  console.log(`  ✓ Has delivery_date: ${ordersSchema?.columns.some(c => c.column_name === 'delivery_date') ? 'YES' : 'NO'}`);
  console.log(`  ✓ Has delivery_time: ${ordersSchema?.columns.some(c => c.column_name === 'delivery_time') ? 'YES' : 'NO'}`);
  console.log(`  ✓ Has subtotal: ${ordersSchema?.columns.some(c => c.column_name === 'subtotal') ? 'YES' : 'NO'}`);
  
  console.log('\nh2s_dispatch_jobs:');
  console.log(`  ✓ Total columns: ${jobsSchema?.columns.length || 'ERROR'}`);
  console.log(`  ✗ Has metadata: ${jobsSchema?.columns.some(c => c.column_name === 'metadata') ? 'YES' : 'NO'}`);
  console.log(`  ✗ Has payout_estimated: ${jobsSchema?.columns.some(c => c.column_name === 'payout_estimated') ? 'YES' : 'NO'}`);
  console.log(`  ✓ Has order_id: ${jobsSchema?.columns.some(c => c.column_name === 'order_id') ? 'YES' : 'NO'}`);
  console.log(`  ✓ Has due_at: ${jobsSchema?.columns.some(c => c.column_name === 'due_at') ? 'YES' : 'NO'}`);
  
  console.log('\n=== END SCHEMA INSPECTION ===\n');
}

main().catch(console.error);

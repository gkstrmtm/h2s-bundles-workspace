// Check orders to see if they have valid addresses with geo data
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

let supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
let supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  try {
    const dotenv = fs.readFileSync('.env.local', 'utf8');
    const lines = dotenv.split('\n');
    lines.forEach(line => {
      let [k, v] = line.split('=');
      if (k && v) {
        v = v.trim().replace(/^["']|["']$/g, '');
        if (k.trim() === 'NEXT_PUBLIC_SUPABASE_URL' || k.trim() === 'SUPABASE_URL') supabaseUrl = v;
        if (k.trim() === 'SUPABASE_SERVICE_ROLE_KEY' || k.trim() === 'SUPABASE_SERVICE_KEY') supabaseKey = v;
      }
    });
  } catch (e) {}
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function inspectOrders() {
  console.log("🔍 Checking recent orders for address/geo data...\n");

  const { data: orders } = await supabase
    .from('h2s_orders')
    .select('order_id, customer_email, address, city, state, zip, metadata_json')
    .order('created_at', { ascending: false })
    .limit(10);

  if (!orders || orders.length === 0) {
    console.log("No orders found.");
    return;
  }

  orders.forEach((order, idx) => {
    const meta = order.metadata_json || {};
    console.log(`${idx + 1}. Order: ${order.order_id}`);
    console.log(`   Email: ${order.customer_email}`);
    console.log(`   Address: ${order.address || 'MISSING'}`);
    console.log(`   City: ${order.city || 'MISSING'}`);
    console.log(`   State: ${order.state || 'MISSING'}`);
    console.log(`   Zip: ${order.zip || 'MISSING'}`);
    console.log(`   Metadata geo_lat: ${meta.geo_lat || 'MISSING'}`);
    console.log(`   Metadata geo_lng: ${meta.geo_lng || 'MISSING'}`);
    console.log(`   Metadata service_zip: ${meta.service_zip || 'MISSING'}`);
    console.log(`   Job ID: ${meta.dispatch_job_id || 'NOT LINKED'}`);
    console.log('');
  });
}

inspectOrders();

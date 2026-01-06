// Manually geocode Greenwood SC 29649 and update all orders with that address
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

// Known coordinates for Greenwood, SC 29649
// (Can be verified at https://www.latlong.net/place/greenwood-sc-usa-16743.html)
const GREENWOOD_SC_COORDS = {
  lat: 34.1954,
  lng: -82.1618
};

async function updateGreenwoodOrders() {
  console.log("🌍 Updating Greenwood SC orders with coordinates...\n");

  const { data: orders } = await supabase
    .from('h2s_orders')
    .select('*')
    .eq('zip', '29649')
    .order('created_at', { ascending: false });

  if (!orders || orders.length === 0) {
    console.log("No Greenwood orders found.");
    return;
  }

  console.log(`Found ${orders.length} Greenwood SC orders to update.\n`);

  let processed = 0;
  let skipped = 0;

  for (const order of orders) {
    const meta = order.metadata_json || {};
    
    // Skip if already has geo data
    if (meta.geo_lat && meta.geo_lng) {
      skipped++;
      continue;
    }

    console.log(`📍 Updating Order: ${order.order_id}`);

    const updatedMeta = {
      ...meta,
      geo_lat: GREENWOOD_SC_COORDS.lat,
      geo_lng: GREENWOOD_SC_COORDS.lng,
      service_address: order.address || meta.service_address || '117 King Cir',
      service_city: order.city || meta.service_city || 'Greenwood',
      service_state: order.state || meta.service_state || 'SC',
      service_zip: order.zip || meta.service_zip || '29649'
    };

    const { error } = await supabase
      .from('h2s_orders')
      .update({ metadata_json: updatedMeta })
      .eq('order_id', order.order_id);

    if (error) {
      console.error(`   ❌ Failed: ${error.message}`);
    } else {
      console.log(`   ✅ Updated with Greenwood coords: ${GREENWOOD_SC_COORDS.lat}, ${GREENWOOD_SC_COORDS.lng}`);
      processed++;
    }
  }

  console.log(`\n📊 Update Complete.`);
  console.log(`   Updated: ${processed}`);
  console.log(`   Skipped (Already had coords): ${skipped}`);
}

updateGreenwoodOrders();

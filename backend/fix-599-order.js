require('dotenv').config({ path: '.env.production.local' });
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const ORDERS_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const ORDERS_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

const sb = createClient(ORDERS_URL, ORDERS_KEY);

async function fixOrder() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  FIXING ORDER ORD-1453D184');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  // Get the order
  const { data: order } = await sb
    .from('h2s_orders')
    .select('*')
    .eq('order_id', 'ORD-1453D184')
    .single();
  
  if (!order) {
    console.log('❌ Order not found');
    return;
  }
  
  // Parse items to get total
  let items = order.items || [];
  if (typeof items === 'string') {
    try { items = JSON.parse(items); } catch {}
  }
  
  const orderTotal = items.reduce((sum, item) => sum + (item.line_total || 0), 0);
  console.log(`Calculated order_total from items: $${orderTotal}`);
  
  // Calculate payout (35% of $599)
  const payout = Math.round(orderTotal * 0.35 * 100) / 100;
  console.log(`Calculated payout (35%): $${payout}`);
  
  // Geocode address
  console.log(`\nGeocoding: ${order.address}, ${order.city}, ${order.state} ${order.zip}...`);
  
  let geo_lat = null;
  let geo_lng = null;
  
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (key) {
    try {
      const addr = `${order.address}, ${order.city}, ${order.state} ${order.zip}`;
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(addr)}&key=${encodeURIComponent(key)}`;
      const resp = await fetch(url);
      const data = await resp.json();
      
      if (data.status === 'OK' && data.results[0]) {
        geo_lat = data.results[0].geometry.location.lat;
        geo_lng = data.results[0].geometry.location.lng;
        console.log(`✅ Geocoded: ${geo_lat}, ${geo_lng}`);
      }
    } catch (e) {
      console.log(`⚠️  Geocoding failed: ${e.message}`);
    }
  }
  
  // Update metadata
  const meta = order.metadata_json || {};
  const updatedMeta = {
    ...meta,
    estimated_payout: payout,
    items_json: items,
    service_address: order.address,
    service_city: order.city,
    service_state: order.state,
    service_zip: order.zip,
    geo_lat,
    geo_lng,
    backfilled_at: new Date().toISOString(),
  };
  
  // Update order
  console.log('\nUpdating order...');
  const { error } = await sb
    .from('h2s_orders')
    .update({
      order_total: orderTotal,
      order_subtotal: orderTotal,
      metadata_json: updatedMeta,
      updated_at: new Date().toISOString(),
    })
    .eq('order_id', 'ORD-1453D184');
  
  if (error) {
    console.log(`❌ Update failed: ${error.message}`);
  } else {
    console.log('✅ Order updated successfully!');
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  SUMMARY');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`✅ order_total: $${orderTotal}`);
    console.log(`✅ payout: $${payout}`);
    console.log(`✅ geo_lat: ${geo_lat}`);
    console.log(`✅ geo_lng: ${geo_lng}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('🔄 Now clear portal cache: localStorage.clear()');
    console.log('🔄 Then refresh portal to see the job\n');
  }
}

fixOrder();

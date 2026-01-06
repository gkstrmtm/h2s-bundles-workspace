// Geocode orders and add lat/lng to metadata
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

let supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
let supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
let googleApiKey = process.env.GOOGLE_MAPS_API_KEY;

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
        if (k.trim() === 'GOOGLE_MAPS_API_KEY') googleApiKey = v;
      }
    });
  } catch (e) {}
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function geocodeAddress(address, city, state, zip) {
  if (!googleApiKey) {
    console.warn("   ⚠️ No Google API key found, skipping geocode");
    return null;
  }

  const fullAddress = `${address}, ${city}, ${state} ${zip}`;
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(fullAddress)}&key=${encodeURIComponent(googleApiKey)}`;
  
  try {
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.status === 'OK' && data.results && data.results[0]) {
      const location = data.results[0].geometry.location;
      return { lat: location.lat, lng: location.lng };
    } else {
      console.warn(`   ⚠️ Geocode failed: ${data.status}`);
      return null;
    }
  } catch (err) {
    console.error(`   ❌ Geocode error: ${err.message}`);
    return null;
  }
}

async function geocodeOrders() {
  console.log("🌍 Starting Geocode Backfill for Orders...\n");

  const { data: orders } = await supabase
    .from('h2s_orders')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50);

  if (!orders || orders.length === 0) {
    console.log("No orders found.");
    return;
  }

  let processed = 0;
  let skipped = 0;
  let failed = 0;

  for (const order of orders) {
    const meta = order.metadata_json || {};
    
    // Skip if already has geo data
    if (meta.geo_lat && meta.geo_lng) {
      skipped++;
      continue;
    }

    // Skip if no address
    if (!order.address || !order.city || !order.state || !order.zip) {
      console.log(`⚠️ Order ${order.order_id}: Missing address data, skipping`);
      skipped++;
      continue;
    }

    console.log(`📍 Geocoding Order: ${order.order_id}`);
    console.log(`   Address: ${order.address}, ${order.city}, ${order.state} ${order.zip}`);

    const geo = await geocodeAddress(order.address, order.city, order.state, order.zip);
    
    if (geo) {
      // Update metadata with geo coordinates
      const updatedMeta = {
        ...meta,
        geo_lat: geo.lat,
        geo_lng: geo.lng,
        service_address: order.address,
        service_city: order.city,
        service_state: order.state,
        service_zip: order.zip
      };

      const { error } = await supabase
        .from('h2s_orders')
        .update({ metadata_json: updatedMeta })
        .eq('order_id', order.order_id);

      if (error) {
        console.error(`   ❌ Failed to update: ${error.message}`);
        failed++;
      } else {
        console.log(`   ✅ Geocoded: ${geo.lat}, ${geo.lng}`);
        processed++;
      }
    } else {
      failed++;
    }

    // Rate limit to avoid API quota
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  console.log(`\n📊 Geocode Complete.`);
  console.log(`   Geocoded: ${processed}`);
  console.log(`   Skipped (Already geocoded or no address): ${skipped}`);
  console.log(`   Failed: ${failed}`);
}

geocodeOrders();

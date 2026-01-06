// Update Pro profiles with missing geo coordinates based on their zip codes
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

// Known coordinates for key SC zip codes
const ZIP_COORDS = {
  '29649': { lat: 34.1954, lng: -82.1618, city: 'Greenwood' },
  '29229': { lat: 34.0522, lng: -80.8473, city: 'Columbia' },
  '29620': { lat: 34.5034, lng: -82.6501, city: 'Abbeville' },
};

async function updateProGeo() {
  console.log("🌍 Updating Pro profiles with missing geo coordinates...\n");

  const { data: pros } = await supabase
    .from('h2s_pros')
    .select('*');

  if (!pros || pros.length === 0) {
    console.log("No pros found.");
    return;
  }

  let processed = 0;
  let skipped = 0;

  for (const pro of pros) {
    // Skip if already has coords
    if (pro.geo_lat && pro.geo_lng) {
      skipped++;
      continue;
    }

    const zip5 = String(pro.home_zip || pro.zip || pro.service_zip || '').split('-')[0].trim();
    const coords = ZIP_COORDS[zip5];

    if (!coords) {
      console.log(`⚠️ Pro ${pro.email}: Unknown zip ${zip5}, skipping`);
      skipped++;
      continue;
    }

    console.log(`📍 Updating Pro: ${pro.email} (${coords.city}, ${zip5})`);

    const { error } = await supabase
      .from('h2s_pros')
      .update({
        geo_lat: coords.lat,
        geo_lng: coords.lng
      })
      .eq('pro_id', pro.pro_id);

    if (error) {
      console.error(`   ❌ Failed: ${error.message}`);
    } else {
      console.log(`   ✅ Updated: ${coords.lat}, ${coords.lng}`);
      processed++;
    }
  }

  console.log(`\n📊 Update Complete.`);
  console.log(`   Updated: ${processed}`);
  console.log(`   Skipped: ${skipped}`);
}

updateProGeo();

// Check Pro profiles to find active pros and their service areas
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

async function checkProProfiles() {
  console.log("🔍 Checking Pro Profiles for Service Area Configuration...\n");

  // Try common pro table names
  const tables = ['h2s_dispatch_pros', 'h2s_pros', 'H2S_Pros', 'h2s_pro_profiles', 'h2s_techs', 'h2s_technicians'];
  
  for (const table of tables) {
    try {
      const { data, error } = await supabase
        .from(table)
        .select('*')
        .limit(5);

      if (!error && data && data.length > 0) {
        console.log(`✅ Found pros in table: ${table}\n`);
        
        data.forEach((pro, idx) => {
          const keys = Object.keys(pro);
          console.log(`Pro #${idx + 1}:`);
          console.log(`  ID: ${pro.pro_id || pro.id || pro.tech_id || 'N/A'}`);
          console.log(`  Email: ${pro.email || pro.pro_email || pro.tech_email || 'N/A'}`);
          console.log(`  Name: ${pro.name || pro.full_name || pro.first_name || 'N/A'}`);
          console.log(`  Zip: ${pro.zip || pro.home_zip || pro.service_zip || 'N/A'}`);
          console.log(`  Lat: ${pro.geo_lat || pro.lat || pro.latitude || 'N/A'}`);
          console.log(`  Lng: ${pro.geo_lng || pro.lng || pro.longitude || 'N/A'}`);
          console.log(`  Service Radius: ${pro.service_radius_miles || pro.radius_miles || 'N/A'} miles`);
          console.log(`  Active: ${pro.active || pro.is_active || 'N/A'}`);
          console.log('');
        });
        
        return; // Stop after finding first valid table
      }
    } catch (e) {
      // Skip this table
    }
  }

  console.log("❌ Could not find any pro profiles in common tables.");
}

checkProProfiles();

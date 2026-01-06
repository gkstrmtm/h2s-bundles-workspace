// List all Pro accounts in the database
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

async function listAllPros() {
  console.log("🔍 Fetching all Pro accounts...\n");

  const { data: pros, error } = await supabase
    .from('h2s_pros')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error("❌ Error:", error.message);
    return;
  }

  if (!pros || pros.length === 0) {
    console.log("No Pro accounts found.");
    return;
  }

  console.log(`Found ${pros.length} Pro accounts:\n`);

  pros.forEach((pro, idx) => {
    console.log(`${idx + 1}. ${pro.name || 'N/A'}`);
    console.log(`   Email: ${pro.email}`);
    console.log(`   Pro ID: ${pro.pro_id}`);
    console.log(`   Home Zip: ${pro.home_zip || 'N/A'}`);
    console.log(`   Geo: ${pro.geo_lat || 'N/A'}, ${pro.geo_lng || 'N/A'}`);
    console.log(`   Service Radius: ${pro.service_radius_miles || 'N/A'} miles`);
    console.log(`   Active: ${pro.is_active}`);
    console.log(`   Available Now: ${pro.is_available_now || 'N/A'}`);
    console.log('');
  });
}

listAllPros();

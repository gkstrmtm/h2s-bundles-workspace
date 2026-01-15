/**
 * SEED TECHNICIAN RECORDS
 * 
 * The h2s_dispatch_pros table is empty, causing portal to show no jobs.
 * This script creates initial technician records.
 */

require('dotenv').config({ path: '.env.production.local' });
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.error('❌ Missing env vars');
  process.exit(1);
}

const dispatch = createClient(supabaseUrl, serviceKey);

async function seedTechnicians() {
  console.log('🌱 SEEDING TECHNICIAN RECORDS\n');
  console.log('='.repeat(60));

  // Get schema for h2s_dispatch_pros
  const { data: sampleRows } = await dispatch
    .from('h2s_dispatch_pros')
    .select('*')
    .limit(1);

  console.log('\n📋 Table schema detected:');
  if (sampleRows && sampleRows.length > 0) {
    console.log('   Columns:', Object.keys(sampleRows[0]).join(', '));
  } else {
    console.log('   Table is empty - will use standard schema');
  }

  // Default technician record
  const defaultTech = {
    name: 'H2S Technician',
    email: 'tech@home2smart.com',
    phone: '(864) 528-1475',
    home_address: '123 Main St',
    city: 'Greenville',
    state: 'SC',
    home_zip: '29601',
    geo_lat: 34.8526,
    geo_lng: -82.394,
    service_radius_miles: 35,
    status: 'active',
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  console.log('\n✅ Creating default technician...\n');
  console.log(JSON.stringify(defaultTech, null, 2));

  const { data: inserted, error } = await dispatch
    .from('h2s_dispatch_pros')
    .insert([defaultTech])
    .select();

  if (error) {
    // Try with fewer fields if schema doesn't match
    console.log('\n⚠️  Full insert failed:', error.message);
    console.log('   Retrying with minimal fields...\n');

    const minimalTech = {
      name: defaultTech.name,
      email: defaultTech.email,
      phone: defaultTech.phone,
      geo_lat: defaultTech.geo_lat,
      geo_lng: defaultTech.geo_lng
    };

    const { data: inserted2, error: error2 } = await dispatch
      .from('h2s_dispatch_pros')
      .insert([minimalTech])
      .select();

    if (error2) {
      console.error('❌ Failed to create technician:', error2.message);
      console.error('   Error details:', error2);
      process.exit(1);
    }

    console.log('✅ Created minimal technician record:', inserted2[0].pro_id || inserted2[0].id);
  } else {
    console.log('✅ Created technician:', inserted[0].pro_id || inserted[0].id);
  }

  // Verify
  const { data: allPros, error: checkErr } = await dispatch
    .from('h2s_dispatch_pros')
    .select('*');

  if (checkErr) {
    console.error('❌ Failed to verify:', checkErr.message);
  } else {
    console.log('\n' + '='.repeat(60));
    console.log(`✅ SUCCESS: h2s_dispatch_pros now has ${allPros.length} technician(s)`);
    console.log('\nNext steps:');
    console.log('1. Open dispatch.html');
    console.log('2. Go to "Pro Management" tab');
    console.log('3. Click on technician to edit/activate');
    console.log('4. Update address and ensure geo coordinates are set');
    console.log('5. Test portal login with tech@home2smart.com');
  }
}

seedTechnicians().catch(console.error);

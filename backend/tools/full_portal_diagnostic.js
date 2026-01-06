// Comprehensive diagnostic for Portal job visibility
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

async function comprehensiveDiagnostic() {
  console.log("🔍 COMPREHENSIVE PORTAL DIAGNOSTIC\n");
  console.log("=".repeat(60) + "\n");

  // 1. Check Pro Profile
  console.log("1️⃣ CHECKING PRO PROFILE (Robert Bland)");
  const { data: pro } = await supabase
    .from('h2s_pros')
    .select('*')
    .eq('email', 'rbland.bluehorizoncontractors@gmail.com')
    .single();

  if (!pro) {
    console.log("❌ Pro not found!\n");
    return;
  }

  console.log(`   ✅ Pro ID: ${pro.pro_id}`);
  console.log(`   ✅ Name: ${pro.name}`);
  console.log(`   ✅ Email: ${pro.email}`);
  console.log(`   ✅ Home Zip: ${pro.home_zip}`);
  console.log(`   ✅ Geo Lat: ${pro.geo_lat}`);
  console.log(`   ✅ Geo Lng: ${pro.geo_lng}`);
  console.log(`   ✅ Service Radius: ${pro.service_radius_miles} miles`);
  console.log(`   ✅ Active: ${pro.is_active}\n`);

  // 2. Check Jobs Status
  console.log("2️⃣ CHECKING DISPATCH JOBS TABLE");
  const { data: allJobs, count } = await supabase
    .from('h2s_dispatch_jobs')
    .select('*', { count: 'exact' });

  console.log(`   Total Jobs in h2s_dispatch_jobs: ${count}`);
  
  const queuedJobs = allJobs.filter(j => j.status === 'queued');
  console.log(`   Jobs with status='queued': ${queuedJobs.length}`);
  
  if (queuedJobs.length > 0) {
    console.log(`   Sample queued job: ${queuedJobs[0].job_id}\n`);
  }

  // 3. Check Order Enrichment
  console.log("3️⃣ CHECKING ORDER LINKAGE & ENRICHMENT");
  const { data: orders } = await supabase
    .from('h2s_orders')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(10);

  let linkedCount = 0;
  let withGeoCount = 0;
  let greenwoodCount = 0;

  orders.forEach(o => {
    const meta = o.metadata_json || {};
    if (meta.dispatch_job_id) linkedCount++;
    if (meta.geo_lat && meta.geo_lng) withGeoCount++;
    if (o.zip === '29649') greenwoodCount++;
  });

  console.log(`   Recent orders with dispatch_job_id: ${linkedCount}/10`);
  console.log(`   Recent orders with geo coordinates: ${withGeoCount}/10`);
  console.log(`   Greenwood SC (29649) orders: ${greenwoodCount}/10\n`);

  // 4. Check Assignments (might be blocking)
  console.log("4️⃣ CHECKING JOB ASSIGNMENTS");
  const assignTables = ['h2s_dispatch_job_assignments', 'dispatch_job_assignments'];
  
  for (const table of assignTables) {
    try {
      const { data, error } = await supabase.from(table).select('*').limit(5);
      if (!error && data) {
        console.log(`   ✅ Found assignment table: ${table}`);
        console.log(`   Sample rows: ${data.length}`);
        if (data.length > 0) {
          console.log(`   Sample: ${JSON.stringify(data[0], null, 2).substring(0, 200)}...\n`);
        }
        break;
      }
    } catch (e) {
      // ignore
    }
  }

  // 5. Manual Distance Calculation
  console.log("5️⃣ MANUAL DISTANCE CALCULATION FOR QUEUED JOBS");
  
  for (const job of queuedJobs) {
    // Find linked order
    const linkedOrder = orders.find(o => {
      const meta = o.metadata_json || {};
      return meta.dispatch_job_id === job.job_id;
    });

    if (!linkedOrder) {
      console.log(`   ⚠️ Job ${job.job_id}: No linked order found`);
      continue;
    }

    const meta = linkedOrder.metadata_json || {};
    const jobLat = meta.geo_lat;
    const jobLng = meta.geo_lng;

    if (!jobLat || !jobLng) {
      console.log(`   ❌ Job ${job.job_id}: Order ${linkedOrder.order_id} missing geo`);
      continue;
    }

    // Calculate distance
    const R = 3959;
    const toRad = (deg) => (deg * Math.PI) / 180;
    const dLat = toRad(jobLat - pro.geo_lat);
    const dLon = toRad(jobLng - pro.geo_lng);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(pro.geo_lat)) * Math.cos(toRad(jobLat)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c;

    const inRange = distance <= pro.service_radius_miles;
    const icon = inRange ? '✅' : '❌';

    console.log(`   ${icon} Job ${job.job_id}`);
    console.log(`      Order: ${linkedOrder.order_id}`);
    console.log(`      Address: ${linkedOrder.address}, ${linkedOrder.city} ${linkedOrder.zip}`);
    console.log(`      Geo: ${jobLat}, ${jobLng}`);
    console.log(`      Distance: ${Math.round(distance * 10) / 10} miles`);
    console.log(`      In Range (${pro.service_radius_miles} mi): ${inRange ? 'YES' : 'NO'}\n`);
  }

  console.log("\n" + "=".repeat(60));
  console.log("✅ DIAGNOSTIC COMPLETE\n");
}

comprehensiveDiagnostic();

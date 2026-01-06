// Simulate Portal job fetch logic to verify everything works
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

function haversineMiles(lat1, lon1, lat2, lon2) {
  const R = 3959;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

async function simulatePortalFetch() {
  console.log("🔍 Simulating Portal Job Fetch for Greenwood SC Pro...\n");

  // 1. Get Pro (Robert Bland - Greenwood)
  const { data: pro } = await supabase
    .from('h2s_pros')
    .select('*')
    .eq('email', 'rbland.bluehorizoncontractors@gmail.com')
    .single();

  if (!pro) {
    console.log("❌ Pro not found");
    return;
  }

  console.log("✅ Pro Found:");
  console.log(`   Name: ${pro.name}`);
  console.log(`   Zip: ${pro.home_zip}`);
  console.log(`   Lat/Lng: ${pro.geo_lat}, ${pro.geo_lng}`);
  console.log(`   Service Radius: ${pro.service_radius_miles} miles\n`);

  // 2. Get available jobs (status='queued')
  const { data: jobs } = await supabase
    .from('h2s_dispatch_jobs')
    .select('*')
    .eq('status', 'queued')
    .limit(20);

  console.log(`✅ Found ${jobs.length} queued jobs\n`);

  // 3. Enrich jobs with Order data
  const jobIds = jobs.map(j => j.job_id);
  const { data: orders } = await supabase
    .from('h2s_orders')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50);

  const orderByJobId = new Map();
  orders.forEach(o => {
    const meta = o.metadata_json || {};
    const jid = meta.dispatch_job_id;
    if (jid) orderByJobId.set(jid, o);
  });

  // 4. Calculate distances and filter
  const enrichedJobs = jobs.map(j => {
    const order = orderByJobId.get(j.job_id);
    if (!order) return null;

    const meta = order.metadata_json || {};
    const jobLat = meta.geo_lat;
    const jobLng = meta.geo_lng;
    const jobZip = order.zip || meta.service_zip;

    if (!jobLat || !jobLng) {
      console.log(`⚠️ Job ${j.job_id}: No geo coordinates`);
      return null;
    }

    const distance = haversineMiles(pro.geo_lat, pro.geo_lng, jobLat, jobLng);

    return {
      job_id: j.job_id,
      order_id: order.order_id,
      customer_email: order.customer_email,
      address: order.address,
      city: order.city,
      zip: jobZip,
      geo_lat: jobLat,
      geo_lng: jobLng,
      distance_miles: Math.round(distance * 10) / 10,
      in_range: distance <= pro.service_radius_miles
    };
  }).filter(j => j !== null);

  console.log("📊 Enriched Jobs with Distance Calculation:\n");

  enrichedJobs.forEach(j => {
    const icon = j.in_range ? '✅' : '❌';
    console.log(`${icon} Job: ${j.job_id}`);
    console.log(`   Order: ${j.order_id}`);
    console.log(`   Customer: ${j.customer_email}`);
    console.log(`   Location: ${j.address}, ${j.city} ${j.zip}`);
    console.log(`   Coordinates: ${j.geo_lat}, ${j.geo_lng}`);
    console.log(`   Distance: ${j.distance_miles} miles`);
    console.log(`   In Range: ${j.in_range ? 'YES' : 'NO'}`);
    console.log('');
  });

  const visibleJobs = enrichedJobs.filter(j => j.in_range);
  console.log(`\n🎯 RESULT: ${visibleJobs.length} jobs will be visible to this Pro in the Portal`);
}

simulatePortalFetch();

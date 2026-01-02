const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

function loadEnv(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    content.split('\n').forEach(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const [key, ...valueParts] = trimmed.split('=');
      if (key) {
        const value = valueParts.join('=').trim().replace(/^['"]|['"]$/g, '');
        process.env[key.trim()] = value;
      }
    });
  } catch (e) {}
}

loadEnv(path.join(__dirname, '.env.local'));

async function trace() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  const client = createClient(url, key);
  
  console.log('\n=== TRACING DATA FLOW ===\n');
  
  // 1. Get last job
  const { data: jobs, error } = await client
    .from('h2s_dispatch_jobs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1);
  
  if (error || !jobs || jobs.length === 0) {
    console.error('❌ No jobs found');
    return;
  }
  
  const job = jobs[0];
  console.log('📋 JOB IN DATABASE:');
  console.log('  job_id:', job.job_id);
  console.log('  customer_name:', job.customer_name || '❌ NULL');
  console.log('  customer_phone:', job.customer_phone || '❌ NULL');
  console.log('  customer_email:', job.customer_email || '❌ NULL');
  console.log('  service_address:', job.service_address || '❌ NULL');
  console.log('  service_city:', job.service_city || '❌ NULL');
  console.log('  service_state:', job.service_state || '❌ NULL');
  
  // 2. Check metadata
  const metadata = typeof job.metadata === 'string' ? JSON.parse(job.metadata) : job.metadata;
  console.log('\n📦 METADATA:');
  console.log('  customer_name:', metadata?.customer_name || '❌ MISSING');
  console.log('  customer_phone:', metadata?.customer_phone || '❌ MISSING');
  console.log('  service_address:', metadata?.service_address || '❌ MISSING');
  console.log('  service_city:', metadata?.service_city || '❌ MISSING');
  
  // 3. Get assignment
  const { data: assignments } = await client
    .from('h2s_dispatch_offer_assignments')
    .select('*')
    .eq('job_id', job.job_id)
    .limit(1);
  
  if (assignments && assignments.length > 0) {
    const assign = assignments[0];
    console.log('\n🎯 ASSIGNMENT:');
    console.log('  state:', assign.state || assign.assign_state);
    console.log('  tech_id:', assign.tech_id);
  }
  
  // 4. Simulate what portal_customers returns
  console.log('\n🔍 WHAT PORTAL WILL RETURN:');
  const customer_name = job.customer_name || metadata?.customer_name || null;
  const customer_phone = job.customer_phone || metadata?.customer_phone || null;
  const service_address = job.service_address || metadata?.service_address || null;
  
  console.log('  customer_name:', customer_name || '❌ NULL (PROBLEM!)');
  console.log('  customer_phone:', customer_phone || '❌ NULL (PROBLEM!)');
  console.log('  service_address:', service_address || '❌ NULL (PROBLEM!)');
  
  if (!customer_name || !customer_phone || !service_address) {
    console.log('\n🔥 PROBLEM IDENTIFIED:');
    console.log('   Data is in metadata but NOT in first-class columns!');
    console.log('   The INSERT or UPDATE is failing to write to columns.');
  } else {
    console.log('\n✅ Data looks good!');
  }
}

trace().catch(console.error);

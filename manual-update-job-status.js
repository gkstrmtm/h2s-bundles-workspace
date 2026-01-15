// Manual script to update job status to 'scheduled'
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, 'backend', '.env.local') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const jobId = process.argv[2];
if (!jobId) {
  console.error('Usage: node manual-update-job-status.js <job_id>');
  process.exit(1);
}

async function updateJobStatus() {
  console.log(`\n=== Updating job ${jobId} to status='scheduled' ===\n`);
  
  const { data, error } = await sb
    .from('h2s_dispatch_jobs')
    .update({ status: 'scheduled', updated_at: new Date().toISOString() })
    .eq('job_id', jobId)
    .select();
  
  if (error) {
    console.error('❌ Error:', error);
  } else {
    console.log('✅ SUCCESS - Updated rows:', data?.length);
    if (data?.[0]) {
      console.log('  job_id:', data[0].job_id);
      console.log('  status:', data[0].status);
      console.log('  updated_at:', data[0].updated_at);
    }
  }
}

updateJobStatus().then(() => process.exit(0));

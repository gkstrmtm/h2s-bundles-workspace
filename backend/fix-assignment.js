require('dotenv').config({ path: '.env.production.local' });
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function main() {
  const JOB_ID = '3781bc3e-ff23-4a10-a10b-8cf62c8ba824';
  
  console.log('\n🔧 Fixing job assignment...\n');
  
  // Get a real pro
  const { data: pros } = await supabase
    .from('h2s_pros')
    .select('pro_id, email, first_name, last_name, status')
    .limit(5);
    
  if (!pros || pros.length === 0) {
    console.log('❌ No active pros found!');
    return;
  }
  
  const realPro = pros[0];
  console.log(`✅ Found real pro: ${realPro.email} (${realPro.pro_id.substring(0, 8)}...)`);
  
  // Update assignment to use real pro
  const { error } = await supabase
    .from('h2s_dispatch_job_assignments')
    .update({ pro_id: realPro.pro_id })
    .eq('job_id', JOB_ID);
    
  if (error) {
    console.error('❌ Failed to update assignment:', error.message);
  } else {
    console.log('✅ Job reassigned to real pro!');
    console.log(`\n🎉 Job should now appear in portal for ${realPro.email}`);
  }
}
main();

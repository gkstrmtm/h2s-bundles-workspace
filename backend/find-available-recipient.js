require('dotenv').config({ path: '.env.production.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function main() {
  console.log('\n🔍 Finding available recipients (pros)...\n');
  
  // Get all pros
  const { data: pros, error: prosError } = await supabase
    .from('h2s_pros')
    .select('pro_id, email, status')
    .limit(20);
    
  if (prosError) {
    console.error('Error fetching pros:', prosError);
    return;
  }
  
  console.log(`Found ${pros.length} pros`);
  
  // Get busy recipient_ids (already have jobs at this step)
  const STEP_ID = 'd30da333-3a54-4598-8ac1-f3b276185ea1';
  const { data: busyJobs } = await supabase
    .from('h2s_dispatch_jobs')
    .select('recipient_id')
    .eq('step_id', STEP_ID);
    
  const busyRecipients = new Set(busyJobs.map(j => j.recipient_id));
  console.log(`\n${busyRecipients.size} recipients are busy at step ${STEP_ID.substring(0, 8)}:`);
  busyRecipients.forEach(id => console.log(`  - ${id.substring(0, 8)}`));
  
  // Find available pros
  const availablePros = pros.filter(p => !busyRecipients.has(p.pro_id));
  
  console.log(`\n✅ ${availablePros.length} available pros:`);
  availablePros.slice(0, 5).forEach(p => {
    console.log(`  - ${p.pro_id} (${p.email || 'no email'}) - status: ${p.status || 'unknown'}`);
  });
  
  if (availablePros.length > 0) {
    console.log(`\n✨ Recommended recipient_id for new job: ${availablePros[0].pro_id}`);
  } else {
    console.log(`\n⚠️  All pros are busy! Need to either:`);
    console.log(`   1. Complete/remove existing jobs`);
    console.log(`   2. Add more pros`);
    console.log(`   3. Use a different step_id`);
  }
}

main();

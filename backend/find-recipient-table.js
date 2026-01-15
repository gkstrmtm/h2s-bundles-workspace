require('dotenv').config({ path: '.env.production.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function main() {
  console.log('\n🔍 Finding what table contains valid recipient IDs...\n');
  
  // Get a valid recipient_id from existing job
  const { data: jobs } = await supabase
    .from('h2s_dispatch_jobs')
    .select('recipient_id')
    .limit(1);
    
  if (!jobs || jobs.length === 0) {
    console.log('No jobs found');
    return;
  }
  
  const validRecipientId = jobs[0].recipient_id;
  console.log(`Valid recipient ID from existing job: ${validRecipientId}`);
  
  // Try to find this ID in various tables
  const tables = [
    'h2s_pros',
    'h2s_dispatch_pros',
    'h2s_dispatch_recipients',
    'h2s_recipients',
    'dispatch_pros',
    'dispatch_recipients',
    'pros',
    'recipients',
    'h2s_users',
    'users'
  ];
  
  for (const table of tables) {
    try {
      // Try common ID column names
      const idCols = ['id', 'pro_id', 'recipient_id', 'user_id', 'tech_id'];
      
      for (const col of idCols) {
        const { data, error } = await supabase
          .from(table)
          .select('*')
          .eq(col, validRecipientId)
          .limit(1);
          
        if (!error && data && data.length > 0) {
          console.log(`\n✅ FOUND in table '${table}', column '${col}'!`);
          console.log(`Sample data:`, JSON.stringify(data[0], null, 2));
          return;
        }
      }
    } catch (e) {
      // Table doesn't exist, skip
    }
  }
  
  console.log(`\n❌ Could not find ${validRecipientId} in any table`);
  console.log(`This suggests the FK constraint may have been disabled or references a table we can't access`);
}

main();

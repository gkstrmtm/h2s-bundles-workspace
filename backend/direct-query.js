require('dotenv').config({ path: '.env.production.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function main() {
  console.log('\n Direct database query...\n');
  
  // Query dispatch jobs with status=queued
  const { data: jobs } = await supabase
    .from('h2s_dispatch_jobs')
    .select('*')
    .eq('status', 'queued');
    
  console.log(`Found ${jobs ? jobs.length : 0} queued dispatch jobs`);
  
  // Query orders with dispatch_job_id
  const { data: orders } = await supabase
    .from('h2s_orders')
    .select('order_id, total, metadata_json')
    .not('metadata_json->>dispatch_job_id', 'is', null);
    
  console.log(`Found ${orders ? orders.length : 0} orders with dispatch_job_id\n`);
  
  if (orders) {
    orders.forEach(o => {
      const meta = o.metadata_json || {};
      console.log(`  - ${o.order_id}: $${o.total} (job: ${meta.dispatch_job_id}, payout: $${meta.estimated_payout || 0})`);
    });
  }
  
  // Check our specific order
  const { data: targetOrder } = await supabase
    .from('h2s_orders')
    .select('*')
    .eq('order_id', 'ORD-1453D184')
    .single();
    
  if (targetOrder) {
    console.log('\n Target order ORD-1453D184:');
    console.log(`   total: $${targetOrder.total}`);
    console.log(`   metadata_json:`, JSON.stringify(targetOrder.metadata_json, null, 2));
  }
}
main();

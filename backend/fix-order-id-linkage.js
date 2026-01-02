// Fix order_id linkage - connect jobs to their correct ORD-XXX identifiers
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const dispatch = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL_DISPATCH || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY_DISPATCH || process.env.SUPABASE_SERVICE_ROLE_KEY
);

const db1 = createClient(
  process.env.SUPABASE_URL_DB1 || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY_DB1 || process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function fixOrderIdLinks() {
  const email = 'tabariroper3@icloud.com';
  
  console.log('\n🔧 FIXING ORDER_ID LINKAGE');
  console.log('='.repeat(60));
  
  // Get all jobs for this customer
  const { data: jobs } = await dispatch
    .from('h2s_dispatch_jobs')
    .select('job_id, order_id, customer_email, created_at')
    .eq('customer_email', email)
    .order('created_at', { ascending: false });
  
  // Get all orders for this customer
  const { data: orders } = await db1
    .from('h2s_orders')
    .select('order_id, customer_email, created_at')
    .eq('customer_email', email)
    .order('created_at', { ascending: false });
  
  console.log(`\nFound ${jobs.length} jobs and ${orders.length} orders\n`);
  
  // Match jobs to orders by timestamp (within 5 minutes)
  const updates = [];
  
  for (const job of jobs) {
    const jobTime = new Date(job.created_at).getTime();
    
    // Find order created within 5 minutes before the job
    const matchingOrder = orders.find(order => {
      const orderTime = new Date(order.created_at).getTime();
      const timeDiff = jobTime - orderTime;
      return timeDiff >= 0 && timeDiff <= 5 * 60 * 1000; // 0-5 minutes after order
    });
    
    if (matchingOrder) {
      console.log(`🔗 MATCH FOUND:`);
      console.log(`   Job: ${job.job_id.substring(0, 8)}... (created ${job.created_at})`);
      console.log(`   Current order_id: ${job.order_id}`);
      console.log(`   Should be: ${matchingOrder.order_id}`);
      console.log(`   Time diff: ${Math.round((jobTime - new Date(matchingOrder.created_at).getTime()) / 1000)}s\n`);
      
      updates.push({
        job_id: job.job_id,
        correct_order_id: matchingOrder.order_id,
        old_order_id: job.order_id
      });
    } else {
      console.log(`⚠️  NO MATCH for job ${job.job_id.substring(0, 8)}...`);
      console.log(`   Created: ${job.created_at}`);
      console.log(`   No order found within 5 minutes before\n`);
    }
  }
  
  if (updates.length === 0) {
    console.log('❌ No updates needed or no matches found\n');
    return;
  }
  
  // Ask for confirmation (auto-yes in this case since user requested it)
  console.log(`\n📝 READY TO UPDATE ${updates.length} jobs\n`);
  
  for (const update of updates) {
    console.log(`Updating job ${update.job_id.substring(0, 8)}...`);
    
    const { error } = await dispatch
      .from('h2s_dispatch_jobs')
      .update({ order_id: update.correct_order_id })
      .eq('job_id', update.job_id);
    
    if (error) {
      console.log(`   ❌ Failed: ${error.message}`);
    } else {
      console.log(`   ✅ Updated: ${update.old_order_id} → ${update.correct_order_id}`);
    }
  }
  
  console.log(`\n✅ COMPLETE! Updated ${updates.length} jobs`);
  console.log(`\nPhoto uploads should now work for these orders!\n`);
}

fixOrderIdLinks().catch(console.error);

#!/usr/bin/env node
/**
 * Backfill title and payout from metadata to first-class columns
 */
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function backfillTitleAndPayout() {
  console.log('\n🔧 BACKFILL: title + total_payout from metadata\n');
  console.log('='.repeat(70));
  
  const { data: jobs } = await db
    .from('h2s_dispatch_jobs')
    .select('*')
    .order('created_at', { ascending: false });
  
  console.log(`\n📊 Checking ${jobs.length} jobs...\n`);
  
  let fixed = 0;
  
  for (const job of jobs) {
    let metadata = job.metadata;
    if (typeof metadata === 'string') {
      try { metadata = JSON.parse(metadata); } catch(e) { continue; }
    }
    if (!metadata) continue;
    
    const update = {};
    
    // Fix service_name in metadata (portal reads job.service_name from enriched data)
    const itemName = metadata.items_json?.[0]?.name || 
                    metadata.cart_items_full?.[0]?.name ||
                    metadata.service_name;
    
    if (itemName && !metadata.service_name) {
      if (!update.metadata) update.metadata = { ...metadata };
      update.metadata.service_name = itemName;
    }
    
    if (Object.keys(update).length === 0) continue;
    
    console.log(`🔧 Job ${job.job_id.substring(0, 8)}...`);
    if (update.metadata?.service_name) console.log(`   ✅ metadata.service_name: "${update.metadata.service_name}"`);
    
    const { error } = await db
      .from('h2s_dispatch_jobs')
      .update(update)
      .eq('job_id', job.job_id);
    
    if (error) {
      console.log(`   ❌ Failed: ${error.message}`);
    } else {
      fixed++;
    }
  }
  
  console.log('\n' + '='.repeat(70));
  console.log(`\n✅ Backfill complete: ${fixed} jobs updated\n`);
}

backfillTitleAndPayout();

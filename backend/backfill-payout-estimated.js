// Backfill script to populate payout_estimated column for existing dispatch jobs
require('dotenv').config({ path: '.env.production.local' });
require('dotenv').config({ path: '.env.local' });
require('dotenv').config({ path: '.env' });

const { createClient } = require('@supabase/supabase-js');

const DISPATCH_URL = process.env.SUPABASE_URL_DISPATCH || process.env.SUPABASE_URL;
const DISPATCH_KEY = process.env.SUPABASE_SERVICE_KEY_DISPATCH || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!DISPATCH_URL || !DISPATCH_KEY) {
  console.error('❌ Missing dispatch database credentials');
  console.error('   Checked: SUPABASE_URL_DISPATCH, SUPABASE_URL');
  console.error('   Checked: SUPABASE_SERVICE_KEY_DISPATCH, SUPABASE_SERVICE_KEY, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const sb = createClient(DISPATCH_URL, DISPATCH_KEY);

// Payout calculation logic (matches schedule-appointment)
function estimatePayout(orderTotal, lineItems = []) {
  const BASE_RATE = 0.35; // 35%
  const MIN_STANDARD = 35;
  const MIN_TV = 45;
  const CAP_RATE = 0.45; // 45% cap
  
  let basePayout = orderTotal * BASE_RATE;
  
  // Check if this is TV mounting (higher minimum)
  const isTVMounting = lineItems.some(item => {
    const name = String(item.name || item.service_name || '').toLowerCase();
    const variant = String(item.variant_code || '').toLowerCase();
    return name.includes('tv') || name.includes('mount') || variant.includes('tv');
  });
  
  const minPayout = isTVMounting ? MIN_TV : MIN_STANDARD;
  const cappedPayout = orderTotal * CAP_RATE;
  
  // Apply minimum and cap
  let finalPayout = Math.max(basePayout, minPayout);
  finalPayout = Math.min(finalPayout, cappedPayout);
  
  return Math.round(finalPayout * 100) / 100; // Round to 2 decimals
}

async function backfillPayouts() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  BACKFILL PAYOUT_ESTIMATED');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  try {
    // Step 1: Fetch all jobs with missing or zero payout_estimated
    console.log('[1/4] Fetching jobs with missing payout_estimated...');
    const { data: jobs, error: fetchError } = await sb
      .from('h2s_dispatch_jobs')
      .select('*')
      .or('payout_estimated.is.null,payout_estimated.eq.0')
      .order('created_at', { ascending: false });
    
    if (fetchError) {
      console.error('❌ Error fetching jobs:', fetchError.message);
      return;
    }
    
    console.log(`✅ Found ${jobs.length} jobs needing payout calculation\n`);
    
    if (jobs.length === 0) {
      console.log('✨ All jobs already have payout_estimated populated!');
      return;
    }
    
    // Step 2: Calculate payouts
    console.log('[2/4] Calculating payouts...');
    const updates = [];
    
    for (const job of jobs) {
      // Try different possible column names for order total
      const orderTotal = Number(
        job.order_total || 
        job.total || 
        job.amount_total ||
        job.metadata?.order_total || 
        job.metadata?.total ||
        0
      );
      
      if (orderTotal === 0) {
        console.log(`⚠️  Job ${job.job_id}: No order total, skipping`);
        continue;
      }
      
      // Parse line_items if string
      let lineItems = job.line_items || job.metadata?.items_json || [];
      if (typeof lineItems === 'string') {
        try {
          lineItems = JSON.parse(lineItems);
        } catch {
          lineItems = [];
        }
      }
      
      const calculatedPayout = estimatePayout(orderTotal, lineItems);
      
      // Update metadata to include estimated_payout
      const updatedMetadata = {
        ...(job.metadata || {}),
        estimated_payout: calculatedPayout,
        backfilled_at: new Date().toISOString(),
      };
      
      updates.push({
        job_id: job.job_id,
        payout_estimated: calculatedPayout,
        metadata: updatedMetadata,
        order_total: orderTotal,
      });
      
      console.log(`  ${job.job_id}: $${orderTotal} → $${calculatedPayout} payout`);
    }
    
    console.log(`\n✅ Calculated ${updates.length} payouts\n`);
    
    // Step 3: Batch update (do in chunks of 50)
    console.log('[3/4] Updating database...');
    const BATCH_SIZE = 50;
    let updated = 0;
    let failed = 0;
    
    for (let i = 0; i < updates.length; i += BATCH_SIZE) {
      const batch = updates.slice(i, i + BATCH_SIZE);
      
      for (const update of batch) {
        const { error: updateError } = await sb
          .from('h2s_dispatch_jobs')
          .update({
            payout_estimated: update.payout_estimated,
            metadata: update.metadata,
            updated_at: new Date().toISOString(),
          })
          .eq('job_id', update.job_id);
        
        if (updateError) {
          console.error(`  ❌ Failed to update ${update.job_id}: ${updateError.message}`);
          failed++;
        } else {
          updated++;
        }
      }
      
      console.log(`  Progress: ${Math.min(i + BATCH_SIZE, updates.length)}/${updates.length}`);
    }
    
    // Step 4: Verify
    console.log('\n[4/4] Verifying updates...');
    const { data: remaining, error: verifyError } = await sb
      .from('h2s_dispatch_jobs')
      .select('job_id')
      .or('payout_estimated.is.null,payout_estimated.eq.0')
      .limit(10);
    
    if (verifyError) {
      console.error('⚠️  Verification failed:', verifyError.message);
    } else {
      console.log(`  Remaining jobs without payout: ${remaining.length}`);
    }
    
    // Summary
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  BACKFILL COMPLETE');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`✅ Successfully updated: ${updated}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`📊 Total processed: ${updates.length}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
  } catch (err) {
    console.error('\n❌ FATAL ERROR:', err.message);
    console.error(err.stack);
  }
}

// Run the backfill
backfillPayouts().then(() => {
  console.log('Script completed. You can now refresh your portal to see updated payouts.');
  process.exit(0);
}).catch(err => {
  console.error('Script failed:', err);
  process.exit(1);
});

#!/usr/bin/env node
// Backfill script to populate estimated_payout in metadata for existing dispatch jobs
require('dotenv').config({ path: '.env.production.local' });
require('dotenv').config({ path: '.env.local' });
require('dotenv').config({ path: '.env' });

const { createClient } = require('@supabase/supabase-js');

const DISPATCH_URL = process.env.SUPABASE_URL_DISPATCH || process.env.SUPABASE_URL;
const DISPATCH_KEY = process.env.SUPABASE_SERVICE_KEY_DISPATCH || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!DISPATCH_URL || !DISPATCH_KEY) {
  console.error('❌ Missing dispatch database credentials');
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
  console.log('  BACKFILL ESTIMATED_PAYOUT IN METADATA');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  try {
    // Fetch all jobs
    console.log('[1/2] Fetching dispatch jobs...');
    const { data: jobs, error: fetchError } = await sb
      .from('h2s_dispatch_jobs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(500); // Process all jobs
    
    if (fetchError) {
      console.error('❌ Error:', fetchError.message);
      return;
    }
    
    console.log(`✅ Found ${jobs.length} jobs\n`);
    
    // Process each job
    console.log('[2/2] Processing jobs...');
    let updated = 0;
    let skipped = 0;
    let failed = 0;
    
    for (const job of jobs) {
      // Parse metadata
      let metadata = null;
      try {
        if (typeof job.metadata === 'object') metadata = job.metadata;
        else if (typeof job.metadata === 'string') metadata = JSON.parse(job.metadata);
      } catch (e) {
        skipped++;
        continue;
      }
      
      if (!metadata) {
        console.log(`  ⚠️  Job ${job.job_id}: No metadata`);
        skipped++;
        continue;
      }
      
      // FORCE RECALCULATION - Don't skip any jobs, recalculate all payouts
      
      // Get order total from metadata
      const orderTotal = Number(
        metadata.order_total || 
        metadata.total || 
        metadata.amount_total ||
        0
      );
      
      console.log(`  📊 Job ${job.job_id}: order_total=${metadata.order_total}, total=${metadata.total}, parsed=${orderTotal}`);
      
      if (orderTotal === 0) {
        console.log(`  ⚠️  Job ${job.job_id}: No order total in metadata`);
        skipped++;
        continue;
      }
      
      // Parse line_items
      let lineItems = metadata.items_json || metadata.line_items || [];
      if (typeof lineItems === 'string') {
        try {
          lineItems = JSON.parse(lineItems);
        } catch {
          lineItems = [];
        }
      }
      
      const calculatedPayout = estimatePayout(orderTotal, lineItems);
      
      // Update metadata
      const updatedMetadata = {
        ...metadata,
        estimated_payout: calculatedPayout,
        payout_backfilled_at: new Date().toISOString(),
      };
      
      // Update job
      const { error: updateError } = await sb
        .from('h2s_dispatch_jobs')
        .update({
          metadata: updatedMetadata,
          updated_at: new Date().toISOString(),
        })
        .eq('job_id', job.job_id);
      
      if (updateError) {
        console.log(`  ❌ ${job.job_id}: ${updateError.message}`);
        failed++;
      } else {
        console.log(`  ✅ ${job.job_id}: $${orderTotal} → $${calculatedPayout}`);
        updated++;
      }
    }
    
    // Summary
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`✅ Updated: ${updated}`);
    console.log(`⏭️  Skipped: ${skipped}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`📊 Total: ${jobs.length}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
  } catch (err) {
    console.error('\n❌ FATAL ERROR:', err.message);
  }
}

// Run
backfillPayouts().then(() => {
  console.log('✨ Done! Clear portal cache (localStorage.clear()) to see updated payouts.');
  process.exit(0);
}).catch(err => {
  console.error('Script failed:', err);
  process.exit(1);
});

/**
 * Script to update existing jobs with missing metadata
 * - Add items_json from orders
 * - Recalculate estimated_payout if missing
 * - Add service details
 * 
 * Usage: node backfill-job-metadata.js [--dry-run]
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://njgnshzivixtdbxetgrp.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5qZ25zaHppdml4dGRieGV0Z3JwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzcxOTkwMjgsImV4cCI6MjA1Mjc3NTAyOH0.o6xLwUW0xCDGjxxBvYe7Gq3WLDPuzrB-GUX1Km_cQ_Q';

const isDryRun = process.argv.includes('--dry-run');

function estimatePayout(order) {
  const subtotal = Number(order?.subtotal ?? order?.order_subtotal ?? order?.total ?? 0);
  if (!Number.isFinite(subtotal) || subtotal <= 0) return null;
  let payout = Math.floor(subtotal * 0.35);
  const svc = String(order?.service_name || order?.service_id || '').toLowerCase();
  if (payout < 45 && svc.includes('mount')) payout = 45;
  const MIN = 35;
  const MAX_PCT = 0.45;
  payout = Math.max(MIN, payout);
  payout = Math.min(payout, subtotal * MAX_PCT);
  return Math.round(payout * 100) / 100;
}

async function backfillJobMetadata() {
  console.log('[Backfill] Starting job metadata update...');
  console.log(`[Mode] ${isDryRun ? 'DRY RUN - No changes will be made' : 'LIVE - Will update jobs'}\n`);

  const main = createClient(SUPABASE_URL, SUPABASE_KEY);
  const dispatch = main;

  // Get all jobs
  const { data: jobs, error: jobsError } = await dispatch
    .from('h2s_dispatch_jobs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200);

  if (jobsError) {
    console.error('[ERROR] Failed to fetch jobs:', jobsError.message);
    return;
  }

  if (!jobs || jobs.length === 0) {
    console.log('[INFO] No jobs found in database');
    return;
  }

  console.log(`[Backfill] Found ${jobs.length} jobs to process\n`);

  let updated = 0;
  let skipped = 0;
  let errors = 0;

  for (const job of jobs) {
    const jobId = job.job_id;
    const orderId = job.order_id;

    // Check if metadata already has what we need
    const hasPayout = job.metadata?.estimated_payout && job.metadata.estimated_payout > 0;
    const hasItems = job.metadata?.items_json && Array.isArray(job.metadata.items_json) && job.metadata.items_json.length > 0;

    if (hasPayout && hasItems) {
      console.log(`✓ [Skip] Job ${jobId} - already has complete metadata (payout: $${job.metadata.estimated_payout}, items: ${job.metadata.items_json.length})`);
      skipped++;
      continue;
    }

    console.log(`\n→ [Process] Job ${jobId} (order: ${orderId})`);

    // Fetch the order
    let order = null;
    if (orderId) {
      try {
        // Try by order_id first
        const { data: orderData } = await main
          .from('h2s_orders')
          .select('*')
          .eq('order_id', orderId)
          .maybeSingle();
        
        if (orderData) {
          order = orderData;
        } else {
          // Try by id (numeric primary key)
          const { data: orderById } = await main
            .from('h2s_orders')
            .select('*')
            .eq('id', orderId)
            .maybeSingle();
          order = orderById;
        }
        
        if (!order) {
          // Try by session_id if it's in metadata
          const sessionId = job.metadata?.session_id;
          if (sessionId) {
            const { data: orderBySession } = await main
              .from('h2s_orders')
              .select('*')
              .eq('session_id', sessionId)
              .maybeSingle();
            order = orderBySession;
          }
        }
      } catch (e) {
        console.warn(`  ⚠ Warning: Could not fetch order ${orderId}: ${e.message}`);
      }
    }

    if (!order) {
      console.log(`  ✗ [Skip] No matching order found for job ${jobId}`);
      skipped++;
      continue;
    }

    console.log(`  ✓ Found order: ${order.order_id || order.id} (subtotal: $${order.subtotal || order.total || 0})`);

    // Build updated metadata
    const currentMeta = job.metadata || {};
    const updatedMeta = { ...currentMeta };
    let hasChanges = false;

    // Add payout if missing
    if (!hasPayout) {
      const calculatedPayout = estimatePayout(order);
      if (calculatedPayout) {
        updatedMeta.estimated_payout = calculatedPayout;
        console.log(`  + Adding payout: $${calculatedPayout}`);
        hasChanges = true;
      } else {
        console.log(`  ⚠ Could not calculate payout (invalid order subtotal)`);
      }
    }

    // Add items if missing
    if (!hasItems) {
      let itemsJson = null;
      try {
        const orderMeta = typeof order.metadata_json === 'string' 
          ? JSON.parse(order.metadata_json) 
          : order.metadata_json || {};
        
        const itemsRaw = order?.items || orderMeta?.items_json || orderMeta?.items || orderMeta?.cart_items_parsed || orderMeta?.cart_items;
        
        if (itemsRaw) {
          if (typeof itemsRaw === 'string') {
            itemsJson = JSON.parse(itemsRaw);
          } else if (Array.isArray(itemsRaw)) {
            itemsJson = itemsRaw;
          } else if (typeof itemsRaw === 'object' && itemsRaw.items) {
            itemsJson = itemsRaw.items;
          }
        }
      } catch (e) {
        console.warn(`  ⚠ Warning: Could not parse items for job ${jobId}: ${e.message}`);
      }

      if (itemsJson && Array.isArray(itemsJson) && itemsJson.length > 0) {
        updatedMeta.items_json = itemsJson;
        const itemNames = itemsJson.map(i => `${i.qty || 1}x ${i.service_name || i.name || 'item'}`).join(', ');
        console.log(`  + Adding ${itemsJson.length} items: ${itemNames}`);
        hasChanges = true;
      } else {
        console.log(`  ⚠ No items found in order`);
      }
    }

    if (!hasChanges) {
      console.log(`  → No changes needed`);
      skipped++;
      continue;
    }

    // Update the job
    if (isDryRun) {
      console.log(`  [DRY RUN] Would update job ${jobId}`);
      updated++;
    } else {
      try {
        const { error: updateError } = await dispatch
          .from('h2s_dispatch_jobs')
          .update({ metadata: updatedMeta })
          .eq('job_id', jobId);

        if (updateError) {
          console.error(`  ✗ [ERROR] Failed to update job ${jobId}: ${updateError.message}`);
          errors++;
        } else {
          console.log(`  ✓ [Success] Job ${jobId} updated`);
          updated++;
        }
      } catch (e) {
        console.error(`  ✗ [ERROR] Exception updating job ${jobId}: ${e.message}`);
        errors++;
      }
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('=== BACKFILL COMPLETE ===');
  console.log('='.repeat(60));
  console.log(`Total jobs processed: ${jobs.length}`);
  console.log(`✓ Updated: ${updated}`);
  console.log(`→ Skipped: ${skipped} (already complete)`);
  console.log(`✗ Errors: ${errors}`);
  
  if (isDryRun) {
    console.log('\n💡 This was a DRY RUN. Re-run without --dry-run to apply changes.');
  } else {
    console.log('\n✅ All updates applied to production database.');
  }
}

backfillJobMetadata()
  .then(() => {
    console.log('\n[Done] Backfill script completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n[FATAL] Backfill script failed:', error);
    process.exit(1);
  });

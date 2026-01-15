#!/usr/bin/env node
// Backfill script to add estimated_payout to h2s_orders
require('dotenv').config({ path: '.env.production.local' });
require('dotenv').config({ path: '.env.local' });

const { createClient } = require('@supabase/supabase-js');

const ORDERS_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const ORDERS_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!ORDERS_URL || !ORDERS_KEY) {
  console.error('❌ Missing orders database credentials');
  process.exit(1);
}

const sb = createClient(ORDERS_URL, ORDERS_KEY);

// Payout calculation (35% base, $35 min standard, $45 min TV, 45% cap)
function estimatePayout(orderTotal, items = []) {
  const BASE_RATE = 0.35;
  const MIN_STANDARD = 35;
  const MIN_TV = 45;
  const CAP_RATE = 0.45;
  
  let basePayout = orderTotal * BASE_RATE;
  
  // Check for TV mounting
  const isTVMounting = items.some(item => {
    const name = String(item.name || item.service_name || '').toLowerCase();
    const variant = String(item.variant_code || '').toLowerCase();
    return name.includes('tv') || name.includes('mount') || variant.includes('tv');
  });
  
  const minPayout = isTVMounting ? MIN_TV : MIN_STANDARD;
  const cappedPayout = orderTotal * CAP_RATE;
  
  let finalPayout = Math.max(basePayout, minPayout);
  finalPayout = Math.min(finalPayout, cappedPayout);
  
  return Math.round(finalPayout * 100) / 100;
}

async function backfillOrders() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  BACKFILL PAYOUT IN H2S_ORDERS');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  try {
    // Fetch all orders
    console.log('[1/2] Fetching orders...');
    const { data: orders, error: fetchError } = await sb
      .from('h2s_orders')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(500);
    
    if (fetchError) {
      console.error('❌ Error:', fetchError.message);
      return;
    }
    
    console.log(`✅ Found ${orders.length} orders\n`);
    
    // Process each order
    console.log('[2/2] Calculating payouts...');
    let updated = 0;
    let skipped = 0;
    let failed = 0;
    
    for (const order of orders) {
      const orderTotal = Number(order.order_total || order.total || 0);
      
      if (orderTotal === 0) {
        skipped++;
        continue;
      }
      
      // Parse items
      let items = order.items || [];
      if (typeof items === 'string') {
        try { items = JSON.parse(items); } catch { items = []; }
      }
      
      const calculatedPayout = estimatePayout(orderTotal, items);
      
      // Parse metadata
      let metadata = order.metadata_json || order.metadata || {};
      if (typeof metadata === 'string') {
        try { metadata = JSON.parse(metadata); } catch { metadata = {}; }
      }
      
      // Update metadata with estimated_payout
      const updatedMetadata = {
        ...metadata,
        estimated_payout: calculatedPayout,
        payout_backfilled_at: new Date().toISOString(),
      };
      
      // Update order
      const { error: updateError } = await sb
        .from('h2s_orders')
        .update({
          metadata_json: updatedMetadata,
          updated_at: new Date().toISOString(),
        })
        .eq('order_id', order.order_id);
      
      if (updateError) {
        console.log(`  ❌ ${order.order_id}: ${updateError.message}`);
        failed++;
      } else {
        console.log(`  ✅ ${order.order_id}: $${orderTotal} → $${calculatedPayout} payout`);
        updated++;
      }
    }
    
    // Summary
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`✅ Updated: ${updated}`);
    console.log(`⏭️  Skipped: ${skipped}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`📊 Total: ${orders.length}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
  } catch (err) {
    console.error('\n❌ FATAL ERROR:', err.message);
    console.error(err.stack);
  }
}

// Run
backfillOrders().then(() => {
  console.log('✨ Done! Payouts calculated and stored in metadata.');
  process.exit(0);
}).catch(err => {
  console.error('Script failed:', err);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * Enhanced Backfill: Copy data from linked orders to dispatch jobs
 * Fixes jobs where order has data but job columns are empty
 */

require('dotenv').config({ path: '.env.production.local' });
require('dotenv').config({ path: '.env.local' });

const { createClient } = require('@supabase/supabase-js');

const DISPATCH_URL = process.env.SUPABASE_URL_DISPATCH || process.env.SUPABASE_URL;
const DISPATCH_KEY = process.env.SUPABASE_SERVICE_KEY_DISPATCH || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

const dispatch = createClient(DISPATCH_URL, DISPATCH_KEY);

async function backfillFromOrders() {
  console.log('\n🔧 ENHANCED BACKFILL: Orders → Dispatch Jobs\n');
  console.log('='.repeat(70));
  
  // Get all jobs with linked orders
  const { data: jobs, error } = await dispatch
    .from('h2s_dispatch_jobs')
    .select('*')
    .not('order_id', 'is', null)
    .order('created_at', { ascending: false });
  
  if (error) {
    console.error('❌ Failed to fetch jobs:', error.message);
    process.exit(1);
  }
  
  console.log(`\n📊 Found ${jobs.length} jobs with linked orders\n`);
  
  let fixed = 0;
  let skipped = 0;
  let orderNotFound = 0;
  
  for (const job of jobs) {
    // Get linked order - try both possible table names
    let order = null;
    
    const { data: orderData1, error: orderErr1 } = await dispatch
      .from('h2s_orders')
      .select('*')
      .eq('order_id', job.order_id)
      .maybeSingle();
    
    if (orderData1) {
      order = orderData1;
    } else {
      // Try alternative table
      const { data: orderData2, error: orderErr2 } = await dispatch
        .from('orders')
        .select('*')
        .eq('order_id', job.order_id)
        .maybeSingle();
      
      if (orderData2) {
        order = orderData2;
      }
    }
    
    if (!order) {
      orderNotFound++;
      continue;
    }
    
    const update = {};
    
    // Check what's missing and available in order
    if (!job.title && order.service_name) {
      update.title = order.service_name;
    }
    
    if (!job.scheduled_date && order.scheduled_date) {
      update.scheduled_date = order.scheduled_date;
    }
    
    if (!job.customer_phone && order.customer_phone) {
      update.customer_phone = order.customer_phone;
    }
    
    if (!job.customer_name && order.customer_name) {
      update.customer_name = order.customer_name;
    }
    
    if (!job.customer_email && order.customer_email) {
      update.customer_email = order.customer_email;
    }
    
    if (!job.service_address && order.service_address) {
      update.service_address = order.service_address;
    }
    
    if (!job.service_city && order.service_city) {
      update.service_city = order.service_city;
    }
    
    if (!job.service_state && order.service_state) {
      update.service_state = order.service_state;
    }
    
    if (!job.service_zip && order.service_zip) {
      update.service_zip = order.service_zip;
    }
    
    if (Object.keys(update).length === 0) {
      skipped++;
      continue;
    }
    
    console.log(`\n🔧 Fixing job: ${job.job_id}`);
    Object.entries(update).forEach(([field, value]) => {
      console.log(`  ✅ ${field}: ${value}`);
    });
    
    update.updated_at = new Date().toISOString();
    
    const { error: updateErr } = await dispatch
      .from('h2s_dispatch_jobs')
      .update(update)
      .eq('job_id', job.job_id);
    
    if (updateErr) {
      console.log(`  ❌ Update failed: ${updateErr.message}`);
    } else {
      console.log(`  ✅ Job updated successfully`);
      fixed++;
    }
  }
  
  console.log('\n' + '='.repeat(70));
  console.log('\n✅ ENHANCED BACKFILL COMPLETE:');
  console.log(`   Fixed: ${fixed} jobs`);
  console.log(`   Skipped: ${skipped} jobs (already complete)`);
  console.log(`   Orders not found: ${orderNotFound} jobs`);
  console.log(`   Total: ${jobs.length} jobs\n`);
}

backfillFromOrders().catch(err => {
  console.error('\n❌ Backfill failed:', err);
  process.exit(1);
});

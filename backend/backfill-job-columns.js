#!/usr/bin/env node
/**
 * Backfill Script: Copy metadata fields to first-class columns in dispatch jobs
 * Fixes jobs where customer_phone/address are in metadata but not in columns
 */

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

const dispatch = createClient(DISPATCH_URL, DISPATCH_KEY);

async function backfill() {
  console.log('🔧 BACKFILL: Copying metadata → first-class columns\n');
  console.log('='.repeat(60));
  
  // First get total count
  const { count, error: countError } = await dispatch
    .from('h2s_dispatch_jobs')
    .select('*', { count: 'exact', head: true });
  
  if (countError) {
    console.error('❌ Failed to count jobs:', countError.message);
    process.exit(1);
  }
  
  console.log(`\n📊 Total jobs in database: ${count}`);
  
  // Get ALL jobs (no limit)
  const { data: jobs, error } = await dispatch
    .from('h2s_dispatch_jobs')
    .select('*')
    .order('created_at', { ascending: false });
  
  if (error) {
    console.error('❌ Failed to fetch jobs:', error.message);
    process.exit(1);
  }
  
  console.log(`\n📊 Found ${jobs.length} jobs to check\n`);
  
  let fixed = 0;
  let skipped = 0;
  
  for (const job of jobs) {
    let metadata = null;
    try {
      metadata = typeof job.metadata === 'string' ? JSON.parse(job.metadata) : job.metadata;
    } catch (e) {}
    
    if (!metadata) {
      skipped++;
      continue;
    }
    
    const needsUpdate = !job.customer_phone || !job.service_address;
    
    if (!needsUpdate) {
      skipped++;
      continue;
    }
    
    console.log(`\n🔧 Fixing job: ${job.job_id}`);
    
    const update = {};
    
    if (!job.customer_phone && metadata.customer_phone) {
      update.customer_phone = metadata.customer_phone;
      console.log(`  ✅ Adding customer_phone: ${metadata.customer_phone}`);
    }
    
    if (!job.customer_name && metadata.customer_name) {
      update.customer_name = metadata.customer_name;
      console.log(`  ✅ Adding customer_name: ${metadata.customer_name}`);
    }
    
    if (!job.customer_email && metadata.customer_email) {
      update.customer_email = metadata.customer_email;
      console.log(`  ✅ Adding customer_email: ${metadata.customer_email}`);
    }
    
    if (!job.service_address && metadata.service_address) {
      update.service_address = metadata.service_address;
      console.log(`  ✅ Adding service_address: ${metadata.service_address}`);
    }
    
    if (!job.service_city && metadata.service_city) {
      update.service_city = metadata.service_city;
      console.log(`  ✅ Adding service_city: ${metadata.service_city}`);
    }
    
    if (!job.service_state && metadata.service_state) {
      update.service_state = metadata.service_state;
      console.log(`  ✅ Adding service_state: ${metadata.service_state}`);
    }
    
    if (!job.service_zip && metadata.service_zip) {
      update.service_zip = metadata.service_zip;
      console.log(`  ✅ Adding service_zip: ${metadata.service_zip}`);
    }
    
    if (!job.title && metadata.title) {
      update.title = metadata.title;
      console.log(`  ✅ Adding title: ${metadata.title}`);
    }
    
    if (!job.title && metadata.service_name) {
      update.title = metadata.service_name;
      console.log(`  ✅ Adding title from service_name: ${metadata.service_name}`);
    }
    
    if (!job.scheduled_date && metadata.scheduled_date) {
      update.scheduled_date = metadata.scheduled_date;
      console.log(`  ✅ Adding scheduled_date: ${metadata.scheduled_date}`);
    }
    
    if (!job.scheduled_date && metadata.appointment_date) {
      update.scheduled_date = metadata.appointment_date;
      console.log(`  ✅ Adding scheduled_date from appointment_date: ${metadata.appointment_date}`);
    }
    
    if (Object.keys(update).length === 0) {
      skipped++;
      continue;
    }
    
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
  
  console.log('\n' + '='.repeat(60));
  console.log(`\n✅ Backfill complete:`);
  console.log(`   Fixed: ${fixed}`);
  console.log(`   Skipped: ${skipped}`);
  console.log(`   Total: ${jobs.length}\n`);
}

backfill().catch(err => {
  console.error('\n❌ Backfill failed:', err);
  process.exit(1);
});

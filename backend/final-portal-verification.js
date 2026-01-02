#!/usr/bin/env node
/**
 * Final Verification: Portal Jobs API Data Completeness
 * Tests that all jobs with customer data return complete information
 */

require('dotenv').config({ path: '.env.production.local' });
require('dotenv').config({ path: '.env.local' });

const { createClient } = require('@supabase/supabase-js');

const DISPATCH_URL = process.env.SUPABASE_URL_DISPATCH || process.env.SUPABASE_URL;
const DISPATCH_KEY = process.env.SUPABASE_SERVICE_KEY_DISPATCH || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

const dispatch = createClient(DISPATCH_URL, DISPATCH_KEY);

async function finalVerification() {
  console.log('\n✅ FINAL PORTAL READINESS VERIFICATION\n');
  console.log('='.repeat(70));
  
  // Get all jobs with customer data
  const { data: jobs, error } = await dispatch
    .from('h2s_dispatch_jobs')
    .select('*')
    .not('customer_phone', 'is', null)
    .order('created_at', { ascending: false });
  
  if (error) {
    console.error('❌ Failed to fetch jobs:', error.message);
    process.exit(1);
  }
  
  console.log(`\n📊 Verifying ${jobs.length} jobs with customer data...\n`);
  
  let allFieldsPresent = 0;
  let missingFields = 0;
  const incomplete = [];
  
  for (const job of jobs) {
    const fields = {
      customer_phone: !!job.customer_phone,
      customer_name: !!job.customer_name,
      customer_email: !!job.customer_email,
      service_address: !!job.service_address,
      service_city: !!job.service_city,
      service_state: !!job.service_state,
      service_zip: !!job.service_zip,
      title: !!job.title,
      scheduled_date: !!job.scheduled_date
    };
    
    const complete = Object.values(fields).every(v => v);
    
    if (complete) {
      allFieldsPresent++;
    } else {
      missingFields++;
      incomplete.push({
        job_id: job.job_id,
        created: job.created_at,
        missing: Object.entries(fields)
          .filter(([_, present]) => !present)
          .map(([field, _]) => field)
      });
    }
  }
  
  console.log('📊 PORTAL READINESS REPORT:\n');
  console.log(`   ✅ Complete jobs (all fields):   ${allFieldsPresent}`);
  console.log(`   ⚠️  Incomplete jobs:              ${missingFields}`);
  console.log(`   📈 Portal readiness:             ${((allFieldsPresent / jobs.length) * 100).toFixed(1)}%\n`);
  
  if (incomplete.length > 0) {
    console.log('⚠️  JOBS WITH MISSING FIELDS:\n');
    incomplete.forEach((job, idx) => {
      console.log(`${idx + 1}. Job: ${job.job_id}`);
      console.log(`   Created: ${job.created}`);
      console.log(`   Missing: ${job.missing.join(', ')}\n`);
    });
  }
  
  console.log('='.repeat(70));
  
  if (allFieldsPresent === jobs.length) {
    console.log('\n🎉 SUCCESS: ALL JOBS WITH CUSTOMER DATA ARE PORTAL-READY');
    console.log('✅ Every job will display complete details in the portal');
    console.log('✅ No data quality issues detected\n');
    return true;
  } else {
    console.log('\n⚠️  WARNING: Some jobs missing optional fields');
    console.log('   These jobs may display partial information in the portal\n');
    return false;
  }
}

finalVerification()
  .then(success => {
    process.exit(success ? 0 : 1);
  })
  .catch(err => {
    console.error('\n❌ Verification failed:', err);
    process.exit(1);
  });

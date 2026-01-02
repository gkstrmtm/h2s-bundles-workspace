#!/usr/bin/env node
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function cleanupTestJobs() {
  console.log('\n🗑️  CLEANING UP TEST JOBS\n');
  console.log('='.repeat(70));
  
  // Get all jobs
  const { data: jobs } = await db.from('h2s_dispatch_jobs').select('*');
  
  console.log(`\nFound ${jobs.length} total jobs\n`);
  
  const testEmails = ['h2sbackend@gmail.com', 'geo.test@home2smart.com', 'tabari.test@home2smart.com', 'flowtest@home2smart.com'];
  
  let deleted = 0;
  
  for (const job of jobs) {
    const isTest = testEmails.includes(job.customer_email);
    
    if (isTest) {
      console.log(`🗑️  Deleting: ${job.job_id.substring(0, 8)}... (${job.customer_email})`);
      
      // Delete assignments first
      await db.from('h2s_dispatch_job_assignments').delete().eq('job_id', job.job_id);
      
      // Delete job
      const { error } = await db.from('h2s_dispatch_jobs').delete().eq('job_id', job.job_id);
      
      if (error) {
        console.log(`   ❌ Failed: ${error.message}`);
      } else {
        deleted++;
      }
    }
  }
  
  console.log('\n' + '='.repeat(70));
  console.log(`\n✅ Deleted ${deleted} test jobs\n`);
  
  // Show remaining
  const { data: remaining } = await db.from('h2s_dispatch_jobs').select('*');
  console.log(`📊 Remaining jobs: ${remaining.length}\n`);
}

cleanupTestJobs();

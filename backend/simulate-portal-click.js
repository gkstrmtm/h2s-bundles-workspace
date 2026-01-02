#!/usr/bin/env node
/**
 * EXACT SIMULATION: What does the portal see when clicking Details?
 */
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function simulatePortalClick() {
  console.log('\n🖱️  SIMULATING: User clicks "Details" on a job in portal\n');
  console.log('='.repeat(70));
  
  // Step 1: Portal fetches all jobs (what shows in the list)
  const { data: allJobs } = await db
    .from('h2s_dispatch_jobs')
    .select('*')
    .eq('status', 'scheduled')
    .order('created_at', { ascending: false })
    .limit(5);
  
  console.log(`\n📋 PORTAL JOB LIST (what you see before clicking Details):\n`);
  
  allJobs.forEach((job, idx) => {
    console.log(`${idx + 1}. Job ${job.job_id.substring(0, 8)}...`);
    console.log(`   Title shown: ${job.title || job.service_name || 'Unnamed Job'}`);
    console.log(`   Customer: ${job.customer_name || 'Unknown'}`);
    console.log(`   Payout: $${job.total_payout || '??'}`);
  });
  
  // Step 2: User clicks Details on first job
  const clickedJob = allJobs[0];
  console.log(`\n\n🖱️  USER CLICKS "Details" on: ${clickedJob.job_id}\n`);
  console.log('='.repeat(70));
  
  // Portal calls: GET /api/portal_jobs?job_id=xxx
  // API returns: SELECT * FROM h2s_dispatch_jobs WHERE job_id = xxx
  const { data: detailJob } = await db
    .from('h2s_dispatch_jobs')
    .select('*')
    .eq('job_id', clickedJob.job_id)
    .single();
  
  console.log('\n📦 API RETURNS THIS JOB OBJECT:\n');
  console.log(JSON.stringify(detailJob, null, 2));
  
  console.log('\n\n📱 PORTAL DISPLAYS:\n');
  console.log(`Title: ${detailJob.title || detailJob.service_name || 'NO TITLE'}`);
  console.log(`Customer: ${detailJob.customer_name || 'NO NAME'}`);
  console.log(`Phone: ${detailJob.customer_phone || 'NO PHONE'}`);
  console.log(`Address: ${detailJob.service_address || 'NO ADDRESS'}`);
  console.log(`City: ${detailJob.service_city || 'NO CITY'}`);
  console.log(`Payout: $${detailJob.total_payout || 'NO PAYOUT'}`);
  
  console.log('\n' + '='.repeat(70));
  console.log('\n✅ THIS IS EXACTLY WHAT YOU SEE IN THE PORTAL\n');
}

simulatePortalClick();

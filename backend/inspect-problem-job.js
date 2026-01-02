#!/usr/bin/env node
require('dotenv').config({ path: '.env.production.local' });
require('dotenv').config({ path: '.env.local' });

const { createClient } = require('@supabase/supabase-js');

const DISPATCH_URL = process.env.SUPABASE_URL_DISPATCH || process.env.SUPABASE_URL;
const DISPATCH_KEY = process.env.SUPABASE_SERVICE_KEY_DISPATCH || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

const dispatch = createClient(DISPATCH_URL, DISPATCH_KEY);

async function inspect() {
  const jobId = 'H2S1767039797473ZGSB7';
  
  console.log(`\n🔍 Inspecting job: ${jobId}\n`);
  console.log('='.repeat(60));
  
  const { data: job, error } = await dispatch
    .from('h2s_dispatch_jobs')
    .select('*')
    .eq('job_id', jobId)
    .single();
  
  if (error) {
    console.error('❌ Failed:', error.message);
    return;
  }
  
  console.log('\n📋 JOB DETAILS:\n');
  console.log(`   job_id: ${job.job_id}`);
  console.log(`   title: ${job.title || 'NULL'}`);
  console.log(`   order_id: ${job.order_id || 'NULL'}`);
  console.log(`   created_at: ${job.created_at}`);
  console.log(`   scheduled_date: ${job.scheduled_date || 'NULL'}`);
  
  console.log('\n📋 FIRST-CLASS CUSTOMER COLUMNS:\n');
  console.log(`   customer_phone: ${job.customer_phone || 'NULL ❌'}`);
  console.log(`   customer_name: ${job.customer_name || 'NULL ❌'}`);
  console.log(`   customer_email: ${job.customer_email || 'NULL ❌'}`);
  console.log(`   service_address: ${job.service_address || 'NULL ❌'}`);
  console.log(`   service_city: ${job.service_city || 'NULL ❌'}`);
  console.log(`   service_state: ${job.service_state || 'NULL ❌'}`);
  console.log(`   service_zip: ${job.service_zip || 'NULL ❌'}`);
  
  let metadata = null;
  try {
    metadata = typeof job.metadata === 'string' ? JSON.parse(job.metadata) : job.metadata;
  } catch (e) {}
  
  console.log('\n📦 METADATA:\n');
  if (metadata) {
    console.log(JSON.stringify(metadata, null, 2));
  } else {
    console.log('   NULL or invalid JSON ❌');
  }
  
  // Check if order exists
  if (job.order_id) {
    console.log(`\n🔍 Checking linked order: ${job.order_id}\n`);
    
    const { data: order, error: orderErr } = await dispatch
      .from('h2s_orders')
      .select('*')
      .eq('order_id', job.order_id)
      .single();
    
    if (orderErr) {
      console.log(`   ❌ Order not found: ${orderErr.message}`);
    } else {
      console.log(`   ✅ Order found`);
      console.log(`   customer_phone: ${order.customer_phone || 'NULL'}`);
      console.log(`   customer_name: ${order.customer_name || 'NULL'}`);
      console.log(`   customer_email: ${order.customer_email || 'NULL'}`);
      console.log(`   service_address: ${order.service_address || 'NULL'}`);
    }
  }
  
  console.log('\n' + '='.repeat(60) + '\n');
}

inspect();

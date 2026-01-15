// Quick check: Query the specific order to see its metadata
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL_DB1 || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkOrder() {
  const orderId = 'ORD-FA1392A0';
  
  console.log(`Checking order: ${orderId}\n`);
  
  // Check h2s_orders
  const { data: order, error: orderErr } = await supabase
    .from('h2s_orders')
    .select('*')
    .eq('order_id', orderId)
    .single();
    
  if (orderErr) {
    console.error('Order query error:', orderErr);
    return;
  }
  
  console.log('Order found:');
  console.log('  order_id:', order.order_id);
  console.log('  session_id:', order.session_id);
  console.log('  status:', order.status);
  console.log('  customer_email:', order.customer_email);
  console.log('  metadata_json:', JSON.stringify(order.metadata_json, null, 2));
  
  // Check for job ID in metadata
  const jobId = order.metadata_json?.dispatch_job_id;
  
  if (!jobId) {
    console.log('\n❌ No job_id in metadata!');
    
    // Check if any jobs exist for this customer email
    const dispatchUrl = process.env.SUPABASE_DISPATCH_URL || supabaseUrl;
    const dispatchKey = process.env.SUPABASE_DISPATCH_KEY || supabaseKey;
    const dispatch = createClient(dispatchUrl, dispatchKey);
    
    const { data: jobs, error: jobsErr } = await dispatch
      .from('h2s_dispatch_jobs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(5);
      
    console.log('\nRecent jobs in dispatch table:', jobs?.length || 0);
    if (jobs && jobs.length > 0) {
      jobs.forEach(j => {
        console.log(`  - ${j.job_id} | ${j.status} | ${j.created_at}`);
      });
    }
    
    return;
  }
  
  console.log(`\n✅ Job ID found: ${jobId}`);
  
  // Verify job exists
  const dispatchUrl = process.env.SUPABASE_DISPATCH_URL || supabaseUrl;
  const dispatchKey = process.env.SUPABASE_DISPATCH_KEY || supabaseKey;
  const dispatch = createClient(dispatchUrl, dispatchKey);
  
  const { data: job, error: jobErr } = await dispatch
    .from('h2s_dispatch_jobs')
    .select('*')
    .eq('job_id', jobId)
    .maybeSingle();
    
  if (jobErr) {
    console.error('Job query error:', jobErr);
    return;
  }
  
  if (!job) {
    console.log('❌ Job not found in dispatch table!');
    return;
  }
  
  console.log('\n✅ Job exists:');
  console.log('  job_id:', job.job_id);
  console.log('  status:', job.status);
  console.log('  recipient_id:', job.recipient_id);
  console.log('  created_at:', job.created_at);
}

checkOrder().catch(console.error);

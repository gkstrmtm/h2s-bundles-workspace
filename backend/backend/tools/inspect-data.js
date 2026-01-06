// Inspect recent data and table structures
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || 'https://your-project.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function inspectData() {
  console.log('\n🔍 INSPECTING RECENT DATA\n');
  
  // 1. Check Orders
  console.log('📦 Recent Orders (h2s_orders):');
  const { data: orders, error: orderError } = await supabase
    .from('h2s_orders')
    .select('order_id, customer_email, total, status, created_at, session_id')
    .order('created_at', { ascending: false })
    .limit(5);
    
  if (orderError) console.error('Error fetching orders:', orderError.message);
  else console.table(orders);

  // 2. Check Dispatch Jobs
  console.log('\n🚚 Recent Dispatch Jobs (h2s_dispatch_jobs):');
  const { data: jobs, error: jobError } = await supabase
    .from('h2s_dispatch_jobs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(5);

  if (jobError) console.error('Error fetching jobs:', jobError.message);
  else console.table(jobs);

  // 3. Check Offers Structure
  console.log('\n🏷️  Offers Table Structure (h2s_offers):');
  const { data: offers, error: offerError } = await supabase
    .from('h2s_offers')
    .select('*')
    .limit(1);
    
  if (offerError) console.error('Error fetching offers:', offerError.message);
  else if (offers.length > 0) console.log(Object.keys(offers[0]));
  else console.log('Table is empty, cannot infer columns.');

  // 4. Check Pending Offers Structure
  console.log('\n⏳ Pending Offers Table Structure (h2s_pending_offers):');
  const { data: pending, error: pendingError } = await supabase
    .from('h2s_pending_offers')
    .select('*')
    .limit(1);

  if (pendingError) console.error('Error fetching pending offers:', pendingError.message);
  else if (pending.length > 0) console.log(Object.keys(pending[0]));
  else console.log('Table is empty, cannot infer columns.');
}

inspectData();

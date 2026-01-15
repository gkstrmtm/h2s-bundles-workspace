require('dotenv').config({ path: '.env.production.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function main() {
  const ORDER_ID = 'ORD-1453D184';
  const JOB_ID = '3781bc3e-ff23-4a10-a10b-8cf62c8ba824';
  
  console.log('\n✅ Finalizing order for portal display...\n');
  
  const { data: order } = await supabase
    .from('h2s_orders')
    .select('*')
    .eq('order_id', ORDER_ID)
    .single();
    
  if (order) {
    const total = order.total || 599;
    const estimatedPayout = total * 0.35;
    
    const metadata = order.metadata_json || {};
    const updatedMetadata = {
      ...metadata,
      dispatch_job_id: JOB_ID,
      estimated_payout: estimatedPayout,
      geo_lat: 34.1954,
      geo_lng: -82.1618
    };
    
    const { error } = await supabase
      .from('h2s_orders')
      .update({ metadata_json: updatedMetadata })
      .eq('order_id', ORDER_ID);
      
    if (error) {
      console.error('❌ Failed:', error.message);
    } else {
      console.log('✅ Order fully updated for portal:');
      console.log(`   order_id: ${ORDER_ID}`);
      console.log(`   total: $${total}`);
      console.log(`   estimated_payout: $${estimatedPayout.toFixed(2)}`);
      console.log(`   dispatch_job_id: ${JOB_ID}`);
      console.log(`   geo: 34.1954, -82.1618`);
      console.log('\n🎉 Job should now appear in portal at portal_jobs endpoint!');
    }
  }
}

main();

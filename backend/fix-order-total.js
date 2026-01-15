require('dotenv').config({ path: '.env.production.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function main() {
  const ORDER_ID = 'ORD-1453D184';
  
  console.log('\n🔧 Fixing order_total for ORD-1453D184...\n');
  
  const { data: order } = await supabase
    .from('h2s_orders')
    .select('*')
    .eq('order_id', ORDER_ID)
    .single();
    
  if (order) {
    let items = order.items;
    if (typeof items === 'string') items = JSON.parse(items);
    if (!Array.isArray(items)) items = [];
    
    const total = items.reduce((sum, item) => sum + (item.unit_price * (item.quantity || 1)), 0);
    
    console.log(`Calculated total from items: $${total}`);
    console.log(`Items: ${JSON.stringify(items)}`);
    
    const metadata = order.metadata_json || {};
    const estimatedPayout = total * 0.35;
    
    const updates = {
      order_total: total,
      metadata_json: {
        ...metadata,
        estimated_payout: estimatedPayout,
        geo_lat: 34.1954,
        geo_lng: -82.1618
      }
    };
    
    const { error } = await supabase
      .from('h2s_orders')
      .update(updates)
      .eq('order_id', ORDER_ID);
      
    if (error) {
      console.error('❌ Failed:', error.message);
    } else {
      console.log('✅ Order updated:');
      console.log(`   order_total: $${total}`);
      console.log(`   estimated_payout: $${estimatedPayout.toFixed(2)}`);
      console.log(`   geo: 34.1954, -82.1618 (117 King Cir, Greenwood SC)`);
    }
  }
}

main();

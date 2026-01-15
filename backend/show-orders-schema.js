require('dotenv').config({ path: '.env.production.local' });
const { createClient } = require('@supabase/supabase-js');

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function getSchema() {
  const { data } = await sb.from('h2s_orders').select('*').limit(1);
  
  if (data && data[0]) {
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  H2S_ORDERS SCHEMA');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('Columns:\n');
    Object.keys(data[0]).sort().forEach(col => {
      const val = data[0][col];
      const type = typeof val;
      const sample = type === 'object' ? 'JSON' : String(val || '').substring(0, 30);
      console.log(`  ${col.padEnd(30)} ${type.padEnd(10)} ${sample}`);
    });
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  }
}

getSchema();

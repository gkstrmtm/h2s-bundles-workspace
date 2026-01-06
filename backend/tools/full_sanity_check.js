
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Load environment variables manually
function loadEnv(filePath) {
  if (fs.existsSync(filePath)) {
    const content = fs.readFileSync(filePath, 'utf8');
    content.split('\n').forEach(line => {
      const match = line.match(/^([^=]+)=(.*)$/);
      if (match) {
        process.env[match[1].trim()] = match[2].trim().replace(/^"(.*)"$/, '$1');
      }
    });
  }
}

loadEnv(path.join(__dirname, '../.env.local'));
loadEnv(path.join(__dirname, '../../.env.local'));
loadEnv(path.join(__dirname, '../.env'));

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !key) {
  console.error('❌ Missing Credentials');
  process.exit(1);
}

const supabase = createClient(url, key);

async function performSanityCheck() {
  console.log('🏥 PERFORMING SYSTEM SANITY CHECK...\n');

  // 1. Check h2s_orders
  {
    process.stdout.write('Checking h2s_orders... ');
    const { count, error } = await supabase.from('h2s_orders').select('*', { count: 'exact', head: true });
    if (error) console.log(`❌ Error: ${error.message}`);
    else console.log(`✅ OK (${count} orders found)`);
  }

  // 2. Check h2s_dispatch_jobs existence
  {
    process.stdout.write('Checking h2s_dispatch_jobs table... ');
    const { data, error } = await supabase.from('h2s_dispatch_jobs').select('*').limit(1);
    if (error) {
      console.log(`❌ Error: ${error.message}`);
    } else {
      console.log('✅ Table exists');
      
      // Check columns
      if (data && data.length > 0) {
        const row = data[0];
        const required = ['order_id', 'metadata', 'customer_name', 'service_id'];
        const missing = required.filter(k => row[k] === undefined);
        if (missing.length > 0) {
          console.log(`   ⚠️  MISSING CRITICAL COLUMNS: ${missing.join(', ')}`);
          console.log(`   (This explains why offers/checkout integration is broken)`);
        } else {
          console.log('   ✅ Schema looks compatible');
        }
      } else {
        console.log('   ⚠️  Table empty, cannot verify columns.');
      }
    }
  }

  // 3. Check Dependencies (Sequences & Recipients)
  {
    process.stdout.write('Checking h2s_dispatch_sequences... ');
    const { count, error } = await supabase.from('h2s_dispatch_sequences').select('*', { count: 'exact', head: true });
    if (error) console.log(`❌ Error: ${error.message}`);
    else if (count === 0) console.log(`⚠️  Empty (Checkout will fail to create jobs due to FK constraints)`);
    else console.log(`✅ OK (${count} found)`);
  }

  {
    process.stdout.write('Checking h2s_dispatch_recipients... ');
    const { count, error } = await supabase.from('h2s_dispatch_recipients').select('*', { count: 'exact', head: true });
    if (error) console.log(`❌ Error: ${error.message}`);
    else if (count === 0) console.log(`⚠️  Empty (Checkout will fail to create jobs due to FK constraints)`);
    else console.log(`✅ OK (${count} found)`);
  }

  console.log('\n🏁 Sanity Check Complete.');
}

performSanityCheck();

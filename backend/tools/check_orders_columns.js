
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

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
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

if (!url || !key) { console.error('No credentials'); process.exit(1); }

const supabase = createClient(url, key);

async function checkOrdersSchema() {
  console.log('Checking h2s_orders columns...');
  const { data, error } = await supabase.from('h2s_orders').select('*').limit(1);
  if (error) {
    console.error(error);
  } else {
    if (data.length > 0) {
      console.log('Columns:', Object.keys(data[0]));
      if (data[0].job_id !== undefined) console.log('✅ job_id column EXISTS on h2s_orders');
      else console.log('❌ job_id column MISSING on h2s_orders');
    } else {
      console.log('Table empty, cannot check columns easily.');
    }
  }
}

checkOrdersSchema();

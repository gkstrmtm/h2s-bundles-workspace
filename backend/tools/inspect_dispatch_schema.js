
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Load environment variables manually if dotenv fails or for .env.local
function loadEnv(filePath) {
  if (fs.existsSync(filePath)) {
    console.log(`Loading env from ${filePath}`);
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

// Try to load env vars
const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !key) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(url, key);

async function inspectTable() {
  console.log('🔍 Inspecting h2s_dispatch_jobs table...');
  
  // Fetch one row to see keys
  const { data, error } = await supabase
    .from('h2s_dispatch_jobs')
    .select('*')
    .limit(1);

  if (error) {
    console.error('❌ Error fetching from h2s_dispatch_jobs:', error.message);
    return;
  }

  if (!data || data.length === 0) {
    console.log('⚠️  Table is empty, cannot infer columns from data.');
    return;
  }

  const row = data[0];
  console.log('✅ Found columns based on 1st row:');
  Object.keys(row).forEach(k => {
    console.log(`   - ${k} (${typeof row[k]})`);
  });
}

inspectTable();

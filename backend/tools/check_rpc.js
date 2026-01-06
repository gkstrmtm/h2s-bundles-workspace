
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

if (!url || !key) process.exit(1);

const supabase = createClient(url, key);

async function checkRpc() {
  const { data, error } = await supabase.rpc('exec_sql', { sql: 'SELECT 1 as val' });
  if (error) {
    console.log('RPC Error:', error.message);
  } else {
    console.log('RPC Success:', JSON.stringify(data));
  }
}

checkRpc();

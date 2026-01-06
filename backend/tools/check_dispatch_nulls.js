
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

async function checkNotNull() {
  console.log('🔍 Checking nullability...');
  
  // We can't query information_schema easily via JS client .from(), need RPC or assume strict mode.
  // Instead, let's try to insert a row with NULLs and see the error.
  
  const { error } = await supabase
    .from('h2s_dispatch_jobs')
    .insert({
      recipient_id: null,
      sequence_id: null,
      step_id: null,
      status: 'test-probe' // Assuming status is text and exists
    });

  if (error) {
    console.log('Observation from insert attempt:');
    console.log(error.message);
  } else {
    console.log('✅ Insert with NULLs succeeded (Columns are nullable)');
    // Clean up
    await supabase.from('h2s_dispatch_jobs').delete().eq('status', 'test-probe');
  }
}

checkNotNull();

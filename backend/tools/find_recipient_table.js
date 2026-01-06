// Script to inspect Foreign Key definitions
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

let supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
let supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  try {
    const dotenv = fs.readFileSync('.env.local', 'utf8');
    const lines = dotenv.split('\n');
    lines.forEach(line => {
      let [k, v] = line.split('=');
      if (k && v) {
        v = v.trim().replace(/^["']|["']$/g, '');
        if (k.trim() === 'NEXT_PUBLIC_SUPABASE_URL' || k.trim() === 'SUPABASE_URL') supabaseUrl = v;
        if (k.trim() === 'SUPABASE_SERVICE_ROLE_KEY' || k.trim() === 'SUPABASE_SERVICE_KEY') supabaseKey = v;
      }
    });
  } catch (e) {}
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function inspectForeignKeys() {
  console.log("🔍 Inspecting Foreign Keys for h2s_dispatch_jobs...");

  // We can't query information_schema directly via Supabase client typically, 
  // but we can try to RPC or use a raw query if available. 
  // Standard Supabase client doesn't support raw SQL unless via RPC.
  
  // However, we can try to deduce it by testing other tables.
  
  // Let's look for any table with 'recipient' in the name
  // Note: List tables is also not directly supported effectively without admin rights or rpc.
  
  // But wait! We can try to select from likely tables.
  const tables = [
    'h2s_dispatch_recipients',
    'dispatch_recipients',
    'recipients',
    'h2s_recipients',
    'customers',
    'h2s_customers',
    'profiles',
    'users'
  ];

  for (const table of tables) {
    const { data, error } = await supabase.from(table).select('*').limit(1);
    if (!error) {
      console.log(`✅ Table Found: ${table}`);
      if (data.length > 0) {
        console.log(`   Sample:`, data[0]);
      }
    } else {
        // 404 means table not found usually
        if (error.code !== 'PGRST204' && !error.message.includes('exist')) {
             console.log(`❓ Error on ${table}: ${error.message} (${error.code})`);
        }
    }
  }
}

inspectForeignKeys();

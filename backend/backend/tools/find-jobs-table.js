// Check for alternate job tables
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || 'https://your-project.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkAlternateTables() {
  const candidates = ['h2s_jobs', 'jobs', 'dispatch_jobs', 'work_orders'];
  
  for (const table of candidates) {
    const { error } = await supabase.from(table).select('*').limit(0);
    if (!error) {
      console.log(`✅ ${table} EXISTS`);
    } else {
      console.log(`❌ ${table}: ${error.message}`);
    }
  }
}

checkAlternateTables();

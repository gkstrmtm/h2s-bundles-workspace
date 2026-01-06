// Script to inspect columns of h2s_dispatch_jobs
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

async function inspectColumns() {
  console.log("🔍 Inspecting h2s_dispatch_jobs columns...");

  const { data, error } = await supabase.from('h2s_dispatch_jobs').select('*').limit(1);
  if (data && data.length > 0) {
      console.log("Keys found:", Object.keys(data[0]));
  } else {
      console.log("No data or error:", error);
      // Try to insert with a fake column and see error
      const { error: insertErr } = await supabase.from('h2s_dispatch_jobs').insert({
          status: 'queued',
          // Minimal known good fields
          recipient_id: '2ddbb40b-5587-4bd9-b78d-e7ff8754968f',
          sequence_id: '88297425-c134-4a51-8450-93cb35b1b3cb', 
          step_id: 'd30da333-3a54-4598-8ac1-f3b276185ea1',
          // Test column
          service_zip: '12345'
      });
      if (insertErr) {
          console.log("Insert Check Result:", insertErr.message);
      } else {
          console.log("✅ 'service_zip' column exists (Insert allowed)");
      }
  }
}

inspectColumns();

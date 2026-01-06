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

async function inspectOrderColumns() {
  console.log("🔍 Inspecting h2s_orders columns...");
  const { data, error } = await supabase.from('h2s_orders').select('*').limit(1);
  if (data && data.length > 0) {
      console.log("Keys found:", Object.keys(data[0]));
      const hasZip = Object.keys(data[0]).includes('zip');
      console.log("Has 'zip' column:", hasZip);
  } else {
      console.log("No data or error:", error);
  }
}

inspectOrderColumns();

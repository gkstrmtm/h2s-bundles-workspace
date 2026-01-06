// Activate Robert Bland's Pro account
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

async function activatePro() {
  console.log("🔓 Activating Robert Bland's Pro account...\n");

  const { error } = await supabase
    .from('h2s_pros')
    .update({
      is_active: true,
      is_available_now: true
    })
    .eq('email', 'rbland.bluehorizoncontractors@gmail.com');

  if (error) {
    console.error("❌ Failed:", error.message);
  } else {
    console.log("✅ Pro account activated successfully!");
    console.log("   is_active: true");
    console.log("   is_available_now: true\n");
  }
}

activatePro();

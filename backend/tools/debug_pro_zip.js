// Debug Pro zip extraction
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

async function debugPros() {
  const { data: pros } = await supabase.from('h2s_pros').select('*').limit(5);
  
  pros.forEach(pro => {
    console.log('Pro ID:', pro.pro_id);
    console.log('Email:', pro.email);
    console.log('All keys:', Object.keys(pro));
    console.log('Zip value:', pro.zip);
    console.log('Zip type:', typeof pro.zip);
    console.log('');
  });
}

debugPros();

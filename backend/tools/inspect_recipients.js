// Script to inspect the h2s_dispatch_recipients table
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

async function inspectRecipients() {
  console.log("🔍 Inspecting h2s_dispatch_recipients...");

  // Check columns
  const { data, error } = await supabase.from('h2s_dispatch_recipients').select('*').limit(1);
  
  if (error) {
    console.log("Error selecting recipients:", error.message);
    // Maybe table name is different?
    return;
  }
  
  if (data.length > 0) {
    console.log("Columns:", Object.keys(data[0]));
    console.log("Sample:", data[0]);
  } else {
    console.log("Table allows read but is empty.");
  }
  
  // Try inserting a new recipient
  const newId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
  
  const payload = { recipient_id: newId, name: 'Test Recipient', email: 'test@example.com' }; // Guessing columns
  
  // Actually, we should just trying inserting minimal payload based on what we see in columns
  // If we can insert a recipient, we solve the uniqueness problem.
}

inspectRecipients();

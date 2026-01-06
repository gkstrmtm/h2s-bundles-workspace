// Script to inspect check constraints on h2s_dispatch_jobs
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

async function inspectConstraints() {
  console.log("🔍 Inspecting CHECK constraints on h2s_dispatch_jobs...");
  
  // We can't query information_schema directly easily via supabase-js unless exposed via RPC or standard access.
  // Instead, let's try to 'brute force' check by trying to insert common known statuses and seeing which one succeeds.
  
  const testStatuses = [
    'queued', 'pending', 'new', 'draft', 'open', 'available', 'unassigned', 
    'offered', 'scheduled', 'assigned', 'in_progress', 'completed', 'canceled'
  ];
  
  // Create a minimal valid payload based on previous success attempts
  const basePayload = {
    created_at: new Date().toISOString(),
    due_at: new Date(Date.now() + 86400000).toISOString(),
    recipient_id: '2ddbb40b-5587-4bd9-b78d-e7ff8754968f',
    sequence_id: '88297425-c134-4a51-8450-93cb35b1b3cb',
    step_id: 'd30da333-3a54-4598-8ac1-f3b276185ea1'
  };

  for (const status of testStatuses) {
    console.log(`Testing status: '${status}'...`);
    const { data, error } = await supabase
      .from('h2s_dispatch_jobs')
      .insert({ ...basePayload, status: status })
      .select()
      .single();
      
    if (!error) {
      console.log(`✅ SUCCESS! Status '${status}' is allowed.`);
      // Clean up
      await supabase.from('h2s_dispatch_jobs').delete().eq('job_id', data.job_id);
    } else {
      if (error.message.includes('check constraint')) {
        console.log(`❌ Failed: '${status}' violated constraint.`);
      } else {
        console.log(`❌ Error testing '${status}':`, error.message);
      }
    }
  }
}

inspectConstraints();

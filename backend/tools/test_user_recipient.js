// Script to test if recipient_id = auth.users.id
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

async function testUserAsRecipient() {
  console.log("🔍 Testing creating a NEW USER and using it as RECIPIENT_ID...");
  
  // Create a new user (in h2s_users or check auth)
  // Since we can't create auth users easily without admin API (we have service key), try creating in likely public tables first.
  
  /* 
     Actually, looking at previous code, verify_checkout_flow.js failed on FK constraint `h2s_dispatch_jobs_recipient_id_fkey`.
     Usually FKs names give a hint. `h2s_dispatch_jobs_recipient_id_fkey` -> `recipient_id`.
     If it references `h2s_users`, a random UUID fails.
     If I insert into `h2s_users` first, then use that ID?
  */
  
  const randomId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
  
  // Try inserting into h2s_dispatch_recipients again, maybe I got name wrong? 
  // Maybe `h2s_customers`?
  
  // Let's try to query `h2s_users` limit 1.
  const { data: users } = await supabase.from('h2s_users').select('id, user_id').limit(1);
  if (users && users.length > 0) {
    console.log("Found h2s_users:", users[0]);
  } else {
    console.log("h2s_users empty or not accessible");
  }

  // Let's try to insert a dummy user into 'h2s_users' or 'h2s_customers'
  // If `h2s_users` exists
  try {
    const { data: newUser, error: userError } = await supabase.from('h2s_users').insert({
      id: randomId,
      email: `test-${Date.now()}@example.com`,
      full_name: 'Test Recipient'
    }).select().single();
    
    if (userError) {
      console.log("Failed to insert h2s_users:", userError.message);
    } else {
      console.log("Created h2s_user:", newUser.id);
      
      // NOW TRY TO INSERT JOB WITH THIS ID
      const { error: jobError } = await supabase.from('h2s_dispatch_jobs').insert({
         recipient_id: newUser.id,
         status: 'queued',
         created_at: new Date().toISOString(),
         due_at: new Date(Date.now() + 86400000).toISOString(),
         sequence_id: '88297425-c134-4a51-8450-93cb35b1b3cb',
         step_id: 'd30da333-3a54-4598-8ac1-f3b276185ea1',
      });
      
      if (!jobError) {
        console.log("✅ SUCCESS! Recipient ID is a User ID.");
      } else {
        console.log("❌ Failed using User ID:", jobError.message);
      }
    }
  } catch(e) { console.log(e); }
}

testUserAsRecipient();

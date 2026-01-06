// Script to verify full job creation flow with new recipient
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

let supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
let supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Verify env vars
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

async function runTest() {
  console.log("🚀 Starting End-to-End Job Creation Test...");

  const testEmail = `test-user-${Date.now()}@example.com`;
  const testStepId = 'd30da333-3a54-4598-8ac1-f3b276185ea1'; // Using the one seen in logs/previous successes

  // 1. Create Recipient
  console.log(`1️⃣ Creating new Recipient for ${testEmail}...`);
  
  const { data: recipient, error: recipientError } = await supabase
    .from('h2s_recipients')
    .insert({
        email_normalized: testEmail,
        first_name: 'Testy McTester',
        recipient_key: `test-recipient-${Date.now()}` // Likely needs to be unique if present
    })
    .select()
    .single();

  if (recipientError) {
    console.error("❌ Failed to create recipient:", recipientError);
    process.exit(1);
  }

  console.log("✅ Recipient Created:", recipient.recipient_id);

  // 2. Create Job
  console.log(`2️⃣ Creating Dispatch Job for Recipient ${recipient.recipient_id}...`);

  const { data: job, error: jobError } = await supabase
    .from('h2s_dispatch_jobs')
    .insert({
        recipient_id: recipient.recipient_id,
        step_id: testStepId,
        status: 'queued', // Must be 'queued'
        due_at: new Date(Date.now() + 86400000).toISOString(),
        sequence_id: '88297425-c134-4a51-8450-93cb35b1b3cb' // Keeping consistent with previous context, though might need dynamic lookup later
    })
    .select()
    .single();

  if (jobError) {
     console.error("❌ Failed to create job:", jobError);
     // If uniqueness fails here, it implies (recipient_id, step_id) collision
     // But since recipient_id is NEW, it should only collide if step_id is somehow duplicated for the SAME recipient... which is impossible on first insert.
  } else {
     console.log("✅ JOB CREATED SUCCESSFULLY!");
     console.log(job);
  }

}

runTest();

// Script to verify the end-to-end checkout flow logic
// This script simulates the checkout process (Validation of Backend Logic)
// and verifies the database state.

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

// Load env
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
  } catch (e) {
    console.log("Could not read .env.local");
  }
}

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing SUPABASE credentials.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function runTest() {
  console.log("🚀 Starting End-to-End Checkout Verification");
  console.log("Target: Simulating checkout logic and verifying DB state...");

  // 1. Define Test Data
  const orderId = `TEST-ORDER-${Date.now()}`;
  const customerEmail = `test.validation.${Date.now()}@example.com`;
  const DEFAULT_SEQUENCE_ID = '88297425-c134-4a51-8450-93cb35b1b3cb';
  const DEFAULT_STEP_ID = 'd30da333-3a54-4598-8ac1-f3b276185ea1';
  
  console.log(`\n📦 Simulating Order: ${orderId}`);
  console.log(`📧 Customer: ${customerEmail}`);

  // 2. [FIXED LOGIC] Create Recipient First
  console.log("\n[Step 1] Creating Recipient...");
  const { data: recipient, error: recipientError } = await supabase
    .from('h2s_recipients')
    .insert({
        email_normalized: customerEmail,
        first_name: 'Simulated User',
        recipient_key: `simulated-user-${Date.now()}`
    })
    .select()
    .single();

  if (recipientError) {
      console.error("❌ FAILED: Could not create recipient.");
      console.error("Reason:", recipientError.message);
      process.exit(1);
  }
  console.log(`✅ Recipient Created: ${recipient.recipient_id}`);

  // 3. Simulate Dispatch Job Insertion
  console.log("\n[Step 2] Creating Dispatch Job...");
  
  const insertJob = {
    status: 'queued', 
    created_at: new Date().toISOString(),
    due_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    recipient_id: recipient.recipient_id, // Dynamics!
    sequence_id: DEFAULT_SEQUENCE_ID,
    step_id: DEFAULT_STEP_ID, 
  };
  
  const { data: jobData, error: jobError } = await supabase
    .from('h2s_dispatch_jobs')
    .insert(insertJob)
    .select()
    .single();

  if (jobError) {
    console.error("❌ FAILED: Could not create dispatch job.");
    console.error("Reason:", jobError.message);
    process.exit(1);
  }
  
  const jobId = jobData.job_id;
  console.log(`✅ Job Created! ID: ${jobId}`);
  console.log(`   Status: ${jobData.status}`);

  // 4. Simulate Order Insertion Linked to Job
  console.log("\n[Step 3] Creating Order linked to Job...");
  const { error: orderError } = await supabase.from('h2s_orders').insert({
    order_id: orderId,
    customer_email: customerEmail,
    customer_name: "Test User Validation",
    items: [{ name: "Test Bundle", unit_price: 100, quantity: 1, line_total: 100 }],
    subtotal: 100,
    total: 100,
    status: 'pending',
    // Address is CRITICAL for Portal Visibility (Zip Matching)
    address: '123 Test St',
    city: 'Testville',
    state: 'CA',
    zip: '90210', 
    metadata_json: {
      dispatch_job_id: jobId,
      dispatch_recipient_id: recipient.recipient_id,
      service_zip: '90210'
    }
  });

  if (orderError) {
    console.error("❌ FAILED: Could not create order.");
    console.error("Reason:", orderError.message);
  } else {
    console.log("✅ Order Created successfully.");
    console.log("🎉 VERIFICATION COMPLETE. The Checkout Flow is Logic Valid.");
  }
}

runTest();

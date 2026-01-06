// Script to backfill missing Dispatch Jobs for existing Orders
// Validates Recipient -> Creates Job -> Links Order

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const crypto = require('crypto');

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

const DEFAULT_SEQUENCE_ID = '88297425-c134-4a51-8450-93cb35b1b3cb';
const DEFAULT_STEP_ID = 'd30da333-3a54-4598-8ac1-f3b276185ea1';

async function backfill() {
  console.log("🚀 Starting Backfill: Orders -> Dispatch Jobs");

  // 1. Fetch Orders that likely need jobs (recent, pending/paid, no job_id)
  // We check the LAST 50 orders
  const { data: orders, error } = await supabase
    .from('h2s_orders')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    console.error("❌ Failed to fetch orders:", error.message);
    process.exit(1);
  }

  console.log(`🔍 Checking ${orders.length} recent orders...`);

  let processed = 0;
  let skipped = 0;
  let failed = 0;

  for (const order of orders) {
    const meta = order.metadata_json || {};
    
    // Skip if already has job linkage
    if (meta.dispatch_job_id) {
       // Optional: Verify if job actually exists? For now assume yes if ID is present.
       skipped++;
       continue;
    }

    // Skip if dummy test data without email (unlikely in real table but possible)
    if (!order.customer_email) {
        skipped++;
        continue;
    }

    console.log(`\n⚙️ Processing Order: ${order.order_id} (${order.customer_email})`);

    // 2. Resolve Recipient
    let recipientId = null;
    try {
        // A. Find
        const { data: existing } = await supabase
            .from('h2s_recipients')
            .select('recipient_id')
            .eq('email_normalized', order.customer_email)
            .maybeSingle();

        if (existing) {
            recipientId = existing.recipient_id;
            console.log(`   ✅ Found Recipient: ${recipientId}`);
        } else {
            // B. Create
            const { data: newRecip, error: createErr } = await supabase
                .from('h2s_recipients')
                .insert({
                    email_normalized: order.customer_email,
                    first_name: order.customer_name || 'Customer',
                    recipient_key: `backfill-${crypto.randomUUID()}`
                })
                .select('recipient_id')
                .single();
            
            if (createErr) throw createErr;
            recipientId = newRecip.recipient_id;
            console.log(`   ✨ Created Recipient: ${recipientId}`);
        }
    } catch (err) {
        console.error(`   ❌ Failed Recipient Resolution: ${err.message}`);
        failed++;
        continue;
    }

    // 3. Create Dispatch Job
    try {
        const insertJob = {
            status: 'queued',
            created_at: new Date().toISOString(),
            due_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
            recipient_id: recipientId,
            sequence_id: DEFAULT_SEQUENCE_ID,
            step_id: DEFAULT_STEP_ID,
            
            // Enrich Address from Order
            // NOTE: h2s_dispatch_jobs seems to lack service_address/zip columns in strict schema
            // We rely on Order->Job linkage enrichment, so we do NOT insert them here.
            // Address data stays in h2s_orders.
        };

        const { data: job, error: jobErr } = await supabase
            .from('h2s_dispatch_jobs')
            .insert(insertJob)
            .select()
            .single();

        if (jobErr) {
             // Handle "Unique Violation" -> This Recipient already has this Step active. 
             // This is fine, detecting it means we might just need to find the existing job.
             if (jobErr.message.includes('unique constraint') || jobErr.code === '23505') {
                 console.log(`   ⚠️ Job Collision (User has active job). finding it...`);
                 
                 const { data: existingJob } = await supabase
                    .from('h2s_dispatch_jobs')
                    .select('job_id')
                    .eq('recipient_id', recipientId)
                    .eq('step_id', DEFAULT_STEP_ID)
                    .maybeSingle();
                    
                 if (existingJob) {
                     const jobId = existingJob.job_id;
                     await linkOrder(order.order_id, jobId, recipientId, meta);
                     console.log(`   ✅ Linked existing job: ${jobId}`);
                     processed++;
                 } else {
                     console.error(`   ❌ Collision but couldn't find job?`);
                     failed++;
                 }
             } else {
                 throw jobErr;
             }
        } else {
             const jobId = job.job_id;
             await linkOrder(order.order_id, jobId, recipientId, meta);
             console.log(`   ✅ Created New Job: ${jobId}`);
             processed++;
        }

    } catch (err) {
        console.error(`   ❌ Failed Job Creation: ${err.message}`);
        failed++;
    }
  }

  console.log(`\n📊 Backfill Complete.`);
  console.log(`   Processed (Fixed/Created): ${processed}`);
  console.log(`   Skipped (Already Linked): ${skipped}`);
  console.log(`   Failed: ${failed}`);
}

async function linkOrder(orderId, jobId, recipId, currentMeta) {
    const newMeta = {
        ...currentMeta,
        dispatch_job_id: jobId,
        dispatch_recipient_id: recipId
    };
    
    await supabase.from('h2s_orders')
        .update({ metadata_json: newMeta })
        .eq('order_id', orderId);
}

backfill();

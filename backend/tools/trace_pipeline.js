/**
 * END-TO-END PIPELINE TRACE TOOL
 * Tests: Order → DB → Geo → Job → Portal visibility
 * Produces timestamped correlation trace
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '../.env.local' });
const crypto = require('crypto');

// =================================================================
// CONFIGURATION
// =================================================================

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Missing env vars: SUPABASE_URL or SUPABASE_SERVICE_KEY');
  console.error('   Set them in .env.local at workspace root');
  process.exit(1);
}

const client = createClient(SUPABASE_URL, SUPABASE_KEY);

// =================================================================
// TRACE UTILITIES
// =================================================================

const CORRELATION_ID = `TRACE-${Date.now()}-${crypto.randomUUID().substring(0, 8)}`;
let traceLog = [];

function log(stage, message, data = null) {
  const timestamp = new Date().toISOString();
  const entry = {
    correlation_id: CORRELATION_ID,
    timestamp,
    stage,
    message,
    data
  };
  traceLog.push(entry);
  console.log(`[${timestamp}] [${stage}] ${message}`);
  if (data) console.log(JSON.stringify(data, null, 2));
}

// =================================================================
// PHASE 1: SYSTEM MAP (from code inspection)
// =================================================================

function printSystemMap() {
  console.log('\n' + '='.repeat(80));
  console.log('📋 SYSTEM MAP (Current State)');
  console.log('='.repeat(80));

  console.log(`
1. ORDER CREATION TRIGGER:
   - User completes checkout on bundles.html
   - POST /api/shop (action=checkout)
   - Stripe session created
   - Order row inserted IMMEDIATELY (not waiting for webhook)
   
2. h2s_orders WRITE:
   - Table: h2s_orders
   - Fields: order_id, session_id, customer_email, customer_name, customer_phone,
             items (JSON), subtotal, total, currency, status='pending',
             address, city, state, zip, metadata_json, created_at
   - Primary Key: order_id (auto-generated ORD-XXXXXXXX)
   - NO unique constraint on session_id (RISK: duplicate orders)

3. GEO LOOKUP:
   - NOT done during order creation
   - Happens in portal_jobs API when pro requests jobs
   - Uses Google Maps API to geocode ZIP → lat/lng
   - No pre-computed area/zone assignment
   - Cached in-memory per lambda (ZIP_GEO_CACHE)

4. DISPATCH JOB CREATION:
   - Table: h2s_dispatch_jobs
   - Happens AFTER order insert (lines 1080-1200 in shop/route.ts)
   - Required fields: status='queued', recipient_id, sequence_id, step_id
   - Links back via metadata_json.dispatch_job_id in h2s_orders
   - RISK: recipient collision (unique constraint on recipient_id + step_id)
   
5. PRO PORTAL QUERY:
   - Endpoint: GET /api/portal_jobs
   - Queries: h2s_dispatch_jobs WHERE status='queued' or 'scheduled'
   - Enriches with h2s_orders data via metadata_json.dispatch_job_id
   - Filters by:
     a) Pro is_active=true
     b) Distance < service_radius_miles (Haversine)
     c) Status NOT 'completed', 'cancelled', 'assigned' (if has assign date)
   
6. PRO ACCOUNT CREATION:
   - Endpoint: POST /api/portal_signup_step1
   - Creates row in h2s_pros with is_active=false
   - Issues JWT token (portalTokens.ts)
   - NO Supabase Auth user created (custom JWT only)
   - Admin must activate via dispatch.html Pro Management

TABLES:
  - h2s_orders: order_id (PK), session_id, customer_*, items, status, address/city/state/zip
  - h2s_dispatch_jobs: job_id (PK), status, recipient_id, sequence_id, step_id, created_at
  - h2s_recipients: recipient_id (PK), email_normalized (UNIQUE), first_name, recipient_key
  - h2s_pros: pro_id (PK), email (UNIQUE), name, is_active, service_radius_miles, geo_lat/lng

FAILURE MODES (suspected):
  1. Duplicate orders if Stripe webhook retries (no idempotency on session_id)
  2. Missing ZIP causes geo lookup to fail → job invisible to pros
  3. Recipient collision on (recipient_id, step_id) prevents job creation
  4. Jobs with status='pending' don't appear (portal filters for 'queued')
  5. Pro with is_active=false can't see any jobs (portal checks is_active)
  6. Job created but order enrichment fails → service_address missing
`);

  console.log('='.repeat(80) + '\n');
}

// =================================================================
// PHASE 2: END-TO-END TRACE
// =================================================================

async function runEndToEndTrace() {
  log('START', `Correlation ID: ${CORRELATION_ID}`);

  try {
    // T0: Simulate order creation
    log('T0', 'Simulating order creation');
    const orderId = `ORD-${crypto.randomUUID().substring(0, 8).toUpperCase()}`;
    const sessionId = `cs_test_${crypto.randomUUID()}`;
    const customerEmail = `test.${Date.now()}@example.com`;
    
    const orderPayload = {
      order_id: orderId,
      session_id: sessionId,
      customer_email: customerEmail,
      customer_name: 'Test Customer',
      customer_phone: '8641234567',
      items: [
        { name: 'Security Camera Installation', unit_price: 299, quantity: 2, line_total: 598 }
      ],
      subtotal: 598,
      total: 598,
      currency: 'usd',
      status: 'pending',
      address: '123 Main St',
      city: 'Greenwood',
      state: 'SC',
      zip: '29646',
      metadata_json: {
        service_address: '123 Main St',
        service_city: 'Greenwood',
        service_state: 'SC',
        service_zip: '29646'
      },
      created_at: new Date().toISOString()
    };

    // T1: Insert order
    log('T1', 'Inserting order into h2s_orders', { orderId, customerEmail });
    const { data: orderData, error: orderError } = await client
      .from('h2s_orders')
      .insert(orderPayload)
      .select()
      .single();

    if (orderError) {
      log('T1_ERROR', 'Order insert failed', orderError);
      throw orderError;
    }

    log('T1_SUCCESS', 'Order inserted successfully', { order_id: orderData.order_id });

    // T2: Resolve/create recipient
    log('T2', 'Resolving recipient for customer', { customerEmail });
    let recipientId = null;

    const { data: existingRecipient } = await client
      .from('h2s_recipients')
      .select('recipient_id')
      .eq('email_normalized', customerEmail)
      .maybeSingle();

    if (existingRecipient) {
      recipientId = existingRecipient.recipient_id;
      log('T2_FOUND', 'Found existing recipient', { recipientId });
    } else {
      const { data: newRecipient, error: recipientError } = await client
        .from('h2s_recipients')
        .insert({
          email_normalized: customerEmail,
          first_name: 'Test',
          recipient_key: `customer-${crypto.randomUUID()}`
        })
        .select('recipient_id')
        .single();

      if (recipientError) {
        log('T2_ERROR', 'Recipient creation failed', recipientError);
        throw recipientError;
      }

      recipientId = newRecipient.recipient_id;
      log('T2_SUCCESS', 'Created new recipient', { recipientId });
    }

    // T3: Create dispatch job
    log('T3', 'Creating dispatch job');
    const jobPayload = {
      status: 'queued',
      recipient_id: recipientId,
      sequence_id: '88297425-c134-4a51-8450-93cb35b1b3cb', // Default
      step_id: 'd30da333-3a54-4598-8ac1-f3b276185ea1', // Default
      created_at: new Date().toISOString(),
      due_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    };

    const { data: jobData, error: jobError } = await client
      .from('h2s_dispatch_jobs')
      .insert(jobPayload)
      .select()
      .single();

    if (jobError) {
      log('T3_ERROR', 'Job creation failed', jobError);
      throw jobError;
    }

    const jobId = jobData.job_id;
    log('T3_SUCCESS', 'Dispatch job created', { jobId });

    // T3.5: Link job back to order
    log('T3.5', 'Linking job to order metadata');
    await client
      .from('h2s_orders')
      .update({
        metadata_json: {
          ...orderPayload.metadata_json,
          dispatch_job_id: jobId,
          dispatch_recipient_id: recipientId
        }
      })
      .eq('order_id', orderId);

    log('T3.5_SUCCESS', 'Job linked to order');

    // T4: Verify job appears in portal query (simulate pro in Greenwood)
    log('T4', 'Querying portal_jobs (simulating pro in Greenwood, SC 29646)');
    
    // First check if any active pros exist
    const { data: pros } = await client
      .from('h2s_pros')
      .select('pro_id, email, name, is_active, geo_lat, geo_lng, service_radius_miles')
      .eq('is_active', true)
      .limit(5);

    log('T4_PROS', 'Active pros in system', { count: pros?.length || 0, pros });

    // Query jobs (simplified version of portal_jobs logic)
    const { data: jobs } = await client
      .from('h2s_dispatch_jobs')
      .select('*')
      .in('status', ['queued', 'scheduled'])
      .order('created_at', { ascending: false });

    log('T4_JOBS', 'Jobs in queued/scheduled status', { count: jobs?.length || 0 });

    const ourJob = jobs?.find(j => j.job_id === jobId);
    
    if (ourJob) {
      log('T4_SUCCESS', 'Job found in portal query!', { job_id: jobId, status: ourJob.status });
    } else {
      log('T4_FAILURE', 'Job NOT found in portal query', { expected_job_id: jobId, available_jobs: jobs?.length });
    }

    // T5: Check order-job enrichment
    log('T5', 'Checking order enrichment for job');
    const { data: enrichedOrder } = await client
      .from('h2s_orders')
      .select('*')
      .eq('order_id', orderId)
      .single();

    const linkedJobId = enrichedOrder?.metadata_json?.dispatch_job_id;
    
    if (linkedJobId === jobId) {
      log('T5_SUCCESS', 'Order correctly linked to job', { order_id: orderId, job_id: jobId });
    } else {
      log('T5_FAILURE', 'Order NOT linked to job', { expected: jobId, actual: linkedJobId });
    }

    // FINAL SUMMARY
    log('COMPLETE', 'End-to-end trace finished', {
      orderId,
      jobId,
      recipientId,
      customerEmail,
      jobVisibleInPortal: !!ourJob,
      orderLinkedToJob: linkedJobId === jobId
    });

    console.log('\n' + '='.repeat(80));
    console.log('📊 TRACE TIMELINE');
    console.log('='.repeat(80));
    traceLog.forEach(entry => {
      console.log(`${entry.timestamp} | ${entry.stage.padEnd(15)} | ${entry.message}`);
    });
    console.log('='.repeat(80) + '\n');

    return {
      success: true,
      orderId,
      jobId,
      recipientId,
      jobVisibleInPortal: !!ourJob,
      orderLinkedToJob: linkedJobId === jobId
    };

  } catch (err) {
    log('FATAL_ERROR', 'Trace failed', { error: err.message, stack: err.stack });
    return { success: false, error: err.message };
  }
}

// =================================================================
// MAIN
// =================================================================

async function main() {
  console.log('\n🔍 HOME2SMART PIPELINE AUDITOR\n');
  
  printSystemMap();
  
  console.log('🧪 Running End-to-End Trace...\n');
  const result = await runEndToEndTrace();

  if (result.success) {
    console.log('\n✅ TRACE COMPLETED SUCCESSFULLY\n');
    console.log(`Order ID: ${result.orderId}`);
    console.log(`Job ID: ${result.jobId}`);
    console.log(`Job Visible in Portal: ${result.jobVisibleInPortal ? '✅ YES' : '❌ NO'}`);
    console.log(`Order Linked to Job: ${result.orderLinkedToJob ? '✅ YES' : '❌ NO'}`);
  } else {
    console.log('\n❌ TRACE FAILED\n');
    console.log(`Error: ${result.error}`);
    process.exit(1);
  }
}

main().then(() => process.exit(0)).catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

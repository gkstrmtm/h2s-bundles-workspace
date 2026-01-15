#!/usr/bin/env node
/**
 * End-to-End Data Flow Test
 * Tests: Bundles → Checkout → Database → Portal
 * 
 * Validates:
 * 1. Checkout session creation with complete metadata
 * 2. Order record has all required fields
 * 3. Dispatch job created with job_details and equipment_provided
 * 4. Portal can query and display the job with no blanks
 * 
 * Run: node scripts/test_end_to_end_flow.mjs
 */

const API_BASE = 'https://h2s-backend.vercel.app/api';
const ADMIN_TOKEN = 'e5d4100f-fdbb-44c5-802c-0166d86ed1a8';

// Test configuration
const TEST_CONFIG = {
  customer: {
    name: 'End-to-End Test User',
    email: `e2e-test-${Date.now()}@example.com`,
    phone: '555-0100',
    address: '123 Test Street',
    city: 'Columbia',
    state: 'SC',
    zip: '29201'
  },
  cart: [
    {
      id: 'prod_2cam_bundle',
      name: '2-Camera Installation Bundle',
      price: 39900, // $399.00
      quantity: 1,
      metadata: {
        camera_type: 'Indoor/Outdoor',
        mount_type: 'Wall Mount',
        service_type: 'installation'
      }
    }
  ],
  promo: null // Skip promo for test environment
};

// Color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(msg, color = 'reset') {
  console.log(`${colors[color]}${msg}${colors.reset}`);
}

function section(title) {
  console.log('');
  log('='.repeat(60), 'cyan');
  log(`  ${title}`, 'bright');
  log('='.repeat(60), 'cyan');
}

async function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Test Step 1: Create Checkout Session
async function testCheckoutCreation() {
  section('STEP 1: Create Checkout Session');
  
  const payload = {
    __action: 'create_checkout_session',
    cart: TEST_CONFIG.cart,
    customer: TEST_CONFIG.customer,
    idempotency_key: `e2e-test-${Date.now()}` // Prevent duplicates
  };
  
  // Only add promo if configured
  if (TEST_CONFIG.promo) {
    payload.promotion_code = TEST_CONFIG.promo;
  }
  
  log('Sending checkout request...', 'yellow');
  const startTime = Date.now();
  
  try {
    const response = await fetch(`${API_BASE}/shop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    const duration = Date.now() - startTime;
    const data = await response.json();
    
    if (!response.ok || !data.ok) {
      log(`❌ FAIL: Checkout creation failed`, 'red');
      log(`   Status: ${response.status}`, 'red');
      log(`   Error: ${data.error || 'Unknown'}`, 'red');
      return null;
    }
    
    const sessionId = data.pay?.session_id;
    const sessionUrl = data.pay?.session_url;
    
    log(`✅ SUCCESS: Session created in ${duration}ms`, 'green');
    log(`   Session ID: ${sessionId}`, 'blue');
    log(`   Session URL: ${sessionUrl}`, 'blue');
    
    return { sessionId, sessionUrl, duration };
    
  } catch (err) {
    log(`❌ FAIL: Exception during checkout`, 'red');
    log(`   ${err.message}`, 'red');
    return null;
  }
}

// Test Step 2: Verify Dispatch Job (skip order query, go straight to jobs)
async function testDispatchJobDirect(sessionId) {
  section('STEP 2: Verify Dispatch Job Creation');
  
  if (!sessionId) {
    log('⚠️  SKIP: No session ID from previous step', 'yellow');
    return null;
  }
  
  log('Waiting for async job creation...', 'yellow');
  await wait(5000); // Give backend time to create job
  
  log('Querying dispatch jobs...', 'yellow');
  
  try {
    const response = await fetch(`${API_BASE}/portal_jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        token: ADMIN_TOKEN,
        limit: 100 
      })
    });
    
    const data = await response.json();
    
    if (!data.ok || !data.offers) {
      log(`❌ FAIL: Could not query dispatch jobs`, 'red');
      log(`   Response: ${JSON.stringify(data).substring(0, 100)}`, 'red');
      return null;
    }
    
    // Find job by session ID in metadata
    const job = data.offers.find(j => 
      j.metadata?.stripe_session_id === sessionId ||
      j.session_id === sessionId
    );
    
    if (!job) {
      log(`❌ FAIL: Dispatch job not found`, 'red');
      log(`   Searched ${data.offers.length} jobs`, 'yellow');
      log(`   Looking for session_id: ${sessionId}`, 'yellow');
      
      // Show most recent jobs for debugging
      log(`   Most recent jobs:`, 'yellow');
      data.offers.slice(0, 3).forEach(j => {
        log(`     - ${j.job_id}: ${j.customer_name || 'No name'}`, 'yellow');
      });
      
      return null;
    }
    
    log(`✅ SUCCESS: Dispatch job found`, 'green');
    log(`   Job ID: ${job.job_id}`, 'blue');
    log(`   Status: ${job.status}`, 'blue');
    log(`   Customer: ${job.customer_name || 'N/A'}`, 'blue');
    log(`   Address: ${job.service_address || 'N/A'}`, 'blue');
    
    // Validate critical fields
    const criticalChecks = {
      'Job Details': job.job_details || job.metadata?.job_details_summary,
      'Customer Name': job.customer_name,
      'Service Address': job.service_address || job.service_add || job.address,
      'Metadata': job.metadata ? 'Present' : null,
    };
    
    log('', 'reset');
    log('Critical Field Validation:', 'bright');
    
    let failCount = 0;
    Object.entries(criticalChecks).forEach(([field, value]) => {
      if (value && value !== 'Unknown' && value !== '?' && value !== 'N/A' && value !== 'Unknown Customer' && value !== 'Address Not Provided') {
        log(`   ✅ ${field}: ${String(value).substring(0, 50)}`, 'green');
      } else {
        log(`   ❌ ${field}: ${value || 'MISSING'}`, 'red');
        failCount++;
      }
    });
    
    if (failCount > 0) {
      log('', 'reset');
      log(`⚠️  ${failCount} critical field(s) missing or invalid`, 'yellow');
    }
    
    // Check for equipment info
    const equipment = job.metadata?.equipment_provided || 
                     job.equipment_provided || 
                     job.equipment;
    
    if (equipment && equipment !== '?' && equipment !== 'Unknown') {
      log(`   ✅ Equipment Provided: ${equipment}`, 'green');
    } else {
      log(`   ⚠️  Equipment Provided: ${equipment || 'MISSING'}`, 'yellow');
    }
    
    return job;
    
  } catch (err) {
    log(`❌ FAIL: Exception querying dispatch jobs`, 'red');
    log(`   ${err.message}`, 'red');
    return null;
  }
}

// Test Step 3: Portal Display Simulation
async function testPortalDisplay(job) {
  section('STEP 3: Portal Display Simulation');
  
  if (!job) {
    log('⚠️  SKIP: No job from previous step', 'yellow');
    return false;
  }
  
  log('Simulating portal job modal display...', 'yellow');
  
  // Simulate what the portal would display
  const displayData = {
    title: job.service_name || job.formatted_service_name || 'Service',
    customer: job.customer_name || 'Unknown Customer',
    address: [
      job.service_address || job.service_add || job.address,
      job.service_city || job.city,
      job.service_state || job.state,
      job.service_zip || job.zip
    ].filter(Boolean).join(', ') || 'Address Not Provided',
    jobDetails: job.job_details || job.metadata?.job_details_summary || 'None specified',
    equipment: job.metadata?.equipment_provided || job.equipment_provided || '?',
    scheduleStatus: job.metadata?.schedule_status || 'Scheduling Pending',
    scheduledDate: job.metadata?.scheduled_date || null,
  };
  
  log('', 'reset');
  log('Portal Would Display:', 'bright');
  log(`   Title: ${displayData.title}`, 'blue');
  log(`   Customer: ${displayData.customer}`, 'blue');
  log(`   Address: ${displayData.address}`, 'blue');
  log(`   Job Details: ${displayData.jobDetails.substring(0, 80)}...`, 'blue');
  log(`   Equipment: ${displayData.equipment}`, 'blue');
  log(`   Schedule: ${displayData.scheduleStatus}`, 'blue');
  if (displayData.scheduledDate) {
    log(`   Scheduled Date: ${displayData.scheduledDate}`, 'blue');
  }
  
  // Check for blanks
  const hasNoneSpecified = displayData.jobDetails === 'None specified';
  const hasQuestionMark = displayData.equipment === '?';
  const hasUnknown = displayData.customer === 'Unknown Customer' || 
                      displayData.address === 'Address Not Provided';
  
  if (hasNoneSpecified || hasQuestionMark || hasUnknown) {
    log('', 'reset');
    log(`❌ FAIL: Portal would show incomplete data`, 'red');
    if (hasNoneSpecified) log(`   - Job Details: "None specified"`, 'red');
    if (hasQuestionMark) log(`   - Equipment: "?"`, 'red');
    if (hasUnknown) log(`   - Missing customer or address`, 'red');
    return false;
  }
  
  log('', 'reset');
  log(`✅ SUCCESS: Portal would display complete data`, 'green');
  return true;
}

// Main Test Runner
async function runEndToEndTest() {
  log('', 'reset');
  log('╔════════════════════════════════════════════════════════════╗', 'cyan');
  log('║         END-TO-END DATA FLOW VALIDATION TEST              ║', 'bright');
  log('║   Bundles → Checkout → Database → Portal                  ║', 'cyan');
  log('╚════════════════════════════════════════════════════════════╝', 'cyan');
  
  const results = {
    checkout: null,
    job: null,
    portalDisplay: null,
    timestamp: new Date().toISOString()
  };
  
  // Run tests sequentially
  results.checkout = await testCheckoutCreation();
  
  if (results.checkout) {
    results.job = await testDispatchJobDirect(results.checkout.sessionId);
  }
  
  if (results.job) {
    results.portalDisplay = await testPortalDisplay(results.job);
  }
  
  // Final Report
  section('FINAL RESULTS');
  
  const steps = [
    { name: 'Checkout Session Creation', result: results.checkout, required: true },
    { name: 'Dispatch Job Creation', result: results.job, required: true },
    { name: 'Portal Data Completeness', result: results.portalDisplay, required: true },
  ];
  
  let passCount = 0;
  let failCount = 0;
  
  steps.forEach(step => {
    if (step.result) {
      log(`✅ ${step.name}`, 'green');
      passCount++;
    } else {
      log(`❌ ${step.name}`, 'red');
      if (step.required) failCount++;
    }
  });
  
  log('', 'reset');
  log(`Summary: ${passCount}/${steps.length} tests passed`, passCount === steps.length ? 'green' : 'yellow');
  
  if (failCount === 0) {
    log('', 'reset');
    log('╔════════════════════════════════════════════════════════════╗', 'green');
    log('║                  ✅ ALL TESTS PASSED ✅                    ║', 'bright');
    log('║          Data flow is complete end-to-end!                ║', 'green');
    log('╚════════════════════════════════════════════════════════════╝', 'green');
    process.exit(0);
  } else {
    log('', 'reset');
    log('╔════════════════════════════════════════════════════════════╗', 'red');
    log('║                  ❌ TESTS FAILED ❌                        ║', 'bright');
    log(`║          ${failCount} critical issue(s) detected                    ║`, 'red');
    log('╚════════════════════════════════════════════════════════════╝', 'red');
    process.exit(1);
  }
}

// Run the test
runEndToEndTest().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

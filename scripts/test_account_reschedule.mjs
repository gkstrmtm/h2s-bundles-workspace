#!/usr/bin/env node
/**
 * ACCOUNT TAB - RESCHEDULING TEST MATRIX
 * 
 * Tests customer rescheduling functionality with 4 scenarios:
 * 1. Reschedule Pending order → becomes Scheduled
 * 2. Reschedule Scheduled order → date changes
 * 3. Invalid date input → blocked with error
 * 4. Persistence test → date persists after refresh
 * 
 * Usage:
 *   node scripts/test_account_reschedule.mjs
 * 
 * Requirements:
 *   - Backend deployed
 *   - Valid test order with session_id
 */

import https from 'https';
import http from 'http';

const BACKEND_URL = process.env.BACKEND_URL || 'https://h2s-backend.vercel.app';
const TEST_SESSION_ID = process.env.TEST_SESSION_ID || 'cs_test_reschedule_123';
const TEST_ORDER_ID = process.env.TEST_ORDER_ID || '';

// ANSI color codes
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

const results = {
  passed: 0,
  failed: 0,
  total: 4,
  startTime: Date.now(),
};

/**
 * HTTP POST helper
 */
function post(url, body) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const lib = parsedUrl.protocol === 'https:' ? https : http;
    
    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };
    
    const req = lib.request(parsedUrl, options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * Generate future date (N days from now)
 */
function getFutureDate(daysAhead) {
  const date = new Date();
  date.setDate(date.getDate() + daysAhead);
  return date.toISOString().split('T')[0]; // YYYY-MM-DD
}

/**
 * Test runner
 */
async function runTest(testNum, description, testFn) {
  const testLabel = `Test ${testNum}: ${description}`;
  console.log(`\n${CYAN}${BOLD}━━━ ${testLabel} ━━━${RESET}`);
  
  try {
    const result = await testFn();
    
    if (result.passed) {
      console.log(`${GREEN}✓ PASS${RESET}: ${result.message}`);
      if (result.details) {
        console.log(`${CYAN}Details:${RESET}`, JSON.stringify(result.details, null, 2));
      }
      results.passed++;
    } else {
      console.log(`${RED}✗ FAIL${RESET}: ${result.message}`);
      if (result.details) {
        console.log(`${YELLOW}Details:${RESET}`, JSON.stringify(result.details, null, 2));
      }
      results.failed++;
    }
  } catch (error) {
    console.log(`${RED}✗ ERROR${RESET}: ${error.message}`);
    console.error(error);
    results.failed++;
  }
}

/**
 * TEST 1: Reschedule Pending order → becomes Scheduled
 */
async function test1_reschedulePendingOrder() {
  const futureDate = getFutureDate(7); // 1 week from now
  
  const payload = JSON.stringify({
    session_id: TEST_SESSION_ID,
    scheduled_iso: futureDate,
    timezone: 'America/Chicago',
    time_window: '9am - 12pm',
  });
  
  const res = await post(`${BACKEND_URL}/api/customer_reschedule`, payload);
  
  if (res.status === 200 && res.body.ok) {
    return {
      passed: true,
      message: 'Pending order rescheduled successfully',
      details: {
        updated_order_id: res.body.updated_order_id,
        updated_job_id: res.body.updated_job_id,
        scheduled_date: res.body.scheduled_date,
        time_window: res.body.time_window,
        was_rescheduled: res.body.was_rescheduled,
        duration_ms: res.body.duration_ms,
      },
    };
  } else {
    return {
      passed: false,
      message: `Reschedule failed with status ${res.status}`,
      details: res.body,
    };
  }
}

/**
 * TEST 2: Reschedule Scheduled order → date changes
 */
async function test2_rescheduleScheduledOrder() {
  const newDate = getFutureDate(14); // 2 weeks from now (different from Test 1)
  
  const payload = JSON.stringify({
    session_id: TEST_SESSION_ID,
    scheduled_iso: newDate,
    timezone: 'America/New_York',
    time_window: '12pm - 3pm',
  });
  
  const res = await post(`${BACKEND_URL}/api/customer_reschedule`, payload);
  
  if (res.status === 200 && res.body.ok) {
    // Verify the date actually changed
    if (res.body.scheduled_date === newDate && res.body.was_rescheduled === true) {
      return {
        passed: true,
        message: 'Scheduled order rescheduled to new date',
        details: {
          new_date: res.body.scheduled_date,
          new_time_window: res.body.time_window,
          was_rescheduled: res.body.was_rescheduled,
          duration_ms: res.body.duration_ms,
        },
      };
    } else {
      return {
        passed: false,
        message: 'Date did not change or was_rescheduled flag not set',
        details: res.body,
      };
    }
  } else {
    return {
      passed: false,
      message: `Reschedule failed with status ${res.status}`,
      details: res.body,
    };
  }
}

/**
 * TEST 3: Invalid date input → blocked with error
 */
async function test3_invalidDateInput() {
  const testCases = [
    {
      name: 'Invalid format',
      payload: {
        session_id: TEST_SESSION_ID,
        scheduled_iso: '01/15/2026', // Wrong format (should be YYYY-MM-DD)
        timezone: 'America/Chicago',
        time_window: '9am - 12pm',
      },
      expectedErrorCode: 'INVALID_DATE_FORMAT',
    },
    {
      name: 'Date in past',
      payload: {
        session_id: TEST_SESSION_ID,
        scheduled_iso: '2020-01-01',
        timezone: 'America/Chicago',
        time_window: '9am - 12pm',
      },
      expectedErrorCode: 'INVALID_DATE_PAST',
    },
    {
      name: 'Invalid time window',
      payload: {
        session_id: TEST_SESSION_ID,
        scheduled_iso: getFutureDate(7),
        timezone: 'America/Chicago',
        time_window: '8am - 11am', // Not a valid time window
      },
      expectedErrorCode: 'INVALID_TIME_WINDOW',
    },
  ];
  
  const subResults = [];
  
  for (const testCase of testCases) {
    const payload = JSON.stringify(testCase.payload);
    const res = await post(`${BACKEND_URL}/api/customer_reschedule`, payload);
    
    const passed = res.status === 400 && res.body.error_code === testCase.expectedErrorCode;
    
    subResults.push({
      name: testCase.name,
      passed,
      error_code: res.body.error_code,
      error_message: res.body.error,
    });
  }
  
  const allPassed = subResults.every(r => r.passed);
  
  return {
    passed: allPassed,
    message: allPassed ? 'All invalid inputs rejected correctly' : 'Some invalid inputs not rejected properly',
    details: { test_cases: subResults },
  };
}

/**
 * TEST 4: Persistence test → date persists after refresh
 */
async function test4_persistenceTest() {
  const persistentDate = getFutureDate(21); // 3 weeks from now
  
  // First, reschedule to a specific date
  const reschedulePayload = JSON.stringify({
    session_id: TEST_SESSION_ID,
    scheduled_iso: persistentDate,
    timezone: 'America/Los_Angeles',
    time_window: '3pm - 6pm',
  });
  
  const rescheduleRes = await post(`${BACKEND_URL}/api/customer_reschedule`, reschedulePayload);
  
  if (rescheduleRes.status !== 200 || !rescheduleRes.body.ok) {
    return {
      passed: false,
      message: 'Failed to reschedule for persistence test',
      details: rescheduleRes.body,
    };
  }
  
  // Now fetch the order to verify persistence
  const ordersPayload = JSON.stringify({
    session_id: TEST_SESSION_ID,
  });
  
  const ordersRes = await post(`${BACKEND_URL}/api/customer_orders`, ordersPayload);
  
  if (ordersRes.status !== 200 || !ordersRes.body.ok) {
    return {
      passed: false,
      message: 'Failed to fetch orders for persistence verification',
      details: ordersRes.body,
    };
  }
  
  const orders = ordersRes.body.orders || [];
  const order = orders.find(o => o.session_id === TEST_SESSION_ID);
  
  if (!order) {
    return {
      passed: false,
      message: 'Order not found in customer_orders response',
      details: { orders },
    };
  }
  
  // Verify the scheduled date matches
  if (order.scheduled_date === persistentDate && order.time_window === '3pm - 6pm') {
    return {
      passed: true,
      message: 'Schedule persisted successfully',
      details: {
        order_id: order.order_id,
        scheduled_date: order.scheduled_date,
        time_window: order.time_window,
        schedule_status: order.schedule_status,
      },
    };
  } else {
    return {
      passed: false,
      message: 'Schedule did not persist correctly',
      details: {
        expected_date: persistentDate,
        expected_window: '3pm - 6pm',
        actual_date: order.scheduled_date,
        actual_window: order.time_window,
      },
    };
  }
}

/**
 * Main test suite
 */
async function runAllTests() {
  console.log(`${BOLD}${CYAN}╔═══════════════════════════════════════════════════════╗${RESET}`);
  console.log(`${BOLD}${CYAN}║   ACCOUNT TAB - RESCHEDULING TEST MATRIX             ║${RESET}`);
  console.log(`${BOLD}${CYAN}╚═══════════════════════════════════════════════════════╝${RESET}`);
  console.log(`\n${YELLOW}Backend:${RESET} ${BACKEND_URL}`);
  console.log(`${YELLOW}Test Session ID:${RESET} ${TEST_SESSION_ID}`);
  
  await runTest(1, 'Reschedule Pending order → becomes Scheduled', test1_reschedulePendingOrder);
  await runTest(2, 'Reschedule Scheduled order → date changes', test2_rescheduleScheduledOrder);
  await runTest(3, 'Invalid date input → blocked with error', test3_invalidDateInput);
  await runTest(4, 'Persistence test → date persists', test4_persistenceTest);
  
  // Summary
  const duration = Date.now() - results.startTime;
  console.log(`\n${BOLD}${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);
  console.log(`${BOLD}RESULTS:${RESET}`);
  console.log(`  ${GREEN}Passed: ${results.passed}/${results.total}${RESET}`);
  console.log(`  ${RED}Failed: ${results.failed}/${results.total}${RESET}`);
  console.log(`  ${YELLOW}Duration: ${duration}ms${RESET}`);
  console.log(`${BOLD}${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}\n`);
  
  if (results.failed === 0) {
    console.log(`${BOLD}${GREEN}✓ ALL TESTS PASSED${RESET}\n`);
    process.exit(0);
  } else {
    console.log(`${BOLD}${RED}✗ SOME TESTS FAILED${RESET}\n`);
    process.exit(1);
  }
}

// Run tests
runAllTests().catch((error) => {
  console.error(`${RED}Fatal error:${RESET}`, error);
  process.exit(1);
});

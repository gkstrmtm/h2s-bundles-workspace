/*
  Simulates the "book -> schedule later -> reschedule" flow against the local backend
  and verifies that key data is persisted in Supabase (orders + dispatch jobs).

  Usage (PowerShell):
    cd backend
    node scripts/simulate-fluidity.js

  Optional env:
    BASE_URL=http://localhost:3000
*/

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

function loadEnvFileIfPresent(envPath) {
  try {
    if (!fs.existsSync(envPath)) return;
    const raw = fs.readFileSync(envPath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch {
    // ignore
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function httpJson(url, options) {
  const resp = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options && options.headers ? options.headers : {}),
    },
  });

  const text = await resp.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON response from ${url} (status ${resp.status}): ${text.slice(0, 200)}`);
  }

  if (!resp.ok || json?.ok === false) {
    throw new Error(`HTTP ${resp.status} from ${url}: ${JSON.stringify(json)}`);
  }

  return json;
}

function futureDate(daysFromNow) {
  const d = new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

async function main() {
  // Ensure env vars are available for Supabase queries
  loadEnvFileIfPresent(path.join(__dirname, '..', '.env.local'));
  loadEnvFileIfPresent(path.join(__dirname, '..', '.env'));

  const baseUrl = process.env.BASE_URL || 'http://localhost:3000';

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  assert(supabaseUrl && supabaseKey, 'Missing SUPABASE_URL and/or SUPABASE_SERVICE_KEY. Ensure backend/.env.local exists.');

  const dispatchUrl = process.env.SUPABASE_URL_DISPATCH || supabaseUrl;
  const dispatchKey = process.env.SUPABASE_SERVICE_KEY_DISPATCH || supabaseKey;

  const sb = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const sbDispatch = createClient(dispatchUrl, dispatchKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const runId = `${Date.now()}`;
  const customerEmail = `test+fluidity_${runId}@example.com`;

  const cart = [
    {
      id: 'service_test_1',
      name: 'Test Booking Service',
      price: 99.99,
      qty: 1,
      metadata: { source: 'simulate-fluidity', run_id: runId },
    },
  ];

  const cartItemsForMetadata = [
    {
      name: 'Test Booking Service',
      qty: 1,
      price: 9999, // cents (bundles.html convention)
      metadata: { source: 'simulate-fluidity', run_id: runId },
    },
  ];

  const metadata = {
    _source: 'simulate-fluidity',
    service_address: '123 Test St',
    service_city: 'Austin',
    service_state: 'TX',
    service_zip: '78701',
    cart_items: JSON.stringify(cartItemsForMetadata),
  };

  let sessionId;
  console.log('1) Creating checkout session + immediate order row (server-side Stripe if configured)...');
  try {
    const checkout = await httpJson(`${baseUrl}/api/shop`, {
      method: 'POST',
      body: JSON.stringify({
        __action: 'create_checkout_session',
        customer: { email: customerEmail, name: 'Fluidity Test', phone: '555-0100' },
        cart,
        metadata,
        // keep URLs benign
        success_url: `${baseUrl}/bundles?view=shopsuccess&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/bundles`,
      }),
    });

    sessionId = checkout?.pay?.session_id;
    assert(sessionId, 'Expected pay.session_id from create_checkout_session');
    console.log(`   - session_id: ${sessionId}`);
  } catch (e) {
    const msg = String(e && e.message ? e.message : e);
    if (msg.toLowerCase().includes('stripe not configured')) {
      console.log('   - Server reported Stripe not configured; falling back to direct order insert...');
      sessionId = `cs_test_${runId}`;
      const orderId = `H2S_TEST_${runId}`;
      const computedSubtotal = 99.99;

      const { error: insertErr } = await sb
        .from('h2s_orders')
        .insert({
          order_id: orderId,
          session_id: sessionId,
          customer_email: customerEmail,
          customer_name: 'Fluidity Test',
          customer_phone: '555-0100',
          items: [
            {
              name: 'Test Booking Service',
              unit_price: 99.99,
              quantity: 1,
              line_total: 99.99,
              metadata: { source: 'simulate-fluidity', run_id: runId },
              line_type: 'service',
            },
          ],
          subtotal: computedSubtotal,
          total: computedSubtotal,
          status: 'pending',
          created_at: new Date().toISOString(),
          metadata_json: {
            ...metadata,
            cart_items_parsed: cartItemsForMetadata,
          },
        });

      if (insertErr) throw new Error(`Direct order insert failed: ${insertErr.message}`);
      console.log(`   - session_id: ${sessionId}`);
      console.log(`   - order_id: ${orderId}`);
    } else {
      throw e;
    }
  }

  console.log('2) Fetching orderpack (ensures API can read order)...');
  const orderpack = await httpJson(`${baseUrl}/api/shop?action=orderpack&session_id=${encodeURIComponent(sessionId)}`, {
    method: 'GET',
  });

  const order = orderpack.order;
  assert(order && (order.order_id || order.session_id), 'Expected order object from orderpack');

  console.log(`   - order_id: ${order.order_id || '(missing)'}`);

  console.log('3) Verifying Supabase order persistence (metadata_json + items)...');
  const { data: dbOrder, error: orderErr } = await sb
    .from('h2s_orders')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (orderErr) throw new Error(`Supabase order lookup failed: ${orderErr.message}`);
  assert(dbOrder, 'Order row not found in h2s_orders by session_id');

  const metaJson = dbOrder.metadata_json || {};
  assert(typeof metaJson === 'object', 'metadata_json missing or not an object');
  assert(String(metaJson.service_address || '').includes('123 Test'), 'metadata_json.service_address missing');
  assert(String(metaJson.service_city || '') === 'Austin', 'metadata_json.service_city missing');
  assert(String(metaJson.service_state || '') === 'TX', 'metadata_json.service_state missing');
  assert(String(metaJson.service_zip || '') === '78701', 'metadata_json.service_zip missing');

  // If the deployment has first-class address columns, they must be populated.
  if ('address' in dbOrder) assert(String(dbOrder.address || '').trim(), 'h2s_orders.address is empty');
  if ('city' in dbOrder) assert(String(dbOrder.city || '').trim(), 'h2s_orders.city is empty');
  if ('state' in dbOrder) assert(String(dbOrder.state || '').trim(), 'h2s_orders.state is empty');
  if ('zip' in dbOrder) assert(String(dbOrder.zip || '').trim(), 'h2s_orders.zip is empty');

  // Some deployments use service_* columns for first-class address.
  if ('service_state' in dbOrder) assert(String(dbOrder.service_state || '').trim(), 'h2s_orders.service_state is empty');

  const items = Array.isArray(dbOrder.items) ? dbOrder.items : [];
  const hasItemData = items.length > 0 || !!metaJson.cart_items;
  assert(hasItemData, 'Order items missing: neither items[] nor metadata_json.cart_items present');

  const canonicalOrderId = String(dbOrder.id);

  console.log(`   - canonical order uuid: ${canonicalOrderId}`);

  console.log('4) Scheduling appointment (schedule later -> scheduled)...');
  const date1 = futureDate(7);
  const time1 = '2:00 PM - 5:00 PM';
  const schedule = await httpJson(`${baseUrl}/api/schedule-appointment`, {
    method: 'POST',
    body: JSON.stringify({
      order_id: dbOrder.order_id || sessionId,
      delivery_date: date1,
      delivery_time: time1,
      timezone: 'America/Chicago',
    }),
  });
  assert(schedule.ok === true, 'Schedule endpoint did not return ok:true');

  console.log('5) Verifying DB updated delivery window...');
  const { data: scheduledOrder, error: scheduledErr } = await sb
    .from('h2s_orders')
    .select('*')
    .eq('id', canonicalOrderId)
    .single();

  if (scheduledErr) throw new Error(`Supabase scheduled order lookup failed: ${scheduledErr.message}`);
  assert(scheduledOrder.delivery_date === date1, `delivery_date not updated (expected ${date1}, got ${scheduledOrder.delivery_date})`);
  assert(String(scheduledOrder.delivery_time || '') === time1, `delivery_time not updated (expected ${time1}, got ${scheduledOrder.delivery_time})`);

  // Ensure address data is still present somewhere (schema may not have first-class columns)
  const scheduledMeta = scheduledOrder.metadata_json || {};
  const addrFromCols = String(scheduledOrder.service_address || scheduledOrder.address || '').trim();
  const addrFromMeta = String(scheduledMeta.service_address || scheduledMeta.address || '').trim();
  assert(addrFromCols || addrFromMeta, 'Address missing after scheduling (no first-class address column value and metadata_json has no address)');

  console.log('6) Verifying dispatch job exists...');
  const candidateKeys = Array.from(new Set([canonicalOrderId, dbOrder.order_id, sessionId].filter(Boolean)));
  let jobRow = null;
  for (const k of candidateKeys) {
    const { data } = await sbDispatch
      .from('h2s_dispatch_jobs')
      .select('*')
      .eq('order_id', k)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) {
      jobRow = data;
      break;
    }
  }
  assert(jobRow, 'No matching row in h2s_dispatch_jobs for order');

  console.log(`   - job_id: ${jobRow.job_id || jobRow.id || '(unknown)'} | status: ${jobRow.status || '(unknown)'}`);

  console.log('7) Rescheduling appointment (shop action reschedule_appointment)...');
  const date2 = futureDate(10);
  const time2 = '8:00 AM - 11:00 AM';

  const resched = await httpJson(`${baseUrl}/api/shop`, {
    method: 'POST',
    body: JSON.stringify({
      __action: 'reschedule_appointment',
      order_id: dbOrder.order_id || canonicalOrderId,
      delivery_date: date2,
      delivery_time: time2,
      reason: 'simulate-fluidity',
    }),
  });
  assert(resched.ok === true, 'Reschedule endpoint did not return ok:true');

  console.log('8) Verifying reschedule persisted (order + job)...');
  const { data: rescheduledOrder, error: rescheduledErr } = await sb
    .from('h2s_orders')
    .select('delivery_date, delivery_time')
    .eq('id', canonicalOrderId)
    .single();
  if (rescheduledErr) throw new Error(`Rescheduled order lookup failed: ${rescheduledErr.message}`);
  assert(rescheduledOrder.delivery_date === date2, `delivery_date not rescheduled (expected ${date2}, got ${rescheduledOrder.delivery_date})`);
  assert(String(rescheduledOrder.delivery_time || '') === time2, `delivery_time not rescheduled (expected ${time2}, got ${rescheduledOrder.delivery_time})`);

  let rescheduledJob = null;
  for (const k of candidateKeys) {
    const { data } = await sbDispatch
      .from('h2s_dispatch_jobs')
      .select('*')
      .eq('order_id', k)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) {
      rescheduledJob = data;
      break;
    }
  }

  if (rescheduledJob) {
    console.log(`   - job status after reschedule: ${rescheduledJob.status || '(unknown)'} | start_iso: ${rescheduledJob.start_iso || '(none)'}`);
  } else {
    console.log('   - job row not re-found after reschedule (non-fatal, but unexpected)');
  }

  console.log('\nPASS ✅  Booking fluidity simulation succeeded');
  console.log(`- session_id: ${sessionId}`);
  console.log(`- order_id: ${dbOrder.order_id}`);
  console.log(`- order_uuid: ${canonicalOrderId}`);
}

main().catch((err) => {
  console.error('\nFAIL ❌  Booking fluidity simulation failed');
  console.error(err && err.stack ? err.stack : String(err));
  process.exitCode = 1;
});

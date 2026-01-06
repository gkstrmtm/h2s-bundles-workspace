/*
  Smoke check for critical flows (dispatch insert + notifications + optional scheduling).

  Usage (PowerShell examples):
    node scripts/smoke-check-critical.js --backend https://h2s-backend.vercel.app

  Optional (to validate scheduling end-to-end):
    node scripts/smoke-check-critical.js --backend https://h2s-backend.vercel.app --order_id ORD-XXXX --date 2026-01-07 --time "12PM - 3PM"

  Notes:
  - Uses /api/test-job-insert to verify dispatch job insert is working (catches NOT NULL drift like sequence_id).
  - Uses /api/notify-management with dry_run to verify notification pipeline is reachable without sending SMS.
*/

function argMap(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) out[key] = true;
    else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

function requireString(name, value) {
  const v = String(value || '').trim();
  if (!v) throw new Error(`Missing --${name}`);
  return v;
}

function jsonBody(obj) {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(obj),
  };
}

async function fetchJson(url, init) {
  const res = await fetch(url, init);
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { _raw: text };
  }
  return { res, data };
}

async function main() {
  const args = argMap(process.argv.slice(2));
  const backend = requireString('backend', args.backend);

  const base = backend.replace(/\/$/, '');
  const startedAt = new Date().toISOString();

  console.log(`[smoke] started: ${startedAt}`);
  console.log(`[smoke] backend:  ${base}`);

  // 1) Dispatch insert health check
  {
    const url = `${base}/api/test-job-insert`;
    const { res, data } = await fetchJson(url);
    const insertTest = Array.isArray(data?.tests) ? data.tests.find((t) => t.test === 'insert_job') : null;

    if (!res.ok) {
      console.error('[smoke] FAIL test-job-insert http', res.status);
      console.error(data);
      process.exit(2);
    }

    if (!insertTest || insertTest.status !== 'PASS') {
      console.error('[smoke] FAIL dispatch insert');
      console.error(JSON.stringify(data, null, 2));
      process.exit(3);
    }

    console.log('[smoke] PASS dispatch insert');
  }

  // 2) Notify management dry_run
  {
    const url = `${base}/api/notify-management`;
    const idk = `smoke|notify|${new Date().toISOString().slice(0, 10)}`;
    const { res, data } = await fetchJson(
      url,
      jsonBody({
        dry_run: true,
        idempotency_key: idk,
        type: 'smokeTest',
        data: {
          service: 'Smoke test (dry run)',
          customerName: 'Smoke Test',
          orderNumber: 'SMOKE',
          amount: '0.00',
          city: 'N/A',
          state: 'N/A',
          phone: 'N/A',
        },
      })
    );

    if (!res.ok || data?.ok !== true || data?.dry_run !== true) {
      console.error('[smoke] FAIL notify-management dry_run');
      console.error(JSON.stringify({ status: res.status, data }, null, 2));
      process.exit(4);
    }

    console.log('[smoke] PASS notify-management dry_run');
  }

  // 3) Optional: scheduling endpoint check (requires a real order_id)
  if (args.order_id) {
    const order_id = requireString('order_id', args.order_id);
    const date = requireString('date', args.date);
    const time = requireString('time', args.time);
    const timezone = String(args.timezone || 'America/New_York');

    const url = `${base}/api/schedule-appointment`;
    const { res, data } = await fetchJson(
      url,
      jsonBody({
        order_id,
        delivery_date: date,
        delivery_time: time,
        timezone,
      })
    );

    if (!res.ok || data?.ok !== true) {
      console.error('[smoke] FAIL schedule-appointment');
      console.error(JSON.stringify({ status: res.status, data }, null, 2));
      process.exit(5);
    }

    if (data?.job_creation_warning) {
      console.error('[smoke] WARN schedule-appointment dispatch pending');
      console.error(JSON.stringify({ job_creation_warning: data.job_creation_warning, debug: data.debug }, null, 2));
      // treat as failure for smoke purposes: dispatch must be healthy
      process.exit(6);
    }

    console.log('[smoke] PASS schedule-appointment');
  } else {
    console.log('[smoke] SKIP schedule-appointment (no --order_id provided)');
  }

  console.log('[smoke] DONE OK');
}

main().catch((e) => {
  console.error('[smoke] ERROR', e?.message || e);
  process.exit(1);
});

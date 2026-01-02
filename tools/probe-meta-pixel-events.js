/*
  Probe script: fetch meta_pixel_events payload and show exactly what contributes to
  FunnelTrack "Total Conversion Value".

  Usage:
    node tools/probe-meta-pixel-events.js

  Options via env:
    API_HOST=https://h2s-backend.vercel.app
    EXCLUDE_TEST=1
    INCLUDE_INTERNAL=0
    DEBUG=1
*/

const apiHost = process.env.API_HOST || 'https://h2s-backend.vercel.app';
const excludeTest = String(process.env.EXCLUDE_TEST ?? '1');
const includeInternal = String(process.env.INCLUDE_INTERNAL ?? '0');
const debug = String(process.env.DEBUG ?? '1');

const url = new URL(`${apiHost}/api/v1`);
url.searchParams.set('action', 'meta_pixel_events');
url.searchParams.set('exclude_test', excludeTest);
url.searchParams.set('include_internal', includeInternal);
url.searchParams.set('debug', debug);

function money(n) {
  const v = Number(n || 0);
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

async function main() {
  console.log('Fetching:', url.toString());

  const res = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    console.error('Non-JSON response:', text.slice(0, 400));
    process.exit(2);
  }

  const payload = json.meta_pixel_events || json;
  const summary = payload.summary || {};

  console.log('\n--- Summary ---');
  console.log('total_events:', summary.total_events);
  console.log('unique_sessions:', summary.unique_sessions);
  console.log('unique_users:', summary.unique_users);
  console.log('total_revenue (used by UI):', money(summary.total_revenue));

  const purchase = summary.by_event_type?.purchase || summary.by_event_type?.Purchase;
  const purchaseCount = typeof purchase === 'object' ? purchase.count : purchase;
  const purchaseRevenue = typeof purchase === 'object' ? purchase.revenue : undefined;
  console.log('purchase count:', purchaseCount ?? 0);
  if (purchaseRevenue !== undefined) console.log('purchase revenue (by_event_type.purchase.revenue):', money(purchaseRevenue));

  if (payload.debug) {
    console.log('\n--- Debug ---');
    console.log('total_revenue_purchase_events:', money(payload.debug.total_revenue_purchase_events));
    console.log('total_revenue_all_events:', money(payload.debug.total_revenue_all_events));

    const top = Array.isArray(payload.debug.top_revenue_events) ? payload.debug.top_revenue_events : [];
    console.log(`top_revenue_events (${top.length} shown):`);
    for (const e of top.slice(0, 25)) {
      console.log(
        `- ${money(e.revenue_amount_normalized)} | purchase=${e.counted_as_purchase ? 'yes' : 'no'} | event_id=${e.event_id || ''} | ${e.event_type || e.event_name || 'unknown'} | ${e.page_path || ''} | order_id=${e.order_id || ''} | job_id=${e.job_id || ''} | email=${e.customer_email || ''} | ${e.occurred_at || ''}`
      );
    }
  } else {
    console.log('\nNo debug payload returned (debug=1 disabled server-side?)');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

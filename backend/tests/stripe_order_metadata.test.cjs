const test = require('node:test');
const assert = require('node:assert/strict');
const { createOperationsFixture, evaluate, id } = require('./helpers/commercial_operations_fixture.cjs');
const review = require('../lib/stripe_order_metadata_review.cjs');
const actor = { id:id(9),name:'Fixture Admin' };

async function fixture(t) {
  const f = await createOperationsFixture();
  t.after(() => f.db.close());
  const notices = [];
  const event = { type:'checkout.session.completed',data:{object:{
    id:'cs_fixture',payment_intent:'pi_fixture',payment_status:'paid',amount_total:120000,
    customer_details:{name:'Checkout Customer',phone:'+15550000005',address:{line1:'100 Checkout Lane',city:'Fixture City',state:'NC',postal_code:'00000'}},
    metadata:{cart_items:'[]',scheduled_date:'2000-01-01',scheduled_end:'2000-01-02',
      scheduled_tz:'UTC',time_window:'obsolete',schedule_status:'Pending',scheduled_at:'2000-01-01',scheduled_via:'checkout',
      job_details_json:'{"service":"Fixture checkout"}'},
  } } };
  const webhook = evaluate('app\\api\\stripe-webhook\\route.ts',{
    'next/server':{NextResponse:{json:(value,options)=>Response.json(value,options)}},
    stripe:class { constructor(){return {webhooks:{constructEvent:()=>event}};} },
    '@supabase/supabase-js':{createClient:()=>f.client},
    crypto:require('node:crypto'),
    '../../../lib/supabase':{getSupabase:()=>f.client,getSupabaseDispatch:()=>f.client},
  },{fetch:async (url,options)=>{
    assert.match(url,/\/api\/notify-management$/);
    notices.push(JSON.parse(options.body));
    return Response.json({ok:true});
  }});
  const invoke = () => webhook.POST(new Request('http://fixture.invalid/api/stripe-webhook',{
    method:'POST',headers:{'stripe-signature':'fixture-only'},body:'fixture-only',
  }));
  return { ...f,invoke,event,notices };
}

test('a Commercial Queue schedule committed between webhook metadata read and update survives stale checkout metadata', async t => {
  const f = await fixture(t);
  await f.db.query('select commercial_record_operation($1,0,$2,$3::jsonb,$4,$5::jsonb)',
    [id(1),id(700),JSON.stringify(actor),'link',JSON.stringify({orderId:id(100),jobId:id(101)})]);
  const events = [];
  let saved;
  f.faults.afterOrderRead = async snapshot => {
    if (snapshot?.order_id !== 'ORD-FIXTURE') return;
    delete f.faults.afterOrderRead;
    assert.equal(snapshot.metadata_json.scheduled_date,undefined);
    events.push('webhook read old metadata');
    const before = await (await f.request('GET')).json();
    const response = await f.request('POST',{
      leadId:id(1),action:'schedule',revision:1,operationId:id(701),
      payload:{start:'2099-02-01T15:00:00Z',end:'2099-02-01T17:00:00Z',timezone:'America/New_York',
        expectedJobUpdatedAt:before.installation.job.updated_at,
        expectedOrderUpdatedAt:before.installation.order.updated_at},
    });
    assert.equal(response.status,200,JSON.stringify(await response.clone().json()));
    saved = (await response.json()).installation.order;
    events.push('ADMIN schedule saved successfully');
  };
  assert.equal((await f.invoke()).status,200);
  events.push('webhook update completed');
  assert.deepEqual(events,['webhook read old metadata','ADMIN schedule saved successfully','webhook update completed']);
  const after = (await f.db.query('select * from h2s_orders where id=$1',[id(100)])).rows[0];
  for (const key of ['scheduled_date','scheduled_end','scheduled_tz','time_window','schedule_status','scheduled_at','scheduled_via']) {
    assert.equal(after.metadata_json[key],saved.metadata_json[key],key);
  }
  assert.equal(after.delivery_date.toISOString().slice(0,10),saved.delivery_date);
  assert.equal(after.delivery_time,saved.delivery_time);
  assert.equal(after.status,'paid');
  assert.equal(after.address,'100 Checkout Lane');
  assert.equal(after.metadata_json.tech_payout_dollars,420);
  assert.deepEqual(after.metadata_json.job_details,{service:'Fixture checkout'});
  assert.equal(after.metadata_json.job_details_json,undefined);
  assert.equal((await f.db.query('select count(*)::int n from commercial_lead_activity')).rows[0].n,2);
  assert.equal((await f.db.query('select count(*)::int n from h2s_dispatch_jobs')).rows[0].n,2);
  assert.equal(f.notices.length,1);
});

test('atomic metadata-only linking retains schedule/nulls and payment/contact fields; checkout still initializes absent keys', async t => {
  const f = await fixture(t);
  await f.db.query("update h2s_orders set metadata_json=metadata_json||'{\"scheduled_date\":null,\"time_window\":\"saved\",\"job_details_json\":\"old\"}'::jsonb where id=$1",[id(100)]);
  assert.equal((await f.invoke()).status,200);
  let order = (await f.db.query('select * from h2s_orders where id=$1',[id(100)])).rows[0];
  assert.equal(order.metadata_json.scheduled_date,null);
  assert.equal(order.metadata_json.time_window,'saved');
  assert.equal(order.metadata_json.scheduled_end,'2000-01-02');
  assert.equal(order.metadata_json.job_details_json,undefined);
  const before = structuredClone(order);
  const patch = await f.client.rpc('stripe_patch_order',{p_order_id:'ORD-FIXTURE',
    p_metadata:{dispatch_job_id:'fixture-job',dispatch_recipient_id:'fixture-recipient',time_window:'stale'}});
  assert.equal(patch.error,null);
  order = (await f.db.query('select * from h2s_orders where id=$1',[id(100)])).rows[0];
  assert.equal(order.metadata_json.time_window,'saved');
  assert.equal(order.metadata_json.scheduled_date,null);
  assert.equal(order.metadata_json.dispatch_job_id,'fixture-job');
  for (const key of ['status','payment_intent_id','address','city','state','zip','customer_name','customer_phone']) assert.equal(order[key],before[key]);
});

test('atomic patch failure is not acknowledged or followed by notifications; retry succeeds', async t => {
  const f = await fixture(t);
  const before = (await f.db.query('select to_jsonb(o) row from h2s_orders o where id=$1',[id(100)])).rows[0].row;
  f.faults.stripePatch = true;
  assert.equal((await f.invoke()).status,500);
  assert.equal(f.notices.length,0);
  assert.deepEqual((await f.db.query('select to_jsonb(o) row from h2s_orders o where id=$1',[id(100)])).rows[0].row,before);
  f.faults.stripePatch = false;
  assert.equal((await f.invoke()).status,200);
  assert.equal(f.notices.length,1);
});

test('033 enforces service-only execution, validates payloads and detects function/permission drift', async t => {
  const f = await fixture(t);
  assert.equal((await review.inspect(f.db,true)).atomicRpcVerified,true);
  for (const role of ['anon','authenticated']) {
    await f.db.exec(`set role ${role}`);
    await assert.rejects(f.db.query("select stripe_patch_order('ORD-FIXTURE','{}')"),/permission denied/);
    await f.db.exec('reset role');
  }
  await f.db.exec('grant select,update on h2s_orders to service_role; set role service_role');
  assert.ok((await f.db.query("select stripe_patch_order('ORD-FIXTURE','{}') result")).rows[0].result);
  await assert.rejects(f.db.query("select stripe_patch_order('ORD-FIXTURE','[]')"),/Invalid/);
  await assert.rejects(f.db.query("select stripe_patch_order('ORD-FIXTURE','{}','{\"total\":0}')"),/Unsupported/);
  await assert.rejects(f.db.query("select stripe_patch_order('missing','{}')"),/not found/);
  await f.db.exec('reset role; grant execute on function stripe_patch_order(text,jsonb,jsonb) to anon');
  await assert.rejects(review.inspect(f.db,true),/differs/);
  await f.db.exec('revoke execute on function stripe_patch_order(text,jsonb,jsonb) from anon; alter function stripe_patch_order(text,jsonb,jsonb) security definer');
  await assert.rejects(review.inspect(f.db,true),/differs/);
});

const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {createCommerceFixture,id}=require('./helpers/field_commerce_fixture.cjs');
const {evaluate}=require('./helpers/commercial_operations_fixture.cjs');
test('private-run Checkout and payment-intent metadata are cleanup-addressable without changing receipt verification',async t=>{
  const f=await createCommerceFixture();t.after(()=>f.db.close());await f.enable();await f.publish();await f.legal();
  f.env.H2S_STAGING_SANDBOX_RUN_ID='c6316381-64f5-4b67-b41f-41711416cdcc';
  const leadId=await f.lead(),accepted=await f.accepted(leadId);
  const result=await f.post({action:'checkout',leadId,quoteId:accepted.quoteId,kind:'full'});
  assert.equal(result.status,200);
  const session=[...f.sessions.values()][0];
  assert.equal(session.metadata.h2s_staging_run,f.env.H2S_STAGING_SANDBOX_RUN_ID);
  const paid=f.paid(session.id);
  assert.equal(paid.intent.metadata.h2s_staging_run,f.env.H2S_STAGING_SANDBOX_RUN_ID);
  assert.equal((await f.webhook('checkout.session.completed',paid.session)).status,200);
});
test('canonical Stripe failures, expired retry, expanded intent identity, wrong amounts and sticky dispute review',async t=>{
  const f=await createCommerceFixture();t.after(()=>f.db.close());await f.enable();await f.publish();await f.legal();
  const leadId=await f.lead(),accepted=await f.accepted(leadId),quoteId=accepted.quoteId;
  const link=await(await f.post({action:'agreement_link',leadId,quoteId})).json();
  assert.equal(new URLSearchParams(new URL(link.agreementUrl).hash.slice(1)).get('token'),accepted.token);
  const first=await(await f.post({action:'checkout',leadId,quoteId,kind:'full'})).json(),session=[...f.sessions.values()][0];
  const pid='pi_fixture_failed';session.payment_intent=pid;
  f.intents.set(pid,{id:pid,livemode:false,amount:session.amount_total,currency:'usd',status:'requires_payment_method',metadata:session.metadata});
  assert.equal((await f.webhook('payment_intent.payment_failed',f.intents.get(pid))).status,200);
  assert.equal((await f.db.query('select state from field_sales_checkouts where checkout_id=$1',[first.checkoutId])).rows[0].state,'failed');
  f.intents.get(pid).status='canceled';
  assert.equal((await f.webhook('payment_intent.canceled',f.intents.get(pid))).status,200);
  assert.equal((await f.db.query('select provider_state from field_sales_checkouts where checkout_id=$1',[first.checkoutId])).rows[0].provider_state,'canceled');
  assert.equal((await f.db.query("select receipt->>'sourceEventType' kind from field_sales_payment_events where receipt->>'sourceEventType'='payment_intent.canceled'")).rows[0].kind,'payment_intent.canceled');
  session.status='expired';
  assert.equal((await f.webhook('checkout.session.expired',session)).status,200);
  assert.equal((await f.db.query('select state from field_sales_checkouts where checkout_id=$1',[first.checkoutId])).rows[0].state,'expired');
  const second=await(await f.post({action:'checkout',leadId,quoteId,kind:'full'})).json();assert.notEqual(first.checkoutId,second.checkoutId);
  const sid=[...f.sessions.keys()][1],paid=f.paid(sid),original=paid.session.amount_total;
  paid.session.amount_total=original+1;assert.equal((await f.webhook('checkout.session.completed',paid.session)).status,409);
  assert.equal((await f.db.query('select count(*)::int n from field_sales_orders')).rows[0].n,0);paid.session.amount_total=original;
  paid.charge.payment_intent={id:paid.intent.id};paid.intent.latest_charge=paid.charge;
  assert.equal((await f.webhook('checkout.session.completed',paid.session)).status,200);
  paid.charge.disputed=true;
  assert.equal((await f.webhook('charge.dispute.created',{id:'dp_fixture',payment_intent:paid.intent.id})).status,200);
  paid.charge.disputed=false;
  assert.equal((await f.webhook('charge.dispute.closed',{id:'dp_fixture',payment_intent:paid.intent.id})).status,200);
  assert.equal((await f.db.query('select state from field_sales_checkouts where checkout_id=$1',[second.checkoutId])).rows[0].state,'payment_exception');
  assert.equal((await f.db.query('select count(*)::int n from field_sales_orders')).rows[0].n,1);
});
test('legacy Stripe handler isolates tagged field-sales events before any database/fulfillment initialization',async()=>{
  let initialized=0;const event={type:'fixture.unhandled',data:{object:{metadata:{h2s_flow:'field_sales_v1'}}}};
  const route=evaluate('app\\api\\stripe-webhook\\route.ts',{
    'next/server':{NextResponse:{json:(body,options)=>Response.json(body,options)}},
    stripe:class{constructor(){return {webhooks:{constructEvent:()=>event}};}},
    '@supabase/supabase-js':{createClient:()=>{initialized++;return {};}},
    crypto:require('node:crypto'),'../../../lib/supabase':{},
    '@/lib/fieldStripeRouting':evaluate('lib\\fieldStripeRouting.ts',{})
  });
  const invoke=()=>route.POST(new Request('https://fixture.invalid',{method:'POST',headers:{'stripe-signature':'fixture'},body:'fixture'}));
  assert.equal((await(await invoke()).json()).routed,'field-sales-stripe-webhook');assert.equal(initialized,0);
  event.data.object.metadata={};assert.equal((await invoke()).status,200);assert.equal(initialized,1);
});
test('draft preparation preserves every v2 tier, all configurable storefront services, and no publication authority',()=>{
  const {prepare}=require('../tools/prepare_field_sales_catalog.cjs'),v2=require('../../config/pricing/home2smart.v2.json');
  const original=JSON.stringify(v2),serviceIds=['tvmount','cams','doorbell','mesh','lock','thermostat','lights','security-light-bundle','starter-smart-home','care-plus','remote-care','consult','wifi','stream-setup','app-unification','scenes','guest-network','cams-add-on'];
  const prepared=prepare(v2,{ok:true,services:serviceIds.map(id=>({id,name:id})),bundles:[{id:'cam_basic',name:'2 cameras plus doorbell',price:599}]},'2026-11-03');
  const engine=evaluate('lib\\fieldQuote.ts',{'@/lib/commercial_business':{BusinessError:class extends Error{}}});
  for(const catalog of prepared.catalogs){engine.validateQuoteCatalog(catalog);assert.equal(catalog.status,'draft');assert.equal(catalog.definition.validForMinutes,null);assert.equal(catalog.source_evidence.approvalEvidence,null);}
  assert.equal(prepared.catalogs[0].definition.services.flatMap(s=>s.offers).length,Object.values(v2.prices).flatMap(groups=>Object.values(groups).flat()).length);
  assert.equal(prepared.catalogs[1].definition.services.length,19);
  assert.ok(prepared.catalogs[0].definition.services.flatMap(s=>s.offers).some(o=>o.unitCents===59900&&o.equipment.includes('eufy_solocam_s220')));
  const tv=prepared.catalogs[0].definition.services.find(s=>s.id.includes('with_standard_fixed_mount')),o=tv.offers[0];
  const line={serviceId:tv.id,offerId:o.id,quantity:1,answers:{survey:'Synthetic scope',size:30},options:[o.options[0].id]};
  const result=engine.calculateFieldQuote(prepared.catalogs[0],[line],'residential');
  assert.equal(result.pricingStatus,'unpublished_not_payable');assert.equal(result.lines[0].equipment.includes(v2.costPolicy.tvMountEquipmentId),false);
  assert.throws(()=>engine.calculateFieldQuote(prepared.catalogs[0],[{...line,options:o.options.map(o=>o.id)}],'residential'),/competing/);
  assert.equal(JSON.stringify(v2),original);
});
const get=(f,leadId,actor='a')=>f.request('field-sales-transactions','GET',null,actor,leadId?'?leadId='+leadId:'');
test('default-off transaction gates, scoped ownership, roles and pricing publication authority',async t=>{
  const f=await createCommerceFixture();t.after(()=>f.db.close());
  f.env.H2S_FIELD_TRANSACTIONS_ENABLED='false';
  assert.equal((await(await get(f,null,'admin')).json()).enabled,false);
  assert.equal((await f.post({action:'quote',leadId:id(1)},'admin')).status,503);
  f.env.H2S_FIELD_TRANSACTIONS_ENABLED='true';await f.enable();const lead=await f.lead();
  assert.equal((await get(f,lead,'va')).status,403);assert.equal((await get(f,lead,'b')).status,404);
  const draft=await f.quote(lead),submitted=await f.submit(lead,draft);
  let data=await(await get(f,lead)).json();assert.equal(data.quotes[0].state,'pending_approval');
  assert.equal((await f.post({action:'approve',leadId:lead,quoteId:submitted,reason:'Synthetic approval',scopeConfirmation:'Synthetic scope',amountCents:59900},'admin')).status,400);
  assert.equal((await f.post({action:'approve',leadId:lead,quoteId:submitted,reason:'Synthetic approval',scopeConfirmation:'Synthetic scope'},'a')).status,403);
  await f.publish();assert.equal((await f.post({action:'submit',leadId:lead,quoteId:submitted})).status,409);
  const approved=await f.submit(lead,await f.quote(lead));
  data=await(await get(f,lead)).json();assert.equal(data.quotes.find(q=>q.quote_id===approved).state,'approved');
  await assert.rejects(f.db.exec(`update field_sales_catalogs set definition=jsonb_set(definition,'{validForMinutes}','181')`),/immutable/);
  assert.equal((await f.db.query("select has_function_privilege('authenticated','field_sales_transaction_command(uuid,uuid,uuid,text,jsonb)','EXECUTE') allowed")).rows[0].allowed,false);
  assert.equal((await f.db.query("select has_table_privilege('anon','field_sales_quotes','SELECT') allowed")).rows[0].allowed,false);
});
test('integer quote accuracy, itemization, quantities, equipment, future services and request tampering',async t=>{
  const f=await createCommerceFixture();t.after(()=>f.db.close());await f.enable();await f.publish();const lead=await f.lead();
  const lines=f.lines();lines[0].quantity=2;lines[0].options=['equipment_upgrade'];
  const operationId=crypto.randomUUID(),payload={action:'quote',operationId,leadId:lead,catalogId:f.catalogId,lines};
  assert.equal((await f.post(payload)).status,200);assert.equal((await f.post(payload)).status,200);
  const data=await(await get(f,lead)).json();assert.equal(data.quotes.length,1);
  const q=data.quotes[0];assert.equal(q.snapshot.totalCents,25000);assert.equal(q.snapshot.lines[0].addOns[0].amountCents,5000);
  assert.equal(q.snapshot.customer.address,'100 Fixture Lane');assert.match(q.quote_hash,/^[a-f0-9]{64}$/);
  for(const changed of [{...payload,totalCents:1},{...payload,lines:[{...lines[0],unitCents:1}]},
    {...payload,lines:[{...lines[0],quantity:1.5}]},{...payload,lines:[{...lines[0],options:['unapproved']}]}]){
    assert.equal((await f.post({...changed,operationId:crypto.randomUUID()})).status,400);
  }
  assert.equal((await f.post({...payload,lines:f.lines()})).status,409);
  const future=await f.quote(lead,[{serviceId:'future_service',offerId:'standard',quantity:1,answers:{size:50,wall:'drywall'},options:[]}]);
  const pending=await f.submit(lead,future);assert.equal((await(await get(f,lead)).json()).quotes.find(q=>q.quote_id===pending).state,'pending_approval');
});
test('management exceptions are new immutable revisions; pricing drift and stale assessments cannot alter agreements',async t=>{
  const f=await createCommerceFixture();t.after(()=>f.db.close());await f.enable();await f.publish();await f.legal();const lead=await f.lead();
  const lines=f.lines();lines[0].answers.wall='masonry';
  const pending=await f.submit(lead,await f.quote(lead,lines));
  const approved=await(await f.post({action:'approve',leadId:lead,quoteId:pending,reason:'Synthetic reviewed exception',
    scopeConfirmation:'Synthetic masonry scope expressly reviewed',amountCents:15000},'admin')).json();assert.equal(approved.ok,true,approved.error);
  const data=await(await get(f,lead)).json(),q=data.quotes.find(q=>q.quote_id===approved.id);
  assert.equal(q.snapshot.totalCents,15000);assert.equal(q.snapshot.managementAdjustmentCents,5000);assert.equal(q.parent_quote_id,pending);
  assert.equal((await f.post({action:'submit',leadId:lead,quoteId:q.quote_id})).status,409);
  await assert.rejects(f.db.query('update field_sales_quotes set snapshot=$1 where quote_id=$2',['{}',q.quote_id]),/Immutable/);
  assert.equal(data.quotes.find(q=>q.quote_id===pending).snapshot.totalCents,10000);
  await f.db.query('update field_sales_opportunities set revision=revision+1 where lead_id=$1',[lead]);
  assert.equal((await f.post({action:'agreement',leadId:lead,quoteId:q.quote_id})).status,409);
  const other=await f.lead(),review=await f.submit(other,await f.quote(other,lines));
  const rejected=await(await f.post({action:'reject',leadId:other,quoteId:review,reason:'Synthetic scope not approved'},'admin')).json();
  assert.equal(rejected.ok,true,rejected.error);
  assert.equal((await f.post({action:'submit',leadId:other,quoteId:rejected.id})).status,409);
});
test('agreement gates, exact quote hash, explicit customer acceptance, token replay and immutable evidence',async t=>{
  const f=await createCommerceFixture();t.after(()=>f.db.close());await f.enable();await f.publish();const lead=await f.lead();
  const quoteId=await f.submit(lead,await f.quote(lead));
  assert.equal((await f.post({action:'agreement',leadId:lead,quoteId})).status,503);
  await f.legal();
  const prepared=await(await f.post({action:'agreement',leadId:lead,quoteId})).json();assert.equal(prepared.ok,true,prepared.error);
  const token=new URLSearchParams(new URL(prepared.agreementUrl).hash.slice(1)).get('token');
  let facts=await(await f.request('field-sales-agreement','GET',null,token)).json();
  assert.equal(facts.agreement.token_hash,undefined);assert.equal(facts.quote.created_by,undefined);
  const accept={operationId:crypto.randomUUID(),name:'Synthetic customer',email:'synthetic@example.invalid',accepted:true,electronicDelivery:true,
    quoteHash:facts.quote.quote_hash,policyVersion:facts.agreement.policy_snapshot.version};
  assert.equal((await f.request('field-sales-agreement','POST',{...accept,quoteHash:'0'.repeat(64)},token)).status,400);
  assert.equal((await f.request('field-sales-agreement','POST',{...accept,electronicDelivery:false},token)).status,400);
  assert.equal((await f.request('field-sales-agreement','POST',accept,token)).status,200);
  assert.equal((await f.request('field-sales-agreement','POST',accept,token)).status,200);
  assert.equal((await f.request('field-sales-agreement','POST',{...accept,name:'Different evidence'},token)).status,409);
  await assert.rejects(f.db.exec("update field_sales_agreements set acceptance='{}'"),/immutable/);
  f.env.H2S_FIELD_CUSTOMER_AGREEMENTS_ENABLED='false';assert.equal((await f.request('field-sales-agreement','GET',null,token)).status,503);
  assert.equal((await f.post({action:'quote',leadId:lead,catalogId:f.catalogId,lines:f.lines()})).status,409);
});
test('Stripe reservation idempotency, live-key refusal, amount tampering and no redirect-based orders',async t=>{
  const f=await createCommerceFixture();t.after(()=>f.db.close());await f.enable();await f.publish();await f.legal();const lead=await f.lead(),a=await f.accepted(lead);
  f.env.H2S_FIELD_STRIPE_TEST_SECRET_KEY='sk_live_synthetic_rejection_fixture';
  assert.equal((await f.post({action:'checkout',leadId:lead,quoteId:a.quoteId,kind:'full'})).status,503);assert.equal(f.keys.size,0);
  f.env.H2S_FIELD_STRIPE_TEST_SECRET_KEY='sk_test_synthetic_fixture_only';
  const payload={action:'checkout',leadId:lead,quoteId:a.quoteId,kind:'full'};
  assert.equal((await f.post({...payload,amountCents:1})).status,400);
  const responses=await Promise.all([f.post(payload),f.post(payload),f.post(payload)]);
  assert.ok(responses.every(r=>r.status===200));assert.equal(f.keys.size,1);
  const checkout=await responses[0].json();assert.equal(checkout.summary.netCollectedCents,0);assert.equal(checkout.orderId,null);
  assert.equal(f.stripeCalls.find(call=>call.method==='create').params.line_items[0].price_data.unit_amount,10000);
  assert.equal((await f.db.query('select count(*)::int n from field_sales_orders')).rows[0].n,0);
  const session=[...f.sessions.values()][0];session.amount_total=1;
  assert.equal((await f.post({action:'refresh_payment',leadId:lead,checkoutId:checkout.checkoutId})).status,409);
});
test('real SDK webhook signatures, verified capture, retries, refunds, order reconciliation and no fulfillment side effects',async t=>{
  const f=await createCommerceFixture();t.after(()=>f.db.close());await f.enable();await f.publish();await f.legal();const lead=await f.lead(),a=await f.accepted(lead);
  const original=(await f.db.query('select (select count(*) from h2s_dispatch_jobs)::int jobs,(select count(*) from h2s_payouts_ledger)::int payouts')).rows[0];
  const checkout=await(await f.post({action:'checkout',leadId:lead,quoteId:a.quoteId,kind:'full'})).json();
  const paid=f.paid([...f.sessions.keys()][0]),event='evt_fixture_capture_once';
  assert.equal((await f.webhook('checkout.session.completed',paid.session,event)).status,200);
  assert.equal((await f.webhook('checkout.session.completed',paid.session,event)).status,200);
  let data=await(await get(f,lead)).json();assert.equal(data.orders.length,1);assert.equal(data.orders[0].payment.paymentStatus,'paid');
  assert.equal(data.orders[0].payment.remainingCents,0);assert.equal(data.orders[0].status,'field_sales_management_review');
  assert.equal((await f.post({action:'checkout',leadId:lead,quoteId:a.quoteId,kind:'full'})).status,409);
  paid.charge.amount_refunded=3000;
  assert.equal((await f.webhook('charge.refunded',paid.charge)).status,200);
  data=await(await get(f,lead)).json();assert.equal(data.orders[0].payment.netCollectedCents,7000);assert.equal(data.orders[0].payment.remainingCents,3000);
  assert.equal(data.orders[0].payment.paymentStatus,'partially_refunded');
  assert.equal((await f.post({action:'checkout',leadId:lead,quoteId:a.quoteId,kind:'balance'})).status,409);
  paid.charge.amount_refunded=10000;
  assert.equal((await f.webhook('charge.refunded',paid.charge)).status,200);
  assert.equal((await(await get(f,lead)).json()).orders[0].payment.paymentStatus,'refunded');
  assert.deepEqual((await f.db.query('select (select count(*) from h2s_dispatch_jobs)::int jobs,(select count(*) from h2s_payouts_ledger)::int payouts')).rows[0],original);
  assert.equal((await f.db.query('select order_id from commercial_lead_operations where lead_id=$1',[lead])).rows[0].order_id,null,'Do not violate existing order/job pair contract');
  assert.equal((await f.webhook('checkout.session.completed',paid.session,'evt_live',{livemode:true})).status,400);
  assert.equal((await f.routes['field-sales-stripe-webhook'].POST(new Request('https://fixture.invalid',{method:'POST',headers:{'stripe-signature':'invalid'},body:'{}'}))).status,400);
});
test('deposit policy remains unset; approved synthetic deposit/balance payments reconcile to one full-value order',async t=>{
  const f=await createCommerceFixture();t.after(()=>f.db.close());await f.enable();await f.publish();await f.legal();const priorLead=await f.lead(),prior=await f.accepted(priorLead);
  assert.equal((await f.post({action:'checkout',leadId:priorLead,quoteId:prior.quoteId,kind:'deposit'})).status,503);assert.equal(f.keys.size,0);
  await f.db.query('update field_sales_transaction_settings set deposit_policy=$1',[JSON.stringify({mode:'fixed',amountCents:4000,agreementPolicyId:id(811),approvedBy:id(9),approvedAt:new Date().toISOString(),approvalEvidence:'Synthetic isolated deposit policy only'})]);
  assert.equal((await f.post({action:'checkout',leadId:priorLead,quoteId:prior.quoteId,kind:'deposit'})).status,503,'New policy must not rewrite a previously accepted agreement');
  const lead=await f.lead(),a=await f.accepted(lead);
  const acceptedFacts=await(await f.request('field-sales-agreement','GET',null,a.token)).json();
  assert.equal(acceptedFacts.agreement.policy_snapshot.paymentPlan.depositCents,4000);
  await f.db.exec('update field_sales_transaction_settings set deposit_policy=null');
  assert.equal((await f.post({action:'checkout',leadId:lead,quoteId:a.quoteId,kind:'deposit'})).status,200);
  let paid=f.paid([...f.sessions.keys()][0]);assert.equal((await f.webhook('checkout.session.completed',paid.session)).status,200);
  let data=await(await get(f,lead)).json();assert.equal(data.orders[0].payment.remainingCents,6000);assert.equal(data.orders[0].payment.paymentStatus,'deposit_collected');
  assert.equal(Number(data.orders[0].total),100);
  const response=await f.post({action:'checkout',leadId:lead,quoteId:a.quoteId,kind:'balance'});assert.equal(response.status,200,await response.clone().text());
  paid=f.paid([...f.sessions.keys()][1]);assert.equal(paid.session.amount_total,6000);assert.equal((await f.webhook('checkout.session.completed',paid.session)).status,200);
  data=await(await get(f,lead)).json();assert.equal(data.orders.length,1);assert.equal(data.orders[0].payment.netCollectedCents,10000);
});
test('failed/pending/expired sessions create no order; database failure preserves retryable verified payment',async t=>{
  const f=await createCommerceFixture();t.after(()=>f.db.close());await f.enable();await f.publish();await f.legal();const lead=await f.lead(),a=await f.accepted(lead);
  await f.post({action:'checkout',leadId:lead,quoteId:a.quoteId,kind:'full'});
  const first=[...f.sessions.values()][0];first.status='complete';
  assert.equal((await f.webhook('checkout.session.completed',first)).status,200);
  assert.equal((await f.db.query('select count(*)::int n from field_sales_orders')).rows[0].n,0);
  first.status='expired';assert.equal((await f.webhook('checkout.session.expired',first)).status,200);
  assert.equal((await f.post({action:'checkout',leadId:lead,quoteId:a.quoteId,kind:'full'})).status,200);
  const paid=f.paid([...f.sessions.keys()][1]);
  await f.db.exec("create function commerce_test_order_fault() returns trigger language plpgsql as $$begin raise exception 'Synthetic order failure';end$$;create trigger commerce_test_order_fault before insert on h2s_orders for each row execute function commerce_test_order_fault()");
  const event='evt_fixture_retry_after_order_failure';
  assert.equal((await f.webhook('checkout.session.completed',paid.session,event)).status,503);
  assert.equal((await f.db.query('select count(*)::int n from field_sales_payment_events where event_id=$1',['stripe:'+event])).rows[0].n,0);
  await f.db.exec('drop trigger commerce_test_order_fault on h2s_orders');
  assert.equal((await f.webhook('checkout.session.completed',paid.session,event)).status,200);
  assert.equal((await f.db.query('select count(*)::int n from field_sales_orders')).rows[0].n,1);
});

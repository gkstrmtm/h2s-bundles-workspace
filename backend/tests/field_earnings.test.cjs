const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {createEarningsFixture,attachEarningsRoutes,id}=require('./helpers/field_earnings_fixture.cjs');
test('workflow fixture registry executes the actual earnings route without dropping workflow or proof routes',async t=>{
  const {createWorkflowFixture}=require('./helpers/field_workflow_fixture.cjs');
  const f=await createWorkflowFixture();t.after(()=>f.db.close());await f.enable();
  attachEarningsRoutes(f);
  assert.ok(f.routes['field-sales-earnings'].GET);assert.ok(f.routes['field-sales-workflow'].GET);
  assert.ok(f.routes.portal_upload_artifact.POST);assert.ok(f.routes.portal_upload_signature.POST);
  const own=await f.request('field-sales-earnings','GET',null,'a');assert.equal(own.status,200);
  const result=await own.json();assert.equal(result.ok,true);assert.equal(result.externalPaymentInitiated,false);
  assert.equal((await f.request('field-sales-earnings','GET',null,'missing')).status,401);
  assert.equal((await f.request('field-sales-earnings','GET',null,'va')).status,403);
  assert.equal((await f.request('field-sales-earnings','GET',null,'a','?representativeId='+id(21))).status,403);
  assert.equal((await f.request('field-sales-workflow','GET',null,'admin')).status,200);
  assert.ok((await f.request('field-sales-agreement','GET',null,'missing')).status>=400);
});
test('actual 045/046/047 economics, immutable attribution and separate technician ledger',async t=>{
  const f=await createEarningsFixture();t.after(()=>f.db.close());const o=await f.order({expenses:[
    {category:'equipment',quantity:1,unitCents:2000,amountCents:2000,actual:true,evidence:{reference:'PRIVATE-SYNTHETIC-INVOICE',address:'PRIVATE-SYNTHETIC-ADDRESS',phone:'PRIVATE-SYNTHETIC-PHONE'}},
    {category:'materials',quantity:1,unitCents:500,amountCents:500,actual:true,evidence:{reference:'synthetic actual material receipt'}}]});
  const entry=(await f.db.query('select * from field_sales_earning_entries where quote_id=$1',[o.quoteId])).rows[0];
  assert.equal(Number(entry.basis_cents),7200);assert.equal(Number(entry.amount_cents),3960);
  assert.equal(entry.representative_id,id(20));assert.equal(entry.tenure_day,11);
  const before=JSON.stringify(entry);
  const retry=await f.command({action:'review_order',quoteId:o.quoteId});assert.equal(retry.result.entryId,entry.entry_id);
  await f.db.query('update field_sales_opportunities set owner_user_id=$2 where lead_id=$1',[o.leadId,id(21)]);
  assert.equal(JSON.stringify((await f.db.query('select * from field_sales_earning_entries where entry_id=$1',[entry.entry_id])).rows[0]),before);
  await assert.rejects(f.db.query('update field_sales_earning_entries set amount_cents=1 where entry_id=$1',[entry.entry_id]),/append-only/);
  await assert.rejects(f.db.query('delete from field_sales_earning_entries where entry_id=$1',[entry.entry_id]),/append-only/);
  assert.equal((await f.db.query('select count(*)::int n from h2s_payouts_ledger')).rows[0].n,0);
  const own=await(await f.request('GET',null,'a')).json(),other=await(await f.request('GET',null,'b')).json();
  assert.equal(own.entries.length,1);assert.equal(other.entries.length,0);assert.equal(other.orders.length,0);
  assert.ok(!JSON.stringify(own).includes('PRIVATE-SYNTHETIC'));assert.ok(!JSON.stringify(own).includes('100 Fixture Lane'));
  assert.ok(JSON.stringify(await(await f.request()).json()).includes('PRIVATE-SYNTHETIC-INVOICE'));
  assert.equal((await f.request('GET',null,'a','?quoteId='+o.quoteId)).status,200);
  assert.equal((await f.request('GET',null,'b','?quoteId='+o.quoteId)).status,404);
  assert.equal((await f.request('GET',null,'b','?representativeId='+id(20))).status,403);
  assert.equal((await f.request('GET',null,'a','?representativeId='+id(21))).status,403);
  await assert.rejects(f.sales.ownedOpportunity(id(20),o.leadId),error=>error.status===404);
  assert.equal((await f.request('GET',null,'b','?quoteId='+o.quoteId)).status,404);
  assert.equal((await f.request('GET',null,'a','?representativeId='+id(21))).status,403);
});
test('missing categories, missing zero attestations and unreviewed technician costs retain qualification without payable earnings',async t=>{
  const f=await createEarningsFixture();t.after(()=>f.db.close());
  const cases=[{expenses:[]},{expenses:[{category:'equipment',quantity:1,unitCents:100,amountCents:100,evidence:{reference:'actual receipt'},actual:true}]},
    {expenses:[{category:'equipment',quantity:0,unitCents:0,amountCents:0,evidence:{reference:'equipment attestation missing'},actual:true},
      {category:'materials',quantity:0,unitCents:0,amountCents:0,evidence:{reference:'materials attestation missing'},actual:true}]},
    {costsReviewed:false}];
  for(const input of cases){
    const o=await f.order(input),read=await(await f.request('GET',null,'a','?quoteId='+o.quoteId)).json();
    assert.equal(read.orders[0].state,'calculation_review');assert.ok(read.orders[0].qualifiesAt);assert.equal(read.entries.length,0);
  }
  const raw=(await f.db.query('select technician_expenses,expenses,costs_complete from field_sales_workflows where costs_complete=false')).rows[0];
  assert.ok(raw.technician_expenses.length>0);assert.equal(raw.expenses.length,0);
});
test('qualification preserves time despite missing actual evidence, final payment alone does not complete',async t=>{
  const f=await createEarningsFixture();t.after(()=>f.db.close());
  const o=await f.order({fees:false});
  const first=await(await f.request('GET',null,'a')).json();
  assert.equal(first.orders[0].state,'calculation_review');assert.ok(first.orders[0].qualifiesAt);
  assert.equal(first.entries.length,0);
  const time=first.orders[0].qualifiesAt;
  await f.db.query(`select field_sales_identity_command($1,$2,jsonb_build_object('userId',$3::text,
    'commissionStartDate',((now() at time zone 'America/New_York')::date-80)::text,
    'commissionStartEvidence','synthetic later corrected start','termsRevision',1))`,[id(9),crypto.randomUUID(),id(20)]);
  await f.db.query("update field_sales_workflow_policies set status='retired' where policy_id=$1",[f.commission]);
  await f.db.query('update field_sales_checkouts set processing_fee_cents=300,processing_fee_evidence=$2 where checkout_id=$1',[
    o.checkoutId,JSON.stringify({source:'synthetic independently verified provider fee'})]);
  const next=await(await f.request('GET',null,'a')).json();assert.equal(next.entries.length,1);assert.equal(next.entries[0].qualifiesAt,time);
  assert.equal(next.entries[0].rateBasisPoints,5500);assert.equal(next.entries[0].tenureDay,11);
  const incomplete=await f.order({completed:false});
  const data=await(await f.request('GET',null,'a','?quoteId='+incomplete.quoteId)).json();
  assert.equal(data.orders[0].state,'pending_qualification');
  const unpaid=await f.order({paid:false});
  assert.equal((await(await f.request('GET',null,'a','?quoteId='+unpaid.quoteId)).json()).orders[0].state,'pending_qualification');
  // Synthetic observation setup only; field_workflow.test.cjs proves the real deposit/balance receipt path.
  await f.db.query("update field_sales_checkouts set captured_cents=amount_cents,state='paid' where checkout_id=$1",[unpaid.checkoutId]);
  const verifiedAt=new Date().toISOString();
  await f.db.query('update field_sales_workflows set verified_paid_at=$2,fully_paid_event_id=$3 where quote_id=$1',
    [unpaid.quoteId,verifiedAt,'synthetic-verified-final-'+unpaid.quoteId]);
  assert.equal((await(await f.request('GET',null,'a','?quoteId='+unpaid.quoteId)).json()).orders[0].state,'calculation_review');
  await f.db.query('update field_sales_workflows set verified_paid_at=$2,fully_paid_event_id=$3 where quote_id=$1',
    [unpaid.quoteId,verifiedAt,'synthetic-verified-final-'+unpaid.quoteId]);
  assert.equal((await f.db.query('select count(*)::int n from field_sales_earning_qualifications where quote_id=$1',[unpaid.quoteId])).rows[0].n,1);
});
test('idempotent Friday runs, reviewed export and exact independently reconciled settlement proof',async t=>{
  const f=await createEarningsFixture();t.after(()=>f.db.close());const o=await f.order();
  const runDate=f.engine.fridayRunDate(new Date().toISOString(),f.settlementPolicy);
  const operationId=crypto.randomUUID(),body={action:'create_run',operationId,settlementPolicyId:f.settlement,runDate};
  const created=await f.command(body);assert.equal(created.result.ok,true,created.result.error);const runId=created.result.runId;
  const concurrent=await Promise.all([f.command(body),f.command(body)]);assert.ok(concurrent.every(x=>x.result.runId===runId));
  assert.equal((await f.command({action:'create_run',settlementPolicyId:f.settlement,runDate})).result.ok,false);
  assert.equal((await f.command({action:'export_run',runId,evidence:'fixture export'})).result.ok,false);
  const approve={action:'approve_run',runId,evidence:'synthetic authorized review',operationId:crypto.randomUUID()};
  assert.equal((await f.command(approve)).result.state,'approved');assert.equal((await f.command(approve)).result.state,'approved');
  const exported=await f.command({action:'export_run',runId,evidence:'synthetic manual-method export'});assert.equal(exported.result.state,'exported');
  let data=await(await f.request()).json();assert.equal(data.summary.reconciledPaidCents,0);
  const proof={reference:'synthetic-reconciled-'+runId,method:f.settlementPolicy.method,settledAt:new Date().toISOString(),
    amountCents:3960,beneficiaries:[{representativeId:id(20),amountCents:3960}],evidence:{statement:'synthetic-independent-proof'},
    independentReconciliation:true};
  for(const mutate of [p=>p.amountCents=1,p=>p.method='other',p=>p.independentReconciliation=false,p=>p.beneficiaries[0].representativeId=id(21)]){
    const wrong=JSON.parse(JSON.stringify(proof));mutate(wrong);
    assert.equal((await f.command({action:'record_settlement',runId,proof:wrong})).result.ok,false);
  }
  const settle={action:'record_settlement',runId,proof,operationId:crypto.randomUUID()};
  assert.equal((await f.command(settle)).result.state,'reconciled_paid');
  assert.equal((await f.command(settle)).result.state,'reconciled_paid');
  assert.equal((await f.command({action:'record_settlement',runId,proof})).result.ok,false);
  data=await(await f.request()).json();assert.equal(data.summary.reconciledPaidCents,3960);assert.equal(data.externalPaymentInitiated,false);
  assert.equal((await f.db.query('select count(*)::int n from field_sales_earning_allocations')).rows[0].n,1);
  assert.equal((await f.db.query('select count(*)::int n from field_sales_earning_settlements')).rows[0].n,1);
  const nextOrder=await f.order();assert.ok(nextOrder.quoteId);
  await f.db.query('update field_sales_checkouts set refunded_cents=1000 where checkout_id=$1',[o.checkoutId]);
  const paidEntry=(await f.db.query('select entry_id from field_sales_earning_entries where quote_id=$1',[o.quoteId])).rows[0].entry_id;
  const correction=await f.command({action:'review_adjustment',entryId:paidEntry,amountCents:-550,
    reason:'Reviewed refund of previously settled earning; not a debt authorization',evidence:{reference:'synthetic actual refund accounting review'}});
  assert.equal(correction.result.ok,true);
  const corrected=await(await f.request('GET',null,'a')).json();
  assert.equal(corrected.adjustments[0].effect,'earning_correction_not_debt');
  assert.equal(corrected.adjustments[0].settlementState,'recovery_review_required');
  const nextDate=new Date(Date.parse(runDate+'T00:00:00Z')+7*86400000).toISOString().slice(0,10);
  const recovery=await f.command({action:'create_run',settlementPolicyId:f.settlement,runDate:nextDate});
  assert.equal(recovery.response.status,409);assert.match(recovery.result.error,/no automatic netting, wage clawback or representative debt/);
  assert.equal((await f.db.query('select count(*)::int n from field_sales_earning_allocations')).rows[0].n,1);
  assert.equal((await f.db.query('select count(*)::int n from field_sales_earning_runs')).rows[0].n,1);
});
test('reviewed refund/dispute adjustments append; routes and SQL grants fail closed',async t=>{
  const f=await createEarningsFixture();t.after(()=>f.db.close());const o=await f.order();
  const entry=(await f.db.query('select * from field_sales_earning_entries')).rows[0];
  await f.db.query('update field_sales_checkouts set disputed=true,refunded_cents=1000 where checkout_id=$1',[o.checkoutId]);
  const read=await(await f.request()).json();assert.equal(read.orders[0].state,'held');
  const adjusted=await f.command({action:'review_adjustment',entryId:entry.entry_id,amountCents:-550,reason:'Reviewed synthetic partial refund',
    evidence:{refund:'synthetic-reviewed-provider-event',accounting:'approved calculation'}});
  assert.equal(adjusted.result.state,'reviewed');
  assert.equal(Number((await f.db.query('select amount_cents from field_sales_earning_entries')).rows[0].amount_cents),3960);
  const date=f.engine.fridayRunDate(new Date().toISOString(),f.settlementPolicy);
  const run=await f.command({action:'create_run',settlementPolicyId:f.settlement,runDate:date});
  assert.equal(run.result.ok,true,run.result.error);assert.equal(run.result.amountCents,3410);
  assert.equal((await f.command({action:'review_order',quoteId:o.quoteId},'a')).response.status,403);
  assert.equal((await f.request('GET',null,'va')).status,403);assert.equal((await f.request('GET',null,'expired')).status,401);
  assert.equal((await f.request('GET',null,'admin','?bogus=1')).status,400);
  await f.db.query('update "Dashboard_Users" set "Is_Disabled"=true where "User_ID"=$1',[id(20)]);
  assert.equal((await f.request('GET',null,'a')).status,401);
  const privileges=await f.db.query(`select has_table_privilege('service_role','field_sales_earning_entries','INSERT') inserts,
    has_table_privilege('authenticated','field_sales_earning_entries','SELECT') reads,
    has_function_privilege('authenticated','field_sales_earnings_read(uuid,uuid,uuid)','EXECUTE') rpc,
    has_function_privilege('service_role','field_sales_earnings_observe(uuid,boolean)','EXECUTE') observe,
    has_table_privilege('service_role','field_sales_earning_allocation_claims','DELETE') claims,
    has_table_privilege('authenticated','field_sales_earning_effective_allocations','SELECT') effective`);
  assert.deepEqual(privileges.rows[0],{inserts:false,reads:false,rpc:false,observe:false,claims:false,effective:false});
});
test('SQL Friday calendar parity, zero actual evidence, provider corrections and approved policy requirement',async t=>{
  const f=await createEarningsFixture();t.after(()=>f.db.close());
  for(const [at,extra] of [['2026-11-06T21:59:00Z',{}],['2026-11-06T22:00:00Z',{}],
    ['2026-03-13T21:00:00Z',{}],['2026-11-02T12:00:00Z',{holidays:['2026-11-06'],holidayConvention:'previous_business_day'}],
    ['2026-11-02T12:00:00Z',{holidays:['2026-11-06'],holidayConvention:'next_business_day'}]]){
    const p={...f.settlementPolicy,...extra};
    const sql=(await f.db.query('select field_sales_earning_run_date($1,$2)::text date',[at,JSON.stringify(p)])).rows[0].date;
    assert.equal(sql,f.engine.fridayRunDate(at,p));
  }
  const o=await f.order({expenses:[{category:'equipment',quantity:0,unitCents:0,amountCents:0,evidence:{reference:'actual no equipment used'},actual:true,zeroCostAttestation:'No equipment cost incurred'},
    {category:'materials',quantity:0,unitCents:0,amountCents:0,evidence:{reference:'actual no materials used'},actual:true,zeroCostAttestation:'No materials cost incurred'}]});
  const e=(await f.db.query('select * from field_sales_earning_entries')).rows[0];assert.equal(Number(e.amount_cents),5335);
  await f.db.query('update field_sales_checkouts set processing_fee_cents=0,processing_fee_evidence=null where checkout_id=$1',[o.checkoutId]);
  assert.equal((await(await f.request()).json()).orders[0].state,'held');
  const date=f.engine.fridayRunDate(new Date().toISOString(),f.settlementPolicy);
  assert.equal((await f.command({action:'create_run',settlementPolicyId:f.settlement,runDate:date})).result.ok,false);
  await f.db.query('update field_sales_checkouts set processing_fee_cents=0,processing_fee_evidence=$2 where checkout_id=$1',
    [o.checkoutId,JSON.stringify({source:'actual independently verified zero fee'})]);
  assert.equal((await(await f.request()).json()).orders[0].state,'held');
  assert.equal((await f.command({action:'review_adjustment',entryId:e.entry_id,amountCents:165,reason:'Actual provider fee corrected to zero',
    evidence:'independently reviewed fee correction'})).result.ok,true);
  const run=await f.command({action:'create_run',settlementPolicyId:f.settlement,runDate:date});assert.equal(run.result.amountCents,5500);
  await f.db.query("insert into field_sales_workflow_policies(policy_id,kind,definition) values($1,'settlement',$2)",[id(990),JSON.stringify(f.settlementPolicy)]);
  assert.equal((await f.command({action:'create_run',settlementPolicyId:id(990),runDate:date})).result.ok,false);
});
test('audited abandonment releases only effective unexported claims; same-Friday reviewed replacements retain immutable history',async t=>{
  const f=await createEarningsFixture();t.after(()=>f.db.close());const o=await f.order();
  const date=f.engine.fridayRunDate(new Date().toISOString(),f.settlementPolicy);
  const create=()=>f.command({action:'create_run',settlementPolicyId:f.settlement,runDate:date});
  const first=await create();assert.equal(first.result.ok,true,first.result.error);
  const originalRun=JSON.stringify((await f.db.query('select * from field_sales_earning_runs where run_id=$1',[first.result.runId])).rows[0]);
  const originalAllocation=JSON.stringify((await f.db.query('select * from field_sales_earning_allocations where run_id=$1',[first.result.runId])).rows);
  const abandon={action:'abandon_run',operationId:crypto.randomUUID(),runId:first.result.runId,
    reason:'Draft replaced before any export',evidence:{reference:'synthetic audited draft review'}};
  const released=await f.command(abandon);assert.equal(released.result.state,'abandoned');assert.equal(released.result.effectiveAllocationsReleased,true);
  assert.equal((await f.command(abandon)).result.state,'abandoned');
  assert.equal((await f.command({...abandon,operationId:crypto.randomUUID()},'a')).response.status,403);
  assert.equal(JSON.stringify((await f.db.query('select * from field_sales_earning_runs where run_id=$1',[first.result.runId])).rows[0]),originalRun);
  assert.equal(JSON.stringify((await f.db.query('select * from field_sales_earning_allocations where run_id=$1',[first.result.runId])).rows),originalAllocation);
  assert.equal((await f.db.query('select count(*)::int n from field_sales_earning_effective_allocations')).rows[0].n,0);
  let dto=await(await f.request()).json();assert.equal(dto.summary.allocatedCents,0);assert.equal(dto.runs[0].state,'abandoned');
  assert.equal(dto.runs[0].canAbandon,false);assert.equal(dto.runs[0].abandonment.reason,abandon.reason);
  const second=await create();assert.equal(second.result.ok,true,second.result.error);assert.notEqual(second.result.runId,first.result.runId);
  assert.equal((await f.command({action:'approve_run',runId:second.result.runId,evidence:'authorized initial review'})).result.state,'approved');
  await f.db.query('update field_sales_checkouts set refunded_cents=1000 where checkout_id=$1',[o.checkoutId]);
  const entry=(await f.db.query('select entry_id from field_sales_earning_entries where quote_id=$1',[o.quoteId])).rows[0].entry_id;
  assert.equal((await f.command({action:'review_adjustment',entryId:entry,amountCents:-550,reason:'Reviewed unpaid refund correction',
    evidence:{reference:'synthetic current refund facts reviewed'}})).result.ok,true);
  assert.equal((await f.command({action:'export_run',runId:second.result.runId,evidence:'must remain blocked'})).response.status,409);
  assert.equal((await create()).response.status,409);
  const later=new Date(Date.parse(date+'T00:00:00Z')+7*86400000).toISOString().slice(0,10);
  assert.equal((await f.command({action:'create_run',settlementPolicyId:f.settlement,runDate:later})).response.status,409);
  assert.equal((await f.command({action:'abandon_run',runId:second.result.runId,reason:'Approved run changed before export',
    evidence:'audited replacement review'})).result.state,'abandoned');
  const third=await create();assert.equal(third.result.ok,true,third.result.error);assert.equal(third.result.amountCents,3410);
  assert.equal((await f.db.query('select count(*)::int n from field_sales_earning_allocations')).rows[0].n,4);
  assert.equal((await f.db.query('select count(*)::int n from field_sales_earning_effective_allocations')).rows[0].n,2);
  assert.equal((await f.db.query('select count(*)::int n from field_sales_earning_active_runs')).rows[0].n,1);
  dto=await(await f.request()).json();assert.equal(dto.summary.allocatedCents,3410);assert.equal(dto.summary.reconciledPaidCents,0);
  assert.equal(dto.runs.filter(r=>r.state==='abandoned').length,2);
  assert.equal((await f.command({action:'approve_run',runId:first.result.runId,evidence:'abandoned cannot approve'})).response.status,409);
  assert.equal((await f.command({action:'approve_run',runId:third.result.runId,evidence:'reviewed replacement'})).result.state,'approved');
  assert.equal((await f.command({action:'export_run',runId:third.result.runId,evidence:'manual approved export'})).result.state,'exported');
  assert.equal((await f.command({action:'abandon_run',runId:third.result.runId,reason:'Export cannot be assumed unpaid',
    evidence:'unsupported recovery attempt'})).response.status,409);
  assert.equal((await f.db.query('select count(*)::int n from field_sales_earning_effective_allocations')).rows[0].n,2);
  // Owner-level synthetic inserts verify physical uniqueness; the entire probe is rolled back.
  await f.db.exec('begin');
  try {
    const competing=crypto.randomUUID();
    await f.db.query(`insert into field_sales_earning_runs(run_id,run_date,policy_id,policy_snapshot,amount_cents,beneficiaries,created_by)
      values($1,$2,$3,(select to_jsonb(p) from field_sales_workflow_policies p where p.policy_id=$3),0,'[]',$4)`,
      [competing,later,f.settlement,id(9)]);
    await assert.rejects(f.db.query(`insert into field_sales_earning_allocations(run_id,entry_id,representative_id,amount_cents)
      values($1,$2,$3,3960)`,[competing,entry,id(20)]),error=>error.code==='23505');
  } finally { await f.db.exec('rollback'); }
  assert.equal((await f.db.query('select count(*)::int n from field_sales_earning_effective_allocations')).rows[0].n,2);
  await assert.rejects(f.db.query('delete from field_sales_earning_allocations where run_id=$1',[first.result.runId]),/append-only/);
});
test('adjustment-only runs resolve their source earning and hold changed facts on creation, approval and export',async t=>{
  for(const stage of ['approve_run','export_run']){
    const f=await createEarningsFixture();t.after(()=>f.db.close());const o=await f.order();
    const date=f.engine.fridayRunDate(new Date().toISOString(),f.settlementPolicy);
    const original=await f.command({action:'create_run',settlementPolicyId:f.settlement,runDate:date}),runId=original.result.runId;
    assert.equal((await f.command({action:'approve_run',runId,evidence:'reviewed original'})).result.ok,true);
    assert.equal((await f.command({action:'export_run',runId,evidence:'manual original export'})).result.ok,true);
    assert.equal((await f.command({action:'record_settlement',runId,proof:{reference:'synthetic-original-'+runId,method:f.settlementPolicy.method,
      settledAt:new Date().toISOString(),amountCents:3960,beneficiaries:[{representativeId:id(20),amountCents:3960}],
      evidence:{reference:'independently reconciled original'},independentReconciliation:true}})).result.state,'reconciled_paid');
    await f.db.query('update field_sales_checkouts set processing_fee_cents=200 where checkout_id=$1',[o.checkoutId]);
    const entry=(await f.db.query('select entry_id from field_sales_earning_entries where quote_id=$1',[o.quoteId])).rows[0].entry_id;
    const correction=await f.command({action:'review_adjustment',entryId:entry,amountCents:55,reason:'Actual provider fee reduced by 100 cents',
      evidence:{reference:'independently reviewed actual fee correction'}});
    assert.equal(correction.result.ok,true);
    const hash=(await f.db.query(`select a.source_hash=encode(sha256(convert_to(field_sales_workflow_order_facts($1)::text,'UTF8')),'hex') correct
      from field_sales_earning_adjustments a where adjustment_id=$2`,[o.quoteId,correction.result.adjustmentId])).rows[0].correct;
    assert.equal(hash,true);
    const later=new Date(Date.parse(date+'T00:00:00Z')+7*86400000).toISOString().slice(0,10);
    if(stage==='approve_run'){
      await f.db.query('update field_sales_checkouts set processing_fee_cents=300 where checkout_id=$1',[o.checkoutId]);
      assert.equal((await f.command({action:'create_run',settlementPolicyId:f.settlement,runDate:later})).response.status,409);
      assert.equal((await(await f.request()).json()).orders[0].state,'held');
      await f.db.query('update field_sales_checkouts set processing_fee_cents=200 where checkout_id=$1',[o.checkoutId]);
      await f.db.query('update field_sales_checkouts set disputed=true where checkout_id=$1',[o.checkoutId]);
      const held=await f.command({action:'create_run',settlementPolicyId:f.settlement,runDate:later});
      assert.equal(held.response.status,409);assert.equal((await(await f.request()).json()).orders[0].state,'held');
      // Isolated financial-fact reset only, not a provider dispute-clearance command.
      await f.db.query('update field_sales_checkouts set disputed=false where checkout_id=$1',[o.checkoutId]);
    }
    const adjusted=await f.command({action:'create_run',settlementPolicyId:f.settlement,runDate:later});
    assert.equal(adjusted.result.ok,true,adjusted.result.error);assert.equal(adjusted.result.amountCents,55);
    const adjustedId=adjusted.result.runId;
    assert.equal((await f.db.query('select entry_id is null adjustment_only from field_sales_earning_effective_allocations where run_id=$1',[adjustedId])).rows[0].adjustment_only,true);
    if(stage==='export_run')assert.equal((await f.command({action:'approve_run',runId:adjustedId,evidence:'reviewed before new dispute'})).result.state,'approved');
    await f.db.query('update field_sales_checkouts set disputed=true where checkout_id=$1',[o.checkoutId]);
    const blocked=await f.command({action:stage,runId:adjustedId,evidence:'stale facts cannot authorize export'});
    assert.equal(blocked.response.status,409);assert.match(blocked.result.error,/unresolved refund\/dispute evidence/);
    await assert.rejects(f.db.query('select field_sales_earnings_command($1,$2,$3,$4)',[id(9),crypto.randomUUID(),stage,
      JSON.stringify({runId:adjustedId,evidence:'SQL authority cannot bypass hold'})]),/unresolved refund\/dispute evidence/);
    assert.equal((await f.db.query("select count(*)::int n from field_sales_earning_run_events where run_id=$1 and kind='exported'",[adjustedId])).rows[0].n,0);
  }
});
test('settlement timestamp is mandatory and strictly validated by both API and SQL before any paid evidence',async t=>{
  const f=await createEarningsFixture();t.after(()=>f.db.close());await f.order();
  const date=f.engine.fridayRunDate(new Date().toISOString(),f.settlementPolicy);
  const created=await f.command({action:'create_run',settlementPolicyId:f.settlement,runDate:date}),runId=created.result.runId;
  await f.command({action:'approve_run',runId,evidence:'authorized review'});
  await f.command({action:'export_run',runId,evidence:'authorized export'});
  const base={reference:'synthetic-strict-time-'+runId,method:f.settlementPolicy.method,amountCents:3960,
    beneficiaries:[{representativeId:id(20),amountCents:3960}],evidence:{reference:'independent proof'},independentReconciliation:true};
  const invalid=[undefined,null,'','not-a-timestamp','2026-02-30T12:00:00Z','2026-11-04T12:00:00',123,true,{timestamp:'wrong type'},
    '1900-01-01T00:00:00Z',new Date(Date.now()+86400000).toISOString()];
  for(const settledAt of invalid){
    const proof={...base,...(settledAt===undefined?{}:{settledAt})};
    const result=await f.command({action:'record_settlement',runId,proof});
    assert.equal(result.result.ok,false);assert.ok([400,409].includes(result.response.status));
    await assert.rejects(f.db.query('select field_sales_earnings_command($1,$2,$3,$4)',[id(9),crypto.randomUUID(),'record_settlement',
      JSON.stringify({runId,proof})]),/settlement timestamp|Settlement timestamp/);
  }
  assert.equal((await f.db.query('select count(*)::int n from field_sales_earning_settlements')).rows[0].n,0);
  assert.equal((await(await f.request()).json()).summary.reconciledPaidCents,0);
  const valid=await f.command({action:'record_settlement',runId,proof:{...base,settledAt:new Date().toISOString()}});
  assert.equal(valid.result.state,'reconciled_paid');
  assert.equal((await f.command({action:'abandon_run',runId,reason:'Reconciled funds cannot release claims',
    evidence:'unsupported abandonment'})).response.status,409);
});

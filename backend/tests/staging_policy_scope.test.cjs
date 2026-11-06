'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {createWorkflowFixture,id}=require('./helpers/field_workflow_fixture.cjs');
const {retargetSql}=require('../tools/staging-sql-namespace.cjs');
const runId='c6316381-64f5-4b67-b41f-41711416cdcc';
const schema='h2s_test_'+runId.replaceAll('-',''),role=schema+'_owner',storageSchema=schema+'_storage';
const target={schema,storageSchema},q=name=>'"'+name.replaceAll('"','""')+'"';
const sql=fs.readFileSync(path.join(__dirname,'..','migrations','053_staging_configuration_scope.sql'),'utf8').replaceAll('\r','');
const identity={marker:'home2smart-native-test-run-v1',runId,schema,storageSchema,role,
  sourceCommit:'a'.repeat(40),nativeBaselineFingerprint:'b'.repeat(64)};
const literal=value=>"'"+value.replaceAll("'","''")+"'";
const checked=async response=>{const data=await response.json();assert.equal(response.status,200,data.error);return data;};
const catalogMigration=()=>fs.readFileSync(path.join(__dirname,'..','migrations','048_field_sales_catalog_administration.sql'),'utf8');
async function nativeFixture(t){
  const f=await createWorkflowFixture();t.after(()=>f.db.close());await f.enable();
  await f.db.exec(catalogMigration());
  await f.db.exec(`create role ${q(role)} nologin noinherit;
    alter schema public rename to ${q(schema)}; create schema public;
    alter schema ${q(schema)} owner to ${q(role)};
    create schema ${q(storageSchema)} authorization ${q(role)};
    set search_path=${q(schema)},pg_catalog;`);
  const functions=(await f.db.query(`select p.oid::regprocedure::text as signature,pg_get_functiondef(p.oid) as source
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname=$1 and p.prokind='f'`,[schema])).rows;
  for(const fn of functions){
    const source=fn.source.replaceAll('\r','').replace(/SET search_path TO ([^\n]+)/g,(_,names)=>{
      assert.match(names,/^'(?:public|pg_catalog|pg_temp)'(?:, '(?:public|pg_catalog|pg_temp)')*$/);
      return 'SET search_path='+names.replaceAll("'",'');
    });
    await f.db.exec(retargetSql(source,target));
    await f.db.exec(`alter function ${fn.signature} owner to ${q(role)}`);
  }
  const tables=(await f.db.query(`select c.relname,c.relkind from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname=$1 and c.relkind in ('r','v')`,[schema])).rows;
  for(const table of tables)await f.db.exec(`alter ${table.relkind==='v'?'view':'table'} ${q(schema)}.${q(table.relname)} owner to ${q(role)}`);
  await f.db.exec(`set role ${q(role)};
    create table h2s_test_run(run_id uuid primary key,source_commit text,baseline_sha256 text);
    insert into h2s_test_run values('${runId}','${identity.sourceCommit}','${identity.nativeBaselineFingerprint}');
    comment on schema ${q(schema)} is ${literal(JSON.stringify(identity))};
    comment on schema ${q(storageSchema)} is ${literal(JSON.stringify(identity))};`);
  assert.equal((await f.db.query('select field_sales_native_staging_scope() as ok')).rows[0].ok,true);
  return f;
}
const usable=async db=>(await db.query("select field_sales_configuration_usable('staging_only','approved') as ok")).rows[0].ok;

test('public fixtures reject staging rows/API transitions and incremental migration, preserving approval behavior',{timeout:180000},async t=>{
  const f=await createWorkflowFixture();t.after(()=>f.db.close());await f.enable();
  await f.db.exec(catalogMigration());
  await f.db.exec('update field_sales_catalog_admin_settings set enabled=true');
  assert.equal(await usable(f.db),false);
  for(const [table,statement,values] of [
    ['catalog',`insert into field_sales_catalogs(catalog_id,version,status,definition,source_evidence)
      values($1,'not-native','staging_only',$2,$3)`,[crypto.randomUUID(),f.definition,{stagingOnly:true,productionApproved:false}]],
    ['agreement',`insert into field_sales_agreement_policies(policy_id,version,status,terms,cancellation_information,electronic_delivery,payment_terms,approval_evidence)
      values($1,'not-native','staging_only','terms','notice','delivery','payment','staging authorization')`,[crypto.randomUUID()]],
    ['workflow',`insert into field_sales_workflow_policies(policy_id,kind,status,definition,approval_evidence)
      values($1,'commission','staging_only','{}','{"reference":"staging"}')`,[crypto.randomUUID()]]
  ])await assert.rejects(f.db.query(statement,values),/check constraint/i,table);
  const policyId=crypto.randomUUID();
  await f.db.query("insert into field_sales_workflow_policies(policy_id,kind,definition) values($1,'commission',$2)",[policyId,{timezone:'UTC'}]);
  const hash=(await f.db.query("select encode(sha256(convert_to(definition::text,'UTF8')),'hex') as hash from field_sales_workflow_policies where policy_id=$1",[policyId])).rows[0].hash;
  await assert.rejects(f.db.query("select field_sales_workflow_command($1,$2,null,null,null,'policy_approve',$3)",
    [id(9),crypto.randomUUID(),{policy_id:policyId,expectedDefinitionHash:hash,status:'staging_only',evidence:{reference:'staging'}}]),/verified native test run/);
  const draftId=crypto.randomUUID();
  await f.db.query("insert into field_sales_catalogs(catalog_id,version,definition,source_evidence) values($1,'proposed-native-only',$2,$3)",
    [draftId,f.definition,{stagingOnly:true,productionApproved:false}]);
  const digest=(await f.db.query("select encode(sha256(convert_to(definition::text,'UTF8')),'hex') as digest from field_sales_catalogs where catalog_id=$1",[draftId])).rows[0].digest;
  await assert.rejects(f.db.query("select field_sales_catalog_admin_command($1,$2,'publish',$3)",
    [id(9),crypto.randomUUID(),{catalogId:draftId,expectedDigest:digest,approvalEvidence:'Staging only, no production approval'}]),/cannot become production/);
  await assert.rejects(f.db.exec(sql),/053 requires the verified UUID-owned native sandbox/);
  await f.db.exec('rollback');
  assert.equal((await f.db.query("select bool_and(status='approved') as ok from field_sales_workflow_policies where policy_id<>$1",[policyId])).rows[0].ok,true);
});

test('verified native run stages existing API policies, quotes and legal copies without legal approval; scope tampering fails closed',{timeout:180000},async t=>{
  const f=await nativeFixture(t);
  await f.db.exec(retargetSql(sql,target));
  await f.db.exec(retargetSql(sql,target));
  await f.db.exec('update field_sales_catalog_admin_settings set enabled=true');
  const publicationId=crypto.randomUUID();
  await f.db.query("insert into field_sales_catalogs(catalog_id,version,definition,source_evidence) values($1,'api-staging-publication',$2,$3)",
    [publicationId,f.definition,{stagingOnly:true,productionApproved:false}]);
  const digest=(await f.db.query("select encode(sha256(convert_to(definition::text,'UTF8')),'hex') as digest from field_sales_catalogs where catalog_id=$1",[publicationId])).rows[0].digest;
  await f.db.query("select field_sales_catalog_admin_command($1,$2,'publish',$3)",
    [id(9),crypto.randomUUID(),{catalogId:publicationId,expectedDigest:digest,approvalEvidence:'User-authorized staging publication, never production'}]);
  const published=(await f.db.query('select * from field_sales_catalogs where catalog_id=$1',[publicationId])).rows[0];
  assert.equal(published.status,'staging_only');assert.equal(published.approved_by,null);assert.equal(published.published_at,null);
  assert.equal(published.productionApproved,false);assert.equal(published.stagingOnly,true);
  const catalogId=crypto.randomUUID(),agreementId=crypto.randomUUID();
  await f.db.query(`insert into field_sales_catalogs(catalog_id,version,status,definition,source_evidence)
    values($1,'authorized-staging','staging_only',$2,$3)`,[catalogId,f.definition,{stagingOnly:true,productionApproved:false,reference:'User-authorized native certification'}]);
  await assert.rejects(f.db.query(`insert into field_sales_catalogs(catalog_id,version,status,definition,source_evidence)
    values($1,'unmarked-staging','staging_only',$2,'{}')`,[crypto.randomUUID(),f.definition]),/check constraint/i);
  await assert.rejects(f.db.query(`insert into field_sales_agreement_policies(policy_id,version,status,terms,electronic_delivery,payment_terms,approval_evidence)
    values($1,'missing-cancellation-copy','staging_only','terms','delivery','payment','staging authorization')`,[crypto.randomUUID()]),/check constraint/i);
  await f.db.query(`insert into field_sales_agreement_policies(policy_id,version,status,terms,cancellation_information,electronic_delivery,payment_terms,approval_evidence)
    select $1,'unreviewed-staging','staging_only',terms,cancellation_information,electronic_delivery,payment_terms,'User-authorized staging copies, not legal approval'
    from field_sales_agreement_policies where policy_id=$2`,[agreementId,id(811)]);
  await f.db.query(`update field_sales_transaction_settings set agreement_policy_id=$1::uuid,
    deposit_policy=jsonb_set(deposit_policy,'{agreementPolicyId}',to_jsonb(($1::uuid)::text))`,[agreementId]);
  const policies={};
  for(const kind of ['legal','commission','settlement']){
    const policyId=crypto.randomUUID();
    const source=(await f.db.query('select definition from field_sales_workflow_policies where policy_id=$1',[f.policyIds[kind]])).rows[0].definition;
    if(kind==='legal')source.agreementPolicyId=agreementId;
    const created=await checked(await f.admin({action:'policy_create',policyId,kind,definition:source}));
    await checked(await f.admin({action:'policy_approve',policyId,expectedDefinitionHash:created.definitionHash,evidence:{reference:'User-authorized staging certification only'}}));
    policies[kind]=policyId;
  }
  const rows=(await f.db.query('select * from field_sales_workflow_policies where policy_id=any($1::uuid[])',[Object.values(policies)])).rows;
  assert.equal(rows.length,3);
  for(const row of rows){
    assert.equal(row.status,'staging_only');assert.equal(row.productionApproved,false);assert.equal(row.stagingOnly,true);
    assert.equal(row.approved_by,null);assert.equal(row.approved_at,null);
    await assert.rejects(f.db.query("update field_sales_workflow_policies set status='approved',approved_by=$1,approved_at=now() where policy_id=$2",[id(9),row.policy_id]),/immutable/i);
  }
  const invalidLegalId=crypto.randomUUID();
  const invalid=await checked(await f.admin({action:'policy_create',policyId:invalidLegalId,kind:'legal',
    definition:{agreementPolicyId:agreementId,depositBasisPoints:2500,requiredNotices:[],cancellationCalendar:{}}}));
  assert.notEqual((await f.admin({action:'policy_approve',policyId:invalidLegalId,expectedDefinitionHash:invalid.definitionHash,
    evidence:{reference:'Staging does not bypass cancellation/legal gates'}})).status,200);
  assert.equal((await f.db.query('select status from field_sales_workflow_policies where policy_id=$1',[invalidLegalId])).rows[0].status,'draft');
  const leadId=await f.lead();
  let quote=await checked(await f.post({action:'quote',leadId,catalogId,lines:f.lines()}));
  quote=await checked(await f.post({action:'submit',leadId,quoteId:quote.id}));
  const snapshot=(await f.db.query('select state,snapshot from field_sales_quotes where quote_id=$1',[quote.id])).rows[0];
  assert.equal(snapshot.state,'approved');assert.equal(snapshot.snapshot.productionApproved,false);assert.equal(snapshot.snapshot.stagingOnly,true);
  await f.db.query(`select field_sales_identity_command($1,$2,jsonb_build_object('userId',$3::text,
    'commissionStartDate',((now() at time zone 'America/New_York')::date-10)::text,
    'commissionStartEvidence','Verified synthetic staging tenure','termsRevision',0))`,[id(9),crypto.randomUUID(),id(20)]);
  await checked(await f.admin({action:'enroll',leadId,quoteId:quote.id,revision:0,legalPolicyId:policies.legal,
    commissionPolicyId:policies.commission,settlementPolicyId:policies.settlement,representativeId:id(20),creditEvidence:{reference:'Staging credit only'}}));
  const record=await f.documents({leadId,quoteId:quote.id});
  const agreement=(await f.db.query('select policy_snapshot from field_sales_agreements where quote_id=$1',[quote.id])).rows[0].policy_snapshot;
  assert.equal(agreement.productionApproved,false);assert.equal(agreement.stagingOnly,true);assert.equal(agreement.approved_at,null);
  assert.equal(agreement.status,'staging_only');
  await assert.rejects(f.db.query("update field_sales_catalogs set definition=definition||'{\"changed\":true}' where catalog_id=$1",[catalogId]),/immutable/i);
  await assert.rejects(f.db.query("update field_sales_agreement_policies set terms='changed' where policy_id=$1",[agreementId]),/immutable/i);
  const stages=(await f.db.query("select field_sales_workflow_document_gate($1) as documents,field_sales_workflow_deadline($1,now()) as deadline",[quote.id])).rows[0];
  assert.equal(stages.documents,true);assert.ok(stages.deadline);
  await f.accept(record);
  const notPaid=await f.request('field-sales-agreement','POST',{action:'checkout',operationId:crypto.randomUUID(),kind:'balance'},record.token);
  assert.notEqual(notPaid.status,200,'staging cannot bypass completion/balance gates');
  // Isolated economics setup only; the owner/workflow regressions certify receipt/completion authority.
  const orderId=(await f.db.query('select order_uuid from field_sales_quotes where quote_id=$1',[quote.id])).rows[0].order_uuid;
  await f.db.query("insert into h2s_orders(id,order_id,total,currency,status) values($1,$2,100,'usd','paid')",[orderId,'native-staging-'+quote.id]);
  await f.db.query('insert into field_sales_orders(quote_id,lead_id,order_id) values($1,$2,$3)',[quote.id,leadId,orderId]);
  await f.db.query(`insert into field_sales_checkouts(checkout_id,quote_id,agreement_id,lead_id,kind,amount_cents,policy_snapshot,
    created_by,expires_at,state,captured_cents,processing_fee_cents,processing_fee_evidence)
    select $1,quote_id,agreement_id,lead_id,'full',10000,'{"stagingOnly":true,"productionApproved":false}',$2,now()+interval '1 hour','paid',10000,300,
      '{"reference":"Synthetic independently verified provider fee"}' from field_sales_agreements where quote_id=$3`,
    [crypto.randomUUID(),id(9),quote.id]);
  await f.db.exec('update field_sales_workflow_settings set live_enabled=true');
  const checkoutId=(await f.db.query('select checkout_id from field_sales_checkouts where quote_id=$1',[quote.id])).rows[0].checkout_id;
  await assert.rejects(f.db.query("select field_sales_workflow_bind_mode($1,$2,'live')",[id(9),checkoutId]),/live payment approval disabled/);
  const expenses=[{category:'equipment',quantity:1,unitCents:1500,amountCents:1500,actual:true,evidence:{reference:'Synthetic actual equipment invoice'}},
    {category:'materials',quantity:1,unitCents:500,amountCents:500,actual:true,evidence:{reference:'Synthetic actual material invoice'}}];
  await f.db.query(`update field_sales_workflows set completed_at=now(),completion_operation_id=$2,completion_evidence='{"reference":"Synthetic proof"}',
    completion_proof='{"complete":true}',hours=2,technician_expenses=$3,expenses=$3,costs_complete=true,
    cost_review_evidence='{"reference":"Synthetic reviewed actual costs","actualCostsReviewed":true}',cost_approved_by=$4,cost_approved_at=now(),
    verified_paid_at=now(),fully_paid_event_id='synthetic-staging-final-payment' where quote_id=$1`,
    [quote.id,crypto.randomUUID(),expenses,id(9)]);
  const entry=(await f.db.query('select * from field_sales_earning_entries where quote_id=$1',[quote.id])).rows[0];
  assert.ok(entry,JSON.stringify((await f.db.query('select field_sales_earnings_observe($1) as result',[quote.id])).rows[0].result));
  assert.equal(Number(entry.basis_cents),7700);assert.equal(Number(entry.amount_cents),4235);
  assert.equal(entry.snapshot.policy.status,'staging_only');assert.equal(entry.snapshot.policy.productionApproved,false);
  const runDate=(await f.db.query('select field_sales_earning_run_date(now(),definition)::text as day from field_sales_workflow_policies where policy_id=$1',[policies.settlement])).rows[0].day;
  const run=await f.earningsCommand({action:'create_run',settlementPolicyId:policies.settlement,runDate});
  assert.equal(run.response.status,200,run.result.error);
  const runRow=(await f.db.query('select * from field_sales_earning_runs where run_id=$1',[run.result.runId])).rows[0];
  assert.equal(Number(runRow.amount_cents),4235);assert.equal(runRow.policy_snapshot.stagingOnly,true);assert.equal(runRow.policy_snapshot.productionApproved,false);
  await assert.rejects(f.db.query('update field_sales_earning_entries set amount_cents=1 where entry_id=$1',[entry.entry_id]),/append-only/);
  for(const mutation of [
    `comment on schema ${q(schema)} is '{}'`,
    `comment on schema ${q(storageSchema)} is '{}'`,
    `delete from h2s_test_run`,
    `insert into h2s_test_run values(gen_random_uuid(),'${identity.sourceCommit}','${identity.nativeBaselineFingerprint}')`,
    `update h2s_test_run set source_commit=repeat('c',40)`,
    `alter table h2s_test_run owner to service_role`,
    `alter schema ${q(storageSchema)} owner to service_role`,
    `alter role ${q(role)} login`
  ]){
    await f.db.exec('reset role; begin; '+mutation);
    assert.equal(await usable(f.db),false,mutation);
    await f.db.exec('rollback; set role '+q(role));
  }
  assert.equal(await usable(f.db),true);
});

test('incremental 053 upgrades pre-scope native function definitions with no table replay and preserves later wrappers',{timeout:180000},async t=>{
  const f=await nativeFixture(t);
  const patches=[...sql.matchAll(/src:=pg_get_functiondef\('public\.([^']+\([^']*\))'::regprocedure\);[\s\S]*?replace\(src,\$old\$([\s\S]*?)\$old\$,\$new\$([\s\S]*?)\$new\$\)/g)];
  assert.ok(patches.length>=20);
  const signatures=[...new Set(patches.map(p=>p[1]))];
  for(const signature of signatures){
    let source=(await f.db.query('select pg_get_functiondef($1::regprocedure) as source',[schema+'.'+signature])).rows[0].source;
    for(const patch of patches.filter(p=>p[1]===signature).reverse()){
      const after=retargetSql(patch[3],target),before=retargetSql(patch[2],target);
      if(source.includes(after))source=source.replaceAll(after,before);
    }
    await f.db.exec(source);
  }
  for(const [table,production] of [['field_sales_catalogs','published'],['field_sales_agreement_policies','approved'],['field_sales_workflow_policies','approved']]){
    await f.db.exec(`alter table ${q(table)} drop column "productionApproved",drop column "stagingOnly";
      alter table ${q(table)} drop constraint ${q(table+'_status_check')};
      alter table ${q(table)} add constraint ${q(table+'_status_check')} check(status in ('draft','${production}','retired'));
      alter table ${q(table)} drop constraint ${q(table+'_check')};
      alter table ${q(table)} rename constraint ${q(table+'_check1')} to ${q(table+'_check')};`);
  }
  const legacy=(await f.db.query("select pg_get_functiondef('field_sales_transaction_command_legacy(uuid,uuid,uuid,text,jsonb)'::regprocedure) as source")).rows[0].source;
  assert.ok(legacy.includes("where wf.state='cancelled'"),'existing cancellation-amendment fix retained');
  await f.db.exec(retargetSql(sql,target));
  const upgraded=(await f.db.query("select pg_get_functiondef('field_sales_transaction_command_legacy(uuid,uuid,uuid,text,jsonb)'::regprocedure) as source")).rows[0].source;
  assert.ok(upgraded.includes("where wf.state='cancelled'"));
  assert.ok(upgraded.includes("field_sales_configuration_usable(c.status,'published')"));
  assert.equal((await f.db.query('select count(*)::int as count from field_sales_workflow_policies')).rows[0].count,3);
  const stagedId=crypto.randomUUID();
  await f.db.query(`insert into field_sales_catalogs(catalog_id,version,status,definition,source_evidence)
    values($1,'incremental-staged-version','staging_only',$2,$3)`,
    [stagedId,f.definition,{stagingOnly:true,productionApproved:false,reference:'Incremental authorized native fixture'}]);
  const staged=(await f.db.query('select "productionApproved","stagingOnly" from field_sales_catalogs where catalog_id=$1',[stagedId])).rows[0];
  assert.deepEqual(staged,{productionApproved:false,stagingOnly:true});
  const earnings=(await f.db.query("select pg_get_functiondef('field_sales_earnings_observe(uuid,boolean)'::regprocedure) as source")).rows[0].source;
  assert.equal(earnings.split("field_sales_configuration_usable(status,'approved')").length-1,2);
  await f.db.exec(`create or replace function field_sales_workflow_document_gate(p_quote uuid,p_retrieval boolean default false)
    returns boolean language plpgsql as $$ begin return false; end $$;`);
  await assert.rejects(f.db.exec(retargetSql(sql,target)),/reviewed fragment mismatch/);
  await f.db.exec('rollback');
});

const test=require('node:test'),assert=require('node:assert/strict');
const {createOperationsFixture,functions,id,evaluate}=require('./helpers/commercial_operations_fixture.cjs');

test('existing portal enrichment, assignment/lifecycle grouping and noncommercial payout stay compatible with sparse dispatch',async t=>{
  const f=await createOperationsFixture();t.after(()=>f.db.close());
  const portal=functions('app\\api\\portal_jobs\\route.ts',[
    'ORDERS_SELECT','safeParseJson','toNum','enrichJobsFromOrders','mergeJobAssignment','groupByState',
  ]);
  await f.db.query(`update h2s_orders set service_name='Catalog TV mounting',subtotal=1200,items=$1,
    metadata_json='{"tech_payout_dollars":420,"geo_lat":35,"geo_lng":-80}' where id=$2`,
    [JSON.stringify([{name:'Catalog TV mounting',qty:1}]),id(100)]);
  const raw=(await f.client.from('h2s_dispatch_jobs').select('*').eq('job_id',id(101)).single()).data;
  const merged=portal.mergeJobAssignment(raw,{job_id:id(101),pro_id:id(500),state:'accepted'});
  assert.equal(merged.status,'queued');
  assert.equal(merged.assign_state,'accepted');
  let enriched=await portal.enrichJobsFromOrders(f.client,f.client,[merged]);
  assert.equal(enriched[0].service_name,'Catalog TV mounting');
  assert.equal(enriched[0].service_address,'100 Fixture Lane');
  assert.equal(enriched[0].payout_estimated,420);
  assert.equal(enriched[0].geo_lat,35);
  assert.equal(portal.groupByState(enriched).upcoming.length,1);
  // Existing creation paths support UUID order references as well as display references.
  enriched=await portal.enrichJobsFromOrders(f.client,f.client,[{...merged,order_id:id(100)}]);
  assert.equal(enriched[0].service_name,'Catalog TV mounting');
  assert.equal(portal.groupByState([{...enriched[0],status:'completed'}]).completed.length,1);
  assert.equal(portal.groupByState([{...enriched[0],status:'done'}]).completed.length,1);
  const scheduling=functions('app\\api\\schedule-appointment\\route.ts',['requirePositiveNumber','computeStrictTechPayout','parseTimeLabelTo24Hour','computeStartIsoFromWindow']);
  assert.equal(scheduling.computeStrictTechPayout({subtotal:1200},{}).tech_payout_dollars,420);
  assert.throws(()=>scheduling.computeStrictTechPayout({total:0},{}),/subtotal/);
  assert.ok(Number.isFinite(Date.parse(scheduling.computeStartIsoFromWindow('2099-01-01','10:00 AM - 12:00 PM'))));
  const orchestration=evaluate('lib\\dataOrchestration.ts',{
    '@/lib/supabase':{getSupabase:()=>f.client},
    '@/lib/dispatchSchema':{resolveDispatchSchema:async()=>{
      f.calls.resolver++;
      return {jobsTable:'h2s_dispatch_jobs',jobsIdCol:'job_id'};
    }},
    '@/lib/mail':{sendMail:async()=>{assert.fail('Compatibility fixture must not send mail');}},
  });
  await orchestration.ensureCompletionSideEffects({jobId:id(202),completedAtIso:new Date().toISOString(),actorType:'admin',actorId:id(9)});
  assert.equal(f.calls.resolver,1,'Noncommercial callers still use established schema resolution');
});

test('existing technician completion preserves authentication and assignment ownership boundaries',async t=>{
  const f=await createOperationsFixture();t.after(()=>f.db.close());
  let authenticated=false;
  class AuthError extends Error { constructor(){super('Fixture authentication required');this.status=401;this.code='fixture_auth';} }
  const route=evaluate('app\\api\\portal_mark_done\\route.ts',{
    'next/server':{NextResponse:{json:(data,options)=>Response.json(data,options)}},
    '@/lib/supabase':{getSupabase:()=>f.client,getSupabaseDispatch:()=>f.client},
    '@/lib/adminAuth':{corsHeaders:()=>({})},
    '@/lib/auth':{AuthError,requireAuth:async()=>{if(!authenticated)throw new AuthError();return{sub:id(999)};}},
    '@/lib/config':{getConfig:()=>({buildId:'fixture-only'})},
    '@/lib/dispatchSchema':{resolveDispatchSchema:async()=>({jobsTable:'h2s_dispatch_jobs',jobsIdCol:'job_id',jobsStatusCol:'status',
      assignmentsTable:'h2s_dispatch_job_assignments',assignmentsJobCol:'job_id',assignmentsProCol:'pro_id',assignmentsStateCol:'state'})},
    '@/lib/dataOrchestration':{ensureCompletionSideEffects:async()=>{assert.fail('Unauthorized technician reached completion processing');}},
  });
  const request=()=>new Request('http://fixture.invalid/api/portal_mark_done',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({job_id:id(101)})});
  assert.equal((await route.POST(request())).status,401);
  authenticated=true;
  assert.equal((await route.POST(request())).status,403);
  assert.equal((await f.db.query('select status from h2s_dispatch_jobs where job_id=$1',[id(101)])).rows[0].status,'queued');
});

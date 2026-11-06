const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const{evaluate}=require('./helpers/commercial_operations_fixture.cjs');
function fixture(faults={}){
  const rows=[],calls={uploads:0,signed:0,inserts:0},run='c6316381-64f5-4b67-b41f-41711416cdcc';
  const origin='https://nkccbnrduojnzjfrpwva.supabase.co';
  const sb={storage:{from(bucket){assert.equal(bucket,'h2s-job-artifacts');return{
    async upload(){calls.uploads++;return{error:faults.upload?{statusCode:503}:null};},
    async createSignedUrl(){calls.signed++;return faults.sign?{error:{statusCode:503}}:{data:{signedUrl:'https://private.fixture/signed/'+calls.signed}};}
  };}},from(table){
    let inserted=null;const q={select(){return q;},eq(){return q;},order(){return q;},
      insert(row){calls.inserts++;inserted=row;return q;},
      async maybeSingle(){if(inserted){if(faults.insert)return{error:{message:'native insertion denied'}};
        rows.push(inserted);return{data:inserted};}return{data:{job_id:'synthetic-job'}};},
      async limit(){if(table==='assignments')return{data:[{pro_id:'synthetic-pro'}]};
        return faults.table?{error:{code:'42501'}}:{data:rows};}
    };return q;
  }};
  const module=evaluate('lib\\portalArtifacts.ts',{'@/lib/dispatchSchema':{
    resolveDispatchSchema:async()=>({jobsTable:'jobs',jobsIdCol:'job_id',assignmentsTable:'assignments',
      assignmentsJobCol:'job_id',assignmentsProCol:'pro_id'})
  }},{Buffer,crypto:crypto.webcrypto,process:{env:{H2S_STAGING_SANDBOX_RUN_ID:run,SUPABASE_URL:origin}},
    console:{error(){},warn(){},log(){}}});
  const actor={role:'pro',sub:'synthetic-pro'},input={job_id:'synthetic-job',type:'photo',
    data:Buffer.from('synthetic-proof-only').toString('base64'),filename:'fixture.png',mimetype:'image/png'};
  return{module,sb,actor,input,rows,calls,run,origin};
}
test('private proof persists installer attribution and renews authorized reads without storing expiring URLs',async()=>{
  const f=fixture(),created=await f.module.addArtifact(f.sb,f.actor,f.input);
  assert.equal(created.ok,true);assert.equal(f.rows[0].pro_id,f.actor.sub);
  assert.ok(f.rows[0].url.startsWith(f.origin+'/storage/v1/object/authenticated/h2s-test-'+f.run+'-proof/'));
  const first=await f.module.getArtifacts(f.sb,f.actor,{job_id:f.input.job_id});
  const next=await f.module.getArtifacts(f.sb,f.actor,{job_id:f.input.job_id});
  assert.equal(first.ok,true);assert.equal(first.artifacts.length,1);assert.equal(next.ok,true);
  assert.notEqual(first.artifacts[0].storage_url,next.artifacts[0].storage_url);
  assert.equal(f.calls.uploads,1);assert.equal(f.calls.inserts,1);
});
for(const fault of ['upload','sign','insert','table'])test('private '+fault+' failure cannot create a success-shaped proof or legacy fallback',async()=>{
  const f=fixture({[fault]:true}),result=await f.module.addArtifact(f.sb,f.actor,f.input);
  assert.equal(result.ok,false);assert.equal(result.error_code,'storage_unavailable');assert.equal(f.rows.length,0);
});
test('private read fails explicitly on expired/unavailable renewal and refuses a different run/bucket',async()=>{
  const f=fixture();assert.equal((await f.module.addArtifact(f.sb,f.actor,f.input)).ok,true);
  f.rows[0].url=f.origin+'/storage/v1/object/authenticated/another-run/fixture.png';
  assert.equal((await f.module.getArtifacts(f.sb,f.actor,{job_id:f.input.job_id})).ok,false);
  const denied=fixture({sign:true});denied.rows.push({job_id:'synthetic-job',
    url:denied.origin+'/storage/v1/object/authenticated/h2s-test-'+denied.run+'-proof/fixture.png'});
  assert.equal((await denied.module.getArtifacts(denied.sb,denied.actor,{job_id:'synthetic-job'})).ok,false);
});

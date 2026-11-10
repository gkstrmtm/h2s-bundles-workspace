const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
const {createWorkflowFixture,id}=require('./helpers/field_workflow_fixture.cjs');
const settle=async()=>{for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));};
async function ui(t,data,response){
  const dom=new JSDOM('<section class="pane active"><div id="orders"></div></section>',{url:'https://fixture.invalid',runScripts:'outside-only'});
  t.after(()=>dom.window.close());const w=dom.window,calls=[],root=w.document.getElementById('orders');
  w.crypto.randomUUID=require('node:crypto').randomUUID;w.console.error=()=>{};
  w.fetch=async(_url,options)=>{
    if(options.method==='POST'){calls.push(JSON.parse(options.body));return Response.json(response.body,{status:response.status});}
    return Response.json(data);
  };
  w.eval(fs.readFileSync(path.join(__dirname,'..','..','frontend','field-workflow.js'),'utf8'));
  w.H2SFieldWorkflow.mount(root,{apiBase:'https://fixture.invalid',getSession:()=>({token:'synthetic-admin',role:'ADMIN'})});
  await settle();
  const form=root.querySelector('[data-workflow-form="schedule"]');assert.ok(form);
  assert.equal(form.querySelector('[type="submit"]').disabled,true,'Authoritative hold remains disabled');
  form.elements.start.value='2099-01-05T10:00';form.elements.end.value='2099-01-05T12:00';
  form.elements.timezone.value='America/New_York';form.elements.customerAgreed.checked=true;
  form.elements.reason.value='Preserve customer-requested appointment inputs';
  // Exercise a stale or manipulated client; the server response must still block it.
  form.querySelector('[type="submit"]').disabled=false;
  form.dispatchEvent(new w.SubmitEvent('submit',{bubbles:true,cancelable:true}));
  await settle();return {w,root,form,calls};
}
test('verified installation readiness holds are business conflicts without changing cancellation or financial authorities',async t=>{
  const f=await createWorkflowFixture();t.after(()=>f.db.close());
  f.legalDefinition.cancellationCalendar.businessDays=3;
  await f.enable();const record=await f.enrolled(),accepted=await f.accept(await f.documents(record));
  await f.collect(accepted);
  const data=await(await f.read(record.leadId)).json(),w=data.workflows[0];
  assert.ok(Date.parse(w.cancellationDeadline)>Date.now());
  assert.equal(w.netPaidCents,w.depositCents,'Verified deposit isolates the cancellation hold');
  assert.equal(w.gates.canSchedule,false);assert.equal(w.gates.canAssign,false);
  const before=JSON.stringify(w),earliest=new Date(w.cancellationDeadline).toISOString();
  const commands=[
    {action:'schedule',reservationRevision:0,start:'2099-01-05T15:00:00Z',end:'2099-01-05T17:00:00Z',timezone:'America/New_York',customerAgreed:true,reason:'Synthetic appointment'},
    {action:'reschedule',reservationRevision:0,start:'2099-01-05T15:00:00Z',end:'2099-01-05T17:00:00Z',timezone:'America/New_York',customerAgreed:true,reason:'Synthetic appointment'},
    {action:'preparation',preparationRevision:0,scopeReviewed:true,materials:'ready',access:'ready',blockers:'',note:'Synthetic preparation'},
    {action:'assign',proId:id(500),context:'0'.repeat(32),note:'Synthetic assignment'}
  ];
  for(const command of commands)await t.test(command.action+' returns 409 and the exact verified deadline',async()=>{
    const response=await f.admin({...record,revision:w.revision,...command}),body=await response.json();
    assert.equal(response.status,409);assert.equal(body.ok,false);
    assert.equal(body.code,'INSTALLATION_CANCELLATION_HOLD');assert.equal(body.earliestSchedulingAt,earliest);
    assert.match(body.error,/customer's cancellation period/);assert.match(body.error,/all other requirements/);
    assert.equal(response.headers.get('cache-control'),'private, no-store');
    assert.equal(JSON.stringify((await(await f.read(record.leadId)).json()).workflows[0]),before);
  });
  const original=f.client.rpc,body={...record,revision:w.revision,...commands[0]};
  await t.test('date is omitted for unresolved, expired, invalid or cancelled agreement facts',async()=>{
    for(const override of [{acceptedAt:null},{cancellationDeadline:null},{cancellationDeadline:'not-a-date'},
      {acceptedAt:'2099-01-01T00:00:00Z'},{cancellationDeadline:new Date(Date.now()-60000).toISOString()},
      {state:'cancelled'},{state:'refund_review'},{holds:[]},{gates:{...w.gates,canSchedule:true}}]){
      f.client.rpc=async(name,args)=>{
        const result=await original(name,args);
        return name==='field_sales_workflow_read'&&!result.error?{...result,data:{...result.data,
          workflows:result.data.workflows.map(row=>({...row,...override}))}}:result;
      };
      const response=await f.admin(body),result=await response.json();
      assert.equal(response.status,409);assert.equal(result.code,'INSTALLATION_NOT_READY');assert.equal(result.earliestSchedulingAt,null);
      assert.match(result.error,/verified 25% deposit/);
    }
    f.client.rpc=original;
  });
  await t.test('storage failures and unrelated prerequisite errors remain 503 without invented dates',async()=>{
    for(const fault of [
      {name:'field_sales_workflow_read',code:'42P01',message:'Missing authoritative fixture storage'},
      {name:'field_sales_workflow_command',code:'55000',message:'Unrelated portal authority unavailable'}
    ]){
      f.client.rpc=async(name,args)=>name===fault.name?{data:null,error:{code:fault.code,message:fault.message}}:original(name,args);
      const response=await f.admin(body),result=await response.json();
      assert.equal(response.status,503);assert.equal(result.ok,false);
      assert.equal(Object.hasOwn(result,'earliestSchedulingAt'),false);assert.equal(Object.hasOwn(result,'code'),false);
    }
    f.client.rpc=original;
  });
  await t.test('stale revisions, unauthorized actors and client-supplied deadline fields retain existing rejection',async()=>{
    assert.equal((await f.admin({...body,revision:w.revision+1})).status,409);
    assert.equal((await f.admin(body,'a')).status,403);
    assert.equal((await f.admin({...body,earliestSchedulingAt:'2099-01-01T00:00:00Z'})).status,400);
    assert.equal(JSON.stringify((await(await f.read(record.leadId)).json()).workflows[0]),before);
  });
  await t.test('frontend explains the verified hold, retains inputs and does not label it an interrupted write',async st=>{
    const f=await ui(st,data,{status:409,body:{ok:false,code:'INSTALLATION_CANCELLATION_HOLD',
      error:"Installation cannot be scheduled during the customer's cancellation period.",earliestSchedulingAt:earliest}});
    assert.match(f.root.textContent,/Earliest possible scheduling/);
    assert.match(f.root.textContent,/A verified deposit and all other requirements/);
    const status=f.root.querySelector('[data-workflow-status]');
    assert.equal(status.getAttribute('role'),'alert');assert.match(status.textContent,/No installation action was recorded/);
    assert.doesNotMatch(status.textContent,/interrupted/);assert.doesNotMatch(status.textContent,/Invalid Date/);
    assert.equal(f.form.elements.reason.value,'Preserve customer-requested appointment inputs');
    assert.equal(f.form.querySelector('[type="submit"]').disabled,true);
    assert.equal(f.root.querySelector('[data-workflow-retry]'),null);
    assert.equal(f.root.querySelector('[data-workflow-refresh]').textContent,'Refresh order');
    assert.equal(f.calls.length,1);
  });
  await t.test('frontend never displays an unverified response date as an earliest appointment',async st=>{
    const f=await ui(st,data,{status:409,body:{ok:false,code:'INSTALLATION_CANCELLATION_HOLD',error:'Cancellation period remains active.',earliestSchedulingAt:'bad'}});
    const status=f.root.querySelector('[data-workflow-status]');
    assert.match(status.textContent,/earliest scheduling date could not be verified/);assert.doesNotMatch(status.textContent,/Invalid Date/);
  });
  await t.test('uncertain storage failures keep identical-operation retries',async st=>{
    const f=await ui(st,data,{status:503,body:{ok:false,error:'Storage unavailable; operation outcome not verified.'}});
    assert.match(f.root.querySelector('[data-workflow-status]').textContent,/exact interrupted operation is retained/);
    f.root.querySelector('[data-workflow-retry]').click();await settle();
    assert.equal(f.calls.length,2);assert.deepEqual(f.calls[1],f.calls[0]);
    assert.equal(f.form.elements.reason.value,'Preserve customer-requested appointment inputs');
  });
});

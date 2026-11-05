const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {JSDOM}=require('jsdom'),{baseOffer}=require('./helpers/field_commerce_fixture.cjs');
const source=name=>fs.readFileSync(path.join(__dirname,'..','..','frontend',name),'utf8');
const settle=async()=>{for(let n=0;n<8;n++)await new Promise(r=>setImmediate(r));};
const snapshot=()=>({catalogVersion:'fixture-v1',pricingStatus:'published',customer:{name:'<img src=x>',address:'100 Fixture Lane',city:'Fixture',phone:'555',market:'residential'},
  totalCents:10000,approvalReasons:[],lines:[{service:'Fixture service',description:'Fixture offer',quantity:1,baseCents:10000,totalCents:10000,equipment:['Fixture equipment'],scope:['Fixture scope'],exclusions:['Fixture exclusion'],addOns:[],answers:{size:50},answerLabels:{size:'Exact fixture size'}}]});
function fixture(t,role='SALES'){
  const dom=new JSDOM('<div class="field-sales"><div data-market="residential" id="root"></div></div>',{runScripts:'outside-only',url:'https://fixture.invalid'});
  t.after(()=>dom.window.close());const w=dom.window,calls=[],root=w.document.getElementById('root');
  let actor={token:'fixture',role},respond,opened;
  const data={ok:true,enabled:true,catalogs:[{catalog_id:'catalog',version:'fixture-v1',status:'published',definition:{services:[
    {id:'future',label:'Future configurable service',markets:['residential','commercial'],offers:[baseOffer()]},
    {id:'commercial',label:'Commercial only',markets:['commercial'],offers:[baseOffer()]}]}}],
    quotes:[],payments:[],orders:[],agreements:[],policyReady:false,depositConfigured:false};
  w.crypto.randomUUID=crypto.randomUUID;w.console.error=()=>{};
  w.fetch=async(url,init)=>{calls.push({url,init,body:init.body&&JSON.parse(init.body)});return respond?respond(url,init):Response.json(data);};
  w.eval(source('field-commerce.js'));
  const mount=(leadId='lead')=>w.H2SFieldCommerce.mount(root,{apiBase:'https://fixture.invalid',getSession:()=>actor,leadId,openLead:id=>opened=id,onSessionEnded:()=>w.H2SFieldCommerce.reset()});
  const click=sel=>{const el=root.querySelector(sel);assert.ok(el,sel);el.click();};
  return {w,root,calls,data,mount,click,respond:fn=>respond=fn,setActor:a=>actor=a,get opened(){return opened;}};
}
test('default-off UI reads once, never auto-posts; VA cannot fetch private transaction data',async t=>{
  const f=fixture(t);f.data.enabled=false;f.mount();await settle();assert.match(f.root.textContent,/disabled/);assert.equal(f.calls.length,1);assert.equal(f.root.querySelector('form'),null);
  f.setActor({token:'va',role:'VA'});f.mount();await settle();assert.equal(f.calls.length,1);
});
test('generic configured quote form preserves added lines, filters market, submits no prices and retains uncertain retry',async t=>{
  const f=fixture(t);f.mount();await settle();assert.doesNotMatch(f.root.textContent,/Commercial only/);
  f.root.querySelector('[name="quantity"]').value='3';f.root.querySelector('[data-q="size"]').value='50';
  f.click('[data-commerce-add]');assert.equal(f.root.querySelector('[name="quantity"]').value,'3');assert.equal(f.root.querySelectorAll('[data-commerce-line]').length,2);
  f.click('[data-commerce-remove]');assert.equal(f.root.querySelectorAll('[data-commerce-line]').length,1);
  f.respond(async()=>{throw Error('Synthetic interrupted request');});
  const submit=()=>f.root.querySelector('[data-commerce-create]').dispatchEvent(new f.w.SubmitEvent('submit',{bubbles:true,cancelable:true}));
  submit();await settle();const first=f.calls.at(-1).body;assert.equal(first.lines[0].serviceId,'future');
  assert.deepEqual(Object.keys(first.lines[0]).sort(),['answers','exceptionNote','offerId','options','quantity','serviceId']);
  f.root.querySelector('[name="quantity"]').value='5';submit();await settle();assert.deepEqual(f.calls.at(-1).body,first);assert.match(f.root.querySelector('[role="alert"]').textContent,/interrupted/);
});
test('immutable review, management overview, disabled deposit and exact agreement/order information',async t=>{
  const f=fixture(t,'ADMIN');f.data.quotes=[{quote_id:'quote',lead_id:'lead',revision:2,state:'approved',quote_hash:'hash',attributed_user_id:'rep',snapshot:snapshot(),expires_at:'2099-01-01'}];
  f.data.agreements=[{quote_id:'quote',accepted_at:'2026-01-01'}];f.data.policyReady=true;
  f.data.orders=[{quote_id:'quote',order_reference:'FS-fixture',status:'field_sales_management_review'}];f.mount();await settle();
  assert.equal(f.root.querySelector('img'),null);assert.match(f.root.textContent,/\$100\.00/);assert.match(f.root.textContent,/FS-fixture/);
  assert.equal(f.root.querySelector('[data-commerce-checkout="deposit"]').disabled,true);
  assert.match(f.root.textContent,/Acceptance is not payment confirmation/);
  assert.match(f.root.textContent,/No automatic technician assignment/);
  assert.match(f.root.querySelector('[data-commerce-review] .field-sales__badge').textContent,/^Approved$/);
  assert.equal(f.calls.some(call=>call.body),false,'Review must not initiate payment or assignment');
  const audit=[...f.root.querySelectorAll('details')].find(el=>el.querySelector('summary')?.textContent==='Order audit reference');
  assert.ok(audit);assert.equal(audit.open,false);assert.match(audit.textContent,/FS-fixture/);
  f.mount(null);await settle();assert.match(f.root.textContent,/Historical revisions are not separate sales/);f.click('[data-commerce-lead]');assert.equal(f.opened,'lead');
});
test('late private responses are discarded after account change/reset',async t=>{
  const f=fixture(t);let done;f.respond(async()=>({status:200,ok:true,json:()=>new Promise(r=>done=r)}));f.mount();await settle();
  f.w.H2SFieldCommerce.reset();f.setActor({token:'other',role:'SALES'});done(f.data);await settle();assert.equal(f.root.children.length,0);
});
test('successful immutable revision actions select the new revision instead of retaining a stale draft',async t=>{
  const f=fixture(t),old={quote_id:'old',lead_id:'lead',revision:1,state:'draft',quote_hash:'hash',snapshot:snapshot(),expires_at:null};
  f.data.quotes=[old];f.mount();await settle();
  f.respond(async(url,init)=>{if(init.method==='POST'){f.data.quotes=[{...old,quote_id:'new',revision:2,state:'pending_approval'},old];return Response.json({ok:true,id:'new'});}return Response.json(f.data);});
  f.click('[data-commerce-submit]');await settle();
  assert.equal(f.root.querySelector('[data-commerce-review] h4').textContent,'Quote revision 2');
  assert.equal(f.root.querySelector('[data-commerce-review] .field-sales__badge').textContent,'Awaiting approval');
  assert.doesNotMatch(f.root.querySelector('[data-commerce-review]').textContent,/pending_approval|Quote revision 1/);
  const submitted=f.calls.find(call=>call.body).body;
  assert.equal(submitted.action,'submit');assert.equal(submitted.quoteId,'old');assert.equal(submitted.leadId,'lead');assert.ok(submitted.operationId);
  assert.equal(submitted.amountCents,undefined);assert.equal(submitted.totalCents,undefined);
  assert.equal(f.root.querySelector('[data-commerce-submit]'),null);
});
test('customer fragment is removed, exact quote/policy accepted without payment assertion or token persistence',async t=>{
  const dom=new JSDOM(source('field-agreement.html'),{runScripts:'outside-only',url:'https://fixture.invalid/field-agreement.html#token='+'a'.repeat(64)});t.after(()=>dom.window.close());
  const w=dom.window,calls=[];w.crypto.randomUUID=crypto.randomUUID;w.console.error=()=>{};
  const facts={ok:true,quote:{quote_id:'quote',quote_hash:'hash',revision:2,snapshot:snapshot(),expires_at:'2099-01-01'},
    agreement:{accepted_at:null,policy_snapshot:{version:'fixture-legal',terms:'Synthetic terms',payment_terms:'Synthetic payment',cancellation_information:'Synthetic notice',electronic_delivery:'Synthetic delivery',paymentPlan:{fullCents:10000,depositCents:4000,remainingAfterDepositCents:6000}}}};
  w.fetch=async(url,init)=>{calls.push({url,init,body:init.body&&JSON.parse(init.body)});if(init.method==='POST')facts.agreement={...facts.agreement,accepted_at:'2026-01-01',acceptance:{name:'Fixture customer'}};return Response.json(facts);};
  w.eval(source('field-agreement.js'));assert.equal(w.location.hash,'');await settle();assert.equal(w.document.querySelector('img'),null);
  const form=w.document.querySelector('form');form.elements.name.value='Fixture customer';form.elements.email.value='fixture@example.invalid';form.elements.accepted.checked=form.elements.electronicDelivery.checked=true;
  form.dispatchEvent(new w.SubmitEvent('submit',{bubbles:true,cancelable:true}));await settle();
  assert.equal(calls[1].body.quoteHash,'hash');assert.equal(calls[1].body.policyVersion,'fixture-legal');
  assert.equal(calls[0].url.includes('token'),false);assert.equal(w.localStorage.length,0);assert.match(w.document.body.textContent,/not a payment receipt/);
  assert.match(w.document.body.textContent,/Exact fixture size: 50/);assert.match(w.document.body.textContent,/Approved optional deposit: \$40\.00; remaining balance: \$60\.00/);
  w.dispatchEvent(new w.Event('pagehide'));assert.equal(w.document.querySelector('[data-agreement-content]').children.length,0);
});
test('checkout redirect is never presented as proof of payment and performs no API request',t=>{
  const dom=new JSDOM(source('field-agreement.html'),{runScripts:'outside-only',url:'https://fixture.invalid/field-agreement.html#checkout-returned'});t.after(()=>dom.window.close());
  dom.window.fetch=()=>{throw Error('Unexpected request');};dom.window.eval(source('field-agreement.js'));
  assert.match(dom.window.document.body.textContent,/does not verify payment/);assert.equal(dom.window.document.querySelector('form'),null);
});

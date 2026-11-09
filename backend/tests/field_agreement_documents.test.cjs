const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
const {evaluate}=require('./helpers/commercial_operations_fixture.cjs');
const historicalTemplate=require('../lib/customerAgreement.v1.json');
const template=require('../lib/customerAgreement.nc.v1.json');
class BusinessError extends Error { constructor(message,status=400){super(message);this.status=status;} }
const engine=evaluate('lib\\fieldAgreement.ts',{'node:crypto':crypto,'@/lib/customerAgreement.v1.json':historicalTemplate,
  '@/lib/customerAgreement.nc.v1.json':template,'@/lib/commercial_business':{BusinessError}});
const snapshot={customer:{name:'Synthetic Customer',address:'100 Synthetic Example Lane',city:'Charlotte',state:'NC',salesChannel:'door_to_door',market:'residential'},totalCents:19900,
  lines:[{service:'TV mounting',description:'56-65 inch TV with standard fixed ONN mount',quantity:1,baseCents:19900,totalCents:19900,addOns:[],
    equipment:['ONN fixed mount','Included installation materials'],scope:['Mount customer-owned TV'],exclusions:['Unapproved additional work']}]};
const presentation=()=>({language:'en',oralNoticeEvidence:'SYNTHETIC English presentation and oral cancellation notice fixture',
  territory:{state:'NC',municipality:'Charlotte',verifiedAddress:snapshot.customer.address,addressEvidence:'SYNTHETIC jurisdiction review, not a real parcel verification',
    permitReviewEvidence:'SYNTHETIC permit review only; no real solicitation authorized',solicitationAuthorized:true,syntheticOnly:true}});
function facts(){
  const artifacts=engine.prepareAgreementArtifacts(snapshot,{name:'SYNTHETIC HOME2SMART ONLY',mailingAddress:'100 Fictional Example Lane, Charlotte NC 28202 (TEST ONLY)',phone:'864-387-8413'},
    presentation());
  return {quote:{quote_id:'00000000-0000-4000-8000-000000000001',quote_hash:'a'.repeat(64),revision:1,snapshot},
    agreement:{accepted_at:null,policy_snapshot:{version:'synthetic-legal-v1',paymentPlan:{depositCents:4975,remainingAfterDepositCents:14925}}},
    workflow:{documents:artifacts,originalArtifactHashes:artifacts.map((_,i)=>String(i).repeat(64)),reviewDate:'2026-11-08',
      cancellationPreviewDeadline:'2026-11-13T05:00:00Z',netPaidCents:0,gates:{canDeposit:false}}};
}
function body(value){
  return {operationId:crypto.randomUUID(),name:'Synthetic Customer',email:'synthetic@example.invalid',quoteHash:value.quote.quote_hash,
    policyVersion:value.agreement.policy_snapshot.version,accepted:true,electronicDelivery:true,agreementAccepted:true,
    cancellationNoticeReceived:true,electronicRecordsConsent:true,signatureIntent:true,signatureIntentText:template.signatureIntent,
    reviewedBundleHash:value.workflow.reviewedBundleHash,reviewDate:value.workflow.reviewDate,
    accessCode:value.workflow.reviewedBundleHash.slice(0,8).toUpperCase()};
}
test('dated exact quote, four versioned documents and statutory duplicate notices are complete and independently hashed',()=>{
  const output=engine.withCustomerDocuments(facts()),docs=output.workflow.reviewDocuments;
  assert.equal(docs.length,4);assert.equal(docs.filter(d=>d.kind==='notice').length,2);
  assert.match(docs[0].text,/\$199\.00/);assert.match(docs[0].text,/\$49\.75/);assert.match(docs[0].text,/\$149\.25/);
  assert.match(docs[0].text,/ONN fixed mount/);assert.match(docs[0].text,/1-Year Workmanship Guarantee/);
  assert.match(docs[0].text,/NORTH CAROLINA/);assert.doesNotMatch(docs[0].text,/SOUTH CAROLINA|Greenville SC/);
  assert.match(docs[0].text,/Installation location: 100 Synthetic Example Lane, Charlotte, NC/);
  assert.ok(docs[0].text.includes(template.sections.find(s=>s.title==='1-Year Workmanship Guarantee').text));
  assert.match(docs[0].html,/<p class="notice">You, the buyer, may cancel this transaction/);
  for(const doc of docs){assert.equal(doc.contentHash,crypto.createHash('sha256').update(doc.html).digest('hex'));assert.doesNotMatch(doc.html,/\{\{[A-Z_]+\}\}/);}
  for(const notice of docs.filter(d=>d.kind==='notice')){
    assert.match(notice.text,/November 12, 2026/);assert.match(notice.text,/Buyer's signature: _/);
    assert.match(notice.html,/font-size:12pt;font-weight:700/);assert.match(notice.text,/TEN BUSINESS DAYS/);
  }
  assert.match(output.workflow.accessDemonstrationHtml,new RegExp(output.workflow.reviewedBundleHash.slice(0,8).toUpperCase()));
});
test('no assumed seller, language, eligibility or production document approval; legacy new acceptance remains blocked',()=>{
  const missing=facts();missing.workflow.documents[1].content.seller.mailingAddress=null;
  assert.throws(()=>engine.withCustomerDocuments(missing),/Seller mailing address/);
  const language=facts();language.workflow.documents[1].content.sale.oralPresentationLanguage='es';
  assert.throws(()=>engine.withCustomerDocuments(language),/legal eligibility|language/);
  const production=facts();production.workflow.documents[1].content.status='approved';
  assert.throws(()=>engine.withCustomerDocuments(production),/legal eligibility/);
  const legacy=facts();delete legacy.workflow;
  const value=engine.withCustomerDocuments(legacy);assert.equal(value.signatureRequired,true);
  assert.throws(()=>engine.acceptanceEvidence(body({quote:legacy.quote,agreement:legacy.agreement,workflow:{reviewedBundleHash:'0'.repeat(64),reviewDate:'2026-11-08'}}),value,new Request('https://fixture.invalid')),/unavailable/);
});
test('server evidence rejects every omitted acknowledgment, intent, access demonstration and stale bundle/date',()=>{
  const value=engine.withCustomerDocuments(facts()),payload=body(value),request=new Request('https://fixture.invalid',{headers:{'user-agent':'Synthetic browser'}});
  const accepted=engine.acceptanceEvidence(payload,value,request);
  assert.equal(accepted.acceptedDocuments.length,4);assert.equal(accepted.acknowledgments.length,4);
  assert.equal(accepted.requestMetadata.userAgent,'Synthetic browser');assert.equal(accepted.requestMetadata.authenticatedCustomerLink,true);
  for(const key of ['accepted','electronicDelivery','agreementAccepted','cancellationNoticeReceived','electronicRecordsConsent','signatureIntent'])
    assert.throws(()=>engine.acceptanceEvidence({...payload,[key]:false},value,request),/acknowledgment|signature/);
  assert.throws(()=>engine.acceptanceEvidence({...payload,signatureIntentText:'Not signing'},value,request),/intent/);
  assert.throws(()=>engine.acceptanceEvidence({...payload,accessCode:'00000000'},value,request),/demonstration/);
  assert.throws(()=>engine.acceptanceEvidence({...payload,reviewedBundleHash:'0'.repeat(64)},value,request),/changed/);
  assert.throws(()=>engine.acceptanceEvidence({...payload,reviewDate:'2026-11-07'},value,request),/changed/);
  assert.throws(()=>engine.acceptanceEvidence({...payload,name:'Synthetic'},value,request),/full signature name/);
});
test('quote content is escaped rather than executed in portable copies',()=>{
  const value=facts();value.quote.snapshot={...snapshot,customer:{...snapshot.customer,name:'<script>alert(1)</script>'}};
  const doc=engine.withCustomerDocuments(value).workflow.reviewDocuments[0];
  assert.doesNotMatch(doc.html,/<script>/);assert.match(doc.html,/&lt;script&gt;/);
});
test('NC conservative extension excludes weekends and federal actual/observed holidays without claiming a settled state-law definition',()=>{
  const calendar=engine.customerCancellationCalendar(2026);
  assert.deepEqual(Array.from(calendar.excludedWeekdays),[6,7]);assert.equal(calendar.businessDays,3);
  assert.match(calendar.convention,/voluntarily extends the FTC minimum/);
  for(const holiday of ['2026-11-11','2026-11-26','2026-06-19','2026-07-03','2026-07-04'])assert.ok(calendar.holidays.includes(holiday),holiday);
  assert.ok(!calendar.holidays.includes('2026-11-14'),'Ordinary Saturday is excluded as a weekday, not invented as a federal holiday');
});
test('existing policy preparation links frozen customer wording, duplicate notices and nonwaived cancellation calendar',()=>{
  const prepared=engine.customerAgreementPreparation(snapshot,
    {name:'SYNTHETIC SELLER',mailingAddress:'100 Fictional Lane, Charlotte NC 28202',phone:'864-387-8413'},
    presentation(),2026);
  assert.equal(prepared.productionApproved,false);
  assert.equal(prepared.agreementPolicy.status,'staging_only');
  assert.equal(prepared.agreementPolicy.customer_document.protocol,template.protocol);
  assert.equal(prepared.requiredNotices.length,3);
  assert.equal(prepared.cancellationCalendar.businessDays,3);
});
test('NC preparation requires explicit matching state, address and independent synthetic permit review',()=>{
  const seller={name:'SYNTHETIC SELLER',mailingAddress:'100 Fictional Lane, Charlotte NC 28202',phone:'555-0100'};
  for(const customer of [{...snapshot.customer,state:'SC'},{...snapshot.customer,state:undefined},{...snapshot.customer,city:'Fort Mill'},
    {...snapshot.customer,address:'Another address'}])
    assert.throws(()=>engine.prepareAgreementArtifacts({...snapshot,customer},seller,presentation()),/verified NC territory/);
  for(const changed of [{state:'SC'},{municipality:'Greenville'},{syntheticOnly:false},{solicitationAuthorized:false},{addressEvidence:''},{permitReviewEvidence:''}])
    assert.throws(()=>engine.prepareAgreementArtifacts(snapshot,seller,{...presentation(),territory:{...presentation().territory,...changed}}),/territory|Territory|solicitation/);
  assert.equal(template.sections.find(s=>s.title==='1-Year Workmanship Guarantee').text,
    historicalTemplate.sections.find(s=>s.title==='1-Year Workmanship Guarantee').text);
});
test('executed SC documents return exact retained evidence before applying current NC eligibility',()=>{
  const historical={quote:{snapshot:{customer:{state:'SC'}}},agreement:{accepted_at:'2026-11-08T20:00:00Z',
    acceptance:{protocol:historicalTemplate.protocol}},workflow:{acceptedDocuments:[{contentHash:'a'.repeat(64),html:'EXACT EXECUTED SC COPY'}]}};
  const before=JSON.stringify(historical);
  const result=engine.withCustomerDocuments(historical);
  assert.equal(result.signatureRequired,false);assert.equal(JSON.stringify(historical),before);
  assert.equal(result.workflow.acceptedDocuments[0].html,'EXACT EXECUTED SC COPY');
});
const settle=async()=>{for(let i=0;i<8;i++)await new Promise(r=>setImmediate(r));};
test('agreement download selects the exact agreement when retained documents arrive in a different order',async t=>{
  const value=engine.withCustomerDocuments(facts()),docs=value.workflow.reviewDocuments;
  value.agreement.accepted_at='2026-11-08T20:00:00Z';
  value.agreement.acceptance={name:'Synthetic Customer',signatureIntentText:template.signatureIntent};
  value.workflow.acceptedDocuments=[docs[3],docs[0],docs[1],docs[2]].map(doc=>({...doc,content:{html:doc.html,version:doc.version,contentHash:doc.contentHash}}));
  const html=fs.readFileSync(path.join(__dirname,'..','..','frontend','field-agreement.html'),'utf8');
  const dom=new JSDOM(html,{url:'https://fixture.invalid/field-agreement.html#token='+'a'.repeat(64),runScripts:'outside-only'});
  t.after(()=>dom.window.close());const w=dom.window,downloaded=[];
  w.fetch=async()=>Response.json({ok:true,...value});
  w.Blob=class {constructor(parts){this.html=parts[0];}};
  w.URL.createObjectURL=blob=>{downloaded.push(blob.html);return 'blob:fixture';};w.URL.revokeObjectURL=()=>{};
  w.HTMLAnchorElement.prototype.click=()=>{};
  w.eval(fs.readFileSync(path.join(__dirname,'..','..','frontend','field-agreement.js'),'utf8'));await settle();
  const button=w.document.querySelector('.agreement-document [data-customer-document]');
  assert.equal(button.dataset.customerDocument,'1');button.click();
  assert.equal(downloaded[0],docs[0].html);
});
test('customer UI retains separate unchecked acknowledgments, accessible review end and explicit signature; no automatic checkout',async t=>{
  const value=engine.withCustomerDocuments(facts()),html=fs.readFileSync(path.join(__dirname,'..','..','frontend','field-agreement.html'),'utf8');
  const dom=new JSDOM(html,{url:'https://fixture.invalid/field-agreement.html#token='+'a'.repeat(64),runScripts:'outside-only'});
  t.after(()=>dom.window.close());const w=dom.window,calls=[],observers=[];
  w.crypto.randomUUID=crypto.randomUUID;w.URL.createObjectURL=()=> 'blob:fixture';w.URL.revokeObjectURL=()=>{};
  w.IntersectionObserver=class {constructor(callback){this.callback=callback;observers.push(this);} observe(){} disconnect(){}};
  w.fetch=async(url,init)=>{calls.push(init);return Response.json({ok:true,...value});};
  w.eval(fs.readFileSync(path.join(__dirname,'..','..','frontend','field-agreement.js'),'utf8'));await settle();
  const form=w.document.querySelector('[data-agreement-accept]');assert.ok(form);
  assert.equal(form.querySelectorAll('input[type="checkbox"]').length,4);
  for(const checkbox of form.querySelectorAll('input[type="checkbox"]'))assert.equal(checkbox.checked,false);
  assert.equal(form.querySelector('[type="submit"]').disabled,true);
  assert.equal(w.document.querySelectorAll('.agreement-cancellation').length,2);
  assert.match(w.document.body.textContent,/does not prove every word was read/);
  form.elements.name.value='Synthetic Customer';form.elements.email.value='synthetic@example.invalid';
  form.elements.accessCode.value=value.workflow.reviewedBundleHash.slice(0,8);
  for(const checkbox of form.querySelectorAll('input[type="checkbox"]'))checkbox.checked=true;
  form.dispatchEvent(new w.Event('change',{bubbles:true}));
  assert.equal(form.querySelector('[type="submit"]').disabled,true);
  observers.at(-1).callback([{isIntersecting:true}]);
  assert.equal(form.querySelector('[type="submit"]').disabled,false);
  assert.equal(calls.some(call=>call.body),false);
  w.dispatchEvent(new w.Event('pagehide'));assert.equal(w.document.querySelector('[data-agreement-content]').textContent,'');
});

const test=require('node:test'),assert=require('node:assert/strict');
const {evaluate}=require('./helpers/commercial_operations_fixture.cjs');
const math=evaluate('lib\\fieldEarnings.ts',{'node:crypto':require('node:crypto'),'@/lib/supabase':{},
  '@/lib/fieldSales':{BusinessError:class extends Error{constructor(message,status=400){super(message);this.status=status;}}}});
const policy={timezone:'America/New_York',rateEffectiveEvent:'qualified',creditPolicy:'approved_attribution',
  accountingPolicy:'customer_revenue_less_actual_equipment_materials_provider_fees',rounding:'half_away_from_zero',
  rates:[{throughDay:30,basisPoints:5500},{throughDay:60,basisPoints:5000},{throughDay:null,basisPoints:4500}]};
const facts=()=>({quoteId:'fixture',orderId:'fixture',leadId:'fixture',representativeId:'fixture',totalCents:100000,netPaidCents:100000,
  acceptedAt:'2026-01-01T12:00:00Z',completedAt:'2026-01-10T12:00:00Z',verifiedPaidAt:'2026-01-11T12:00:00Z',
  eligibleEventId:'completion:payment',disputed:false,refundedCents:0,
  costsComplete:true,costReviewEvidence:{reference:'actual invoices reviewed',actualCostsReviewed:true},costApprovedBy:'synthetic-admin',costApprovedAt:'2026-01-11T12:00:00Z',
  expenses:[{category:'equipment',quantity:1,unitCents:20000,amountCents:20000,evidence:{reference:'actual invoice'},actual:true},
    {category:'materials',quantity:1,unitCents:5000,amountCents:5000,evidence:{reference:'actual invoice'},actual:true},{category:'wages',amountCents:99999,evidence:'hours',actual:true}],
  processingFeeCents:3000,processingFeeEvidence:['verified provider receipt']});
const calculate=(f=facts(),start='2026-01-01',p=policy)=>math.calculateEarning(f,start,'approved start evidence',p);
test('inclusive tenure boundaries and timezone calendar across DST',()=>{
  for(const [date,day,bp] of [['2026-01-30',30,5500],['2026-01-31',31,5000],['2026-03-01',60,5000],['2026-03-02',61,4500]]){
    const r=math.commissionRate('2026-01-01',date+'T12:00:00Z',policy);assert.equal(r.tenureDay,day);assert.equal(r.basisPoints,bp);
  }
  assert.equal(math.commissionRate('2026-03-07','2026-03-09T03:59:00Z',policy).tenureDay,2);
  assert.equal(math.commissionRate('2026-03-07','2026-03-09T04:00:00Z',policy).tenureDay,3);
  assert.throws(()=>math.calendarDate('2026-02-30'));
  assert.throws(()=>math.commissionRate('2026-02-01','2026-01-31T12:00:00Z',policy));
  assert.throws(()=>math.commissionRate('2026-01-01','2026-01-31T12:00:00Z',{...policy,timezone:'invalid'}));
});
test('actual economics exclude all wages; strict missing/zero evidence and no negative floor',()=>{
  const r=calculate();assert.equal(r.basisCents,72000);assert.equal(r.amountCents,39600);
  const f=facts();f.expenses[2].amountCents=0;assert.equal(calculate(f).amountCents,r.amountCents);
  f.expenses[0].amountCents=0;f.expenses[0].unitCents=0;f.expenses[0].zeroCostAttestation='Customer-owned equipment, verified zero actual acquisition cost';assert.equal(calculate(f).state,'earned');
  f.expenses[0].evidence='';assert.equal(calculate(f).state,'calculation_review');
  for(const mutate of [f=>f.expenses.splice(0,1),f=>f.processingFeeCents=null,f=>f.processingFeeEvidence=[],
    f=>f.expenses[0].amountCents=-1,f=>f.expenses[0].amountCents=0.1,f=>f.expenses[0].actual=false,
    f=>{f.expenses[0].amountCents=100000;f.expenses[0].unitCents=100000},
    f=>f.expenses=[],f=>f.costsComplete=false,f=>f.costReviewEvidence={},f=>f.costApprovedBy=null,
    f=>f.expenses[0].quantity=2,f=>delete f.expenses[0].unitCents,
    f=>{f.expenses[0].amountCents=0;f.expenses[0].unitCents=0}]){
    const f=facts();mutate(f);const result=calculate(f);assert.equal(result.state,'calculation_review');assert.equal(result.qualifiesAt,'2026-01-11T12:00:00.000Z');
  }
  assert.equal(calculate(facts(),null).state,'calculation_review');assert.equal(calculate(facts(),'2026-01-01',null).state,'calculation_review');
  const f2=facts();f2.totalCents=1;f2.netPaidCents=1;f2.expenses.filter(e=>e.category!=='wages').forEach(e=>{e.amountCents=0;e.unitCents=0;e.zeroCostAttestation='Verified explicit zero actual cost'});f2.processingFeeCents=0;
  assert.equal(calculate(f2).amountCents,1);
});
test('complete unpaid, payment final, disputes/refunds and immutable input hash',()=>{
  for(const mutate of [f=>f.netPaidCents=25000,f=>f.completedAt=null,f=>f.verifiedPaidAt=null,f=>f.disputed=true,f=>f.refundedCents=1]){
    const f=facts();mutate(f);assert.equal(calculate(f).state,'pending_qualification');
  }
  const f=facts(),r=calculate(f);assert.equal(calculate(f).inputHash,r.inputHash);
  f.representativeId='other';assert.notEqual(calculate(f).inputHash,r.inputHash);
  assert.equal(r.amountCents,39600);
});
test('rate event/timezone must be explicit approved policy; negative economics never create debt or a floor',()=>{
  const f=facts();f.completedAt='2026-01-30T12:00:00Z';f.verifiedPaidAt='2026-01-31T12:00:00Z';
  assert.equal(calculate(f,'2026-01-01',{...policy,rateEffectiveEvent:'accepted'}).basisPoints,5500);
  assert.equal(calculate(f,'2026-01-01',{...policy,rateEffectiveEvent:'qualified'}).basisPoints,5000);
  for(const p of [{...policy,rateEffectiveEvent:undefined},{...policy,timezone:''},{...policy,timezone:'invalid'}]){
    const r=calculate(f,'2026-01-01',p);assert.equal(r.state,'calculation_review');assert.ok(r.qualifiesAt);
  }
  f.expenses[0].unitCents=100000;f.expenses[0].amountCents=100000;
  const loss=calculate(f);assert.equal(loss.state,'calculation_review');assert.match(loss.reasons[0],/Negative actual commission basis.*no floor/);
  assert.equal(loss.amountCents,undefined);
});
test('approved Friday cutoff, holidays and DST; no invented method/classification',()=>{
  const p={timezone:'America/New_York',cutoff:'17:00',holidayConvention:'skip',holidays:[],method:'existing-approved-method',classification:'approved-compensation'};
  assert.equal(math.fridayRunDate('2026-11-06T21:59:00Z',p),'2026-11-06');
  assert.equal(math.fridayRunDate('2026-11-06T22:00:00Z',p),'2026-11-13');
  assert.equal(math.fridayRunDate('2026-03-13T20:59:00Z',p),'2026-03-13');
  assert.equal(math.fridayRunDate('2026-03-13T21:00:00Z',p),'2026-03-20');
  assert.equal(math.fridayRunDate('2026-11-02T12:00:00Z',{...p,holidays:['2026-11-06']}),'2026-11-13');
  assert.equal(math.fridayRunDate('2026-11-02T12:00:00Z',{...p,holidays:['2026-11-06'],holidayConvention:'previous_business_day'}),'2026-11-05');
  assert.equal(math.fridayRunDate('2026-11-02T12:00:00Z',{...p,holidays:['2026-11-06'],holidayConvention:'next_business_day'}),'2026-11-09');
  assert.throws(()=>math.fridayRunDate('2026-11-02T12:00:00Z',{...p,method:''}));
});

const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {createResidentialFixture}=require('./helpers/residential_fixture.cjs');

test('release schema through 039 supports short intake and scheduling without draft 040',async t=>{
  const f=await createResidentialFixture({RESIDENTIAL_WORKSPACE_ENABLED:'true'},{workspace:true,routing:true});
  t.after(()=>f.close());
  const guards=await f.db.query(`select tgname from pg_trigger where not tgisinternal
    and tgname in ('h2s_residential_address_metadata_guard','h2s_residential_booking_address_guard')`);
  assert.equal(guards.rows.length,0,'040 must not be part of this release fixture');
  const response=await f.post('residential-intake',{publicToken:randomUUID(),submissionKey:randomUUID(),
    fullName:'Release Fixture',phone:'+15550000005',city:'Greenville',serviceNeeds:['TV Mounting'],smsOptIn:false});
  assert.equal(response.status,201,await response.clone().text());
  assert.equal(f.sms.length,1,'Only the owner receives the call-first inquiry notification');
  const inquiry=(await f.db.query('select * from commercial_consultation_requests')).rows[0];
  assert.equal((await f.post('residential-review',{token:inquiry.response_token,action:'approve'})).status,200);
  const request=body=>new Request('http://fixture.invalid/api/commercial-calendar',{
    method:'POST',headers:{Authorization:'Bearer fixture-admin','Content-Type':'application/json'},
    body:JSON.stringify({leadId:inquiry.lead_id,revision:0,operationId:randomUUID(),action:'confirm',
      payload:{start:'2099-01-02T15:00:00Z',end:'2099-01-02T16:00:00Z',timezone:'America/New_York',
        customerAgreed:true,reason:'Fixture customer agreed',...body}})});
  assert.equal((await f.route('commercial-calendar').POST(request({customerAgreed:false}))).status,400);
  const booking=await f.route('commercial-calendar').POST(request({}));
  assert.equal(booking.status,200,await booking.clone().text());
  assert.equal((await f.db.query('select state from commercial_reservations')).rows[0].state,'confirmed');
  assert.equal(f.sms.length,1,'Call-first confirmation must not text the customer');
});

test('missing 039 fails closed before saving an inquiry or sending any message',async t=>{
  const f=await createResidentialFixture({},{workspace:true,routing:true});
  t.after(()=>f.close());
  await f.db.exec('reset role;drop table notification_routing_activity;drop table notification_routing;set role service_role');
  const response=await f.post('residential-intake',{publicToken:randomUUID(),submissionKey:randomUUID(),
    fullName:'Blocked Fixture',phone:'+15550000005',city:'Greenville',serviceNeeds:['TV Mounting'],smsOptIn:true});
  assert.equal(response.status,503,await response.clone().text());
  assert.equal((await f.db.query('select count(*)::int count from commercial_leads')).rows[0].count,0);
  assert.equal(f.sms.length,0);
});

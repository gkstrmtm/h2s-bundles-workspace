const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {createSalesFixture,id}=require('./helpers/field_sales_fixture.cjs');
const checked=async response=>{const data=await response.json();assert.equal(response.status,200,data.error);assert.equal(data.ok,true,data.error);return data;};
test('0, 1, 100, 101, 500 and 1000 opportunities have complete bounded stable scoped pages and due retrieval',async t=>{
  const f=await createSalesFixture();t.after(()=>f.db.close());await f.enable();
  let count=0;
  for(const size of [0,1,100,101,500,1000]){
    if(size>count)await f.db.query(`with inquiries as (
      insert into commercial_leads(full_name,phone,project_address,project_city,attribution,service_needs)
      select 'Returning Household '||n,'+1555'||lpad(n::text,7,'0'),'Maple Avenue '||n,'Fixture City',
        '{"market":"residential","intake":"field_sales"}'::jsonb,'["TV Mounting"]'::jsonb
      from generate_series($1::int,$2::int) n returning lead_id
    ), opportunities as (
      insert into field_sales_opportunities(lead_id,owner_user_id,services,created_by,created_at)
      select lead_id,$3,'["tv_mounting"]'::jsonb,$3,'2020-01-01T00:00:00Z' from inquiries returning lead_id
    ) insert into commercial_lead_operations(lead_id,next_follow_up_at)
      select lead_id,'2020-01-01T10:00:00Z' from opportunities`,[count+1,size,id(20)]);
    count=size;
    for(const due of [false,true]){
      let cursor=null;const seen=new Set(),ordered=[];
      do{
        const page=await checked(await f.request('field-sales','GET',null,'a','?limit=100'+(due?'&due=true':'')+(cursor?'&cursor='+encodeURIComponent(cursor):'')));
        assert.equal(page.total,size);assert.ok(page.opportunities.length<=100);
        assert.equal(page.summary.due,size);
        for(const row of page.opportunities){assert.equal(row.owner_user_id,id(20));assert.ok(!seen.has(row.lead_id));seen.add(row.lead_id);ordered.push(row.lead_id);}
        cursor=page.nextCursor;
      }while(cursor);
      assert.equal(seen.size,size);
      assert.deepEqual(ordered,[...ordered].sort(),'UUID tie-breaker is stable across equal timestamps');
    }
  }
  const search=await checked(await f.request('field-sales','GET',null,'a','?search=Household%201000'));
  assert.equal(search.total,1);assert.equal(search.opportunities[0].full_name,'Returning Household 1000');
  const prefix=await checked(await f.request('field-sales','GET',null,'a','?search=Return%20Map'));
  assert.equal(prefix.total,1000,'Indexed prefix terms span customer and property fields');
  const first=await checked(await f.request('field-sales','GET',null,'a'));
  assert.equal(first.opportunities.length,25);
  const home=await checked(await f.request('field-sales','GET',null,'a','?includeFollowUps=true'));
  const dueNext=await checked(await f.request('field-sales','GET',null,'a','?due=true&cursor='+encodeURIComponent(home.followUpCursor)));
  const homeNext=await checked(await f.request('field-sales','GET',null,'a','?includeFollowUps=true&dueCursor='+encodeURIComponent(home.followUpCursor)));
  assert.deepEqual(homeNext.followUps,dueNext.opportunities,'Home synchronization preserves the selected follow-up page');
  assert.deepEqual(homeNext.opportunities,home.opportunities,'Follow-up cursor does not move the primary lead page');
  assert.equal((await f.request('field-sales','GET',null,'a','?dueCursor='+encodeURIComponent(home.followUpCursor))).status,400);
  assert.equal((await f.request('field-sales','GET',null,'a','?cursor='+'x'.repeat(2049))).status,400);
  assert.equal((await f.request('field-sales','GET',null,'a','?ownerId='+id(21))).status,403);
  assert.equal((await f.request('field-sales','GET',null,'b','?customerId='+first.opportunities[0].customer_id)).status,404);
  assert.equal((await checked(await f.request('field-sales','GET',null,'b'))).total,0);
  assert.equal((await f.request('field-sales','GET',null,'a','?cursor='+encodeURIComponent(first.nextCursor)+'&search=other')).status,400);
  assert.equal((await f.request('field-sales','GET',null,'a','?limit=1001')).status,400);
  const managed=await checked(await f.request('field-sales','GET',null,'admin','?ownerId='+id(20)+'&search=1000'));
  assert.equal(managed.total,1);
  const indexes=(await f.db.query("select indexname from pg_indexes where indexname in ('field_sales_customer_search','field_sales_owner_history','field_sales_follow_up')")).rows;
  assert.equal(indexes.length,3);
});
test('repeat opportunity retains one canonical customer, independent ownership and protected prior history',async t=>{
  const f=await createSalesFixture();t.after(()=>f.db.close());await f.enable();
  const source=await checked(await f.request('field-sales','POST',{action:'create',operationId:crypto.randomUUID(),
    fullName:'Returning Customer',phone:'+15550001999',address:'100 Fixture Lane',city:'Fixture',market:'residential',services:['tv_mounting']},'a'));
  const before=await checked(await f.request('field-sales','GET',null,'a','?leadId='+source.leadId));
  const body={action:'repeat',operationId:crypto.randomUUID(),leadId:source.leadId,ownerId:id(21),
    services:['cameras_included'],evidence:'Verified exact returning customer in person',notes:'January camera installation'};
  assert.equal((await f.request('field-sales','POST',body,'b')).status,404);
  const repeat=await checked(await f.request('field-sales','POST',body,'admin'));
  assert.notEqual(repeat.leadId,source.leadId);assert.equal(repeat.customerId,source.leadId);
  assert.equal((await checked(await f.request('field-sales','POST',body,'admin'))).leadId,repeat.leadId,'Idempotent repeat creation');
  assert.equal((await f.request('field-sales','GET',null,'a','?leadId='+repeat.leadId)).status,404);
  const after=await checked(await f.request('field-sales','GET',null,'admin','?leadId='+source.leadId));
  assert.deepEqual(after.opportunity,before.opportunity,'Original opportunity is unchanged');
  const next=await checked(await f.request('field-sales','GET',null,'b','?leadId='+repeat.leadId));
  assert.equal(next.opportunity.originating_user_id,id(21));assert.equal(next.lead.customer_id,source.leadId);
  for(const [actor,total] of [['admin',2],['a',1],['b',1]]){
    const history=await checked(await f.request('field-sales','GET',null,actor,'?customerId='+source.leadId));
    assert.equal(history.total,total);
  }
  assert.equal((await f.db.query('select count(distinct customer_id)::int n from field_sales_opportunities')).rows[0].n,1);
  await assert.rejects(f.db.query('update field_sales_opportunities set customer_id=lead_id where lead_id=$1',[repeat.leadId]),/immutable/);
  const duplicate=await f.request('field-sales','POST',{action:'create',operationId:crypto.randomUUID(),
    fullName:'Uncertain Match',phone:'+15550001999',address:'Other',city:'Fixture',market:'residential',services:['tv_mounting']},'b');
  assert.equal(duplicate.status,409,'Normal duplicate identity protection remains in force');
});

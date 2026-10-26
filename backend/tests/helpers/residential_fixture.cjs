const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const {createFixture}=require('./commercial_contact_fixture.cjs');
const root=path.resolve(__dirname,'..','..');
const sql=name=>fs.readFileSync(path.join(root,'migrations',name),'utf8');
async function createResidentialFixture(env={}, {workspace=false,routing=false}={}) {
  const db=new PGlite();
  await db.exec(sql('014_create_commercial_consultation.sql').split('alter table commercial_leads enable row level security;')[0]);
  await db.exec(`
    create role anon;create role authenticated;create role service_role bypassrls;
    alter table commercial_leads enable row level security;
    alter table commercial_consultation_requests enable row level security;
    create table h2s_orders(id uuid primary key default gen_random_uuid(),order_id text unique not null,
      customer_email text not null,customer_name text,customer_phone text,name text,phone text,status text,
      delivery_date date,delivery_time text,service_name text,appointment_confirmed boolean,
      subtotal numeric not null,total numeric not null,items text,metadata_json jsonb,created_at timestamptz,updated_at timestamptz);
    create table h2s_dispatch_jobs(job_id uuid primary key);
    grant select,insert,update on commercial_leads,commercial_consultation_requests,h2s_orders to service_role;
    grant select on h2s_dispatch_jobs to service_role;
  `);
  await db.exec(sql('031_commercial_reliability.sql'));
  if(workspace)await db.exec(`
    alter table h2s_dispatch_jobs add column status text default 'queued',add column order_id text,add column due_at timestamptz,add column updated_at timestamptz default now();
    alter table h2s_orders add column currency text,add column address text,add column city text,add column state text,add column zip text;
  `);
  await db.exec(workspace?sql('032_commercial_operations.sql'):sql('032_commercial_operations.sql').split('create function public.commercial_record_operation(')[0]);
  if(workspace){
    await db.exec(sql('034_commercial_followup_delivery.sql'));
    await db.exec(sql('036_commercial_calendar_workload.sql'));
  }
  await db.exec(sql('037_residential_inquiries.sql'));
  if(workspace)await db.exec(sql('038_residential_workspace.sql'));
  if(routing)await db.exec(sql('039_notification_routing.sql'));
  await db.exec('set role service_role');
  const memory=createFixture();
  function from(table) {
    assert.ok(['commercial_leads','commercial_consultation_requests','commercial_lead_operations','commercial_reservations','residential_notices','notification_routing'].includes(table));
    const args=[],clauses=[];
    let ordering=[],limit=500,single=false,columns='*';
    const column=name=>{assert.match(name,/^[a-z_][a-z0-9_]*$/);return `"${name}"`;};
    const builder={
      select(value='*'){columns=value;return builder;},
      eq(name,value){args.push(value);clauses.push(`${column(name)}=$${args.length}`);return builder;},
      lte(name,value){args.push(value);clauses.push(`${column(name)}<=$${args.length}`);return builder;},
      in(name,values){clauses.push(`${column(name)} in (${values.map(value=>{args.push(value);return `$${args.length}`;}).join(',')})`);return builder;},
      order(name,options={}){ordering.push(`${column(name)} ${options.ascending===false?'desc':'asc'}`);return builder;},
      limit(value){limit=value;return builder;},
      maybeSingle(){single=true;return builder;},
      async then(resolve){
        try {
          const rows=(await db.query(`select ${columns==='*'?'*':columns.split(',').map(column).join(',')} from ${column(table)}
            ${clauses.length?'where '+clauses.join(' and '):''} ${ordering.length?'order by '+ordering.join(','):''} limit ${limit}`,args)).rows;
          return resolve({data:single?rows[0]||null:rows,error:null});
        }catch(error){return resolve({data:null,error:{code:error.code,message:error.message}});}
      },
    };
    return builder;
  }
  const database={
    from:table=>['commercial_leads','commercial_consultation_requests',...(workspace?['commercial_lead_operations','commercial_reservations','residential_notices']:[]),...(routing?['notification_routing']:[])].includes(table)?from(table):memory.database.from(table),
    async rpc(name,args){
      assert.match(name,/^[a-z_][a-z0-9_]*$/);
      const keys=Object.keys(args);
      keys.forEach(key=>assert.match(key,/^p_[a-z_]+$/));
      try {
        const data=(await db.query(`select public.${name}(${keys.map((key,index)=>`${key}=>$${index+1}`).join(',')}) result`,
          Object.values(args).map(value=>value && typeof value==='object'?JSON.stringify(value):value))).rows[0].result;
        return {data,error:null};
      }catch(error){return {data:null,error:{code:error.code,message:error.message}};}
    },
  };
  const f=createFixture({RESIDENTIAL_INTAKE_ENABLED:'true',RESIDENTIAL_SMS_ENABLED:'true',RESIDENTIAL_REVIEWER_PHONE:'+15550000007',...env},{
    database,getDashboardAuthUserFromSession:async request=>request.headers.get('authorization')==='Bearer fixture-admin'
      ? {userId:'fixture-admin',displayName:'Fixture Admin',role:'ADMIN'}
      : request.headers.get('authorization')==='Bearer fixture-va' ? {userId:'fixture-va',role:'VA'} : null,
  });
  return {...f,db,close:()=>db.close()};
}
module.exports={createResidentialFixture};

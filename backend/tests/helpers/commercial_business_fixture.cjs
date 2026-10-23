const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { createOperationsFixture, evaluate, id } = require('./commercial_operations_fixture.cjs');
async function createBusinessFixture(overrides = {}) {
  const base = await createOperationsFixture();
  const env = { COMMERCIAL_EMAIL_ENABLED:'true', SENDGRID_API_KEY:'fixture-only', SENDGRID_FROM_EMAIL:'home2smart@example.invalid',
    COMMERCIAL_EMAIL_REPLY_TO:'staff@example.invalid', ...overrides };
  await base.db.exec(`create schema storage; create table storage.buckets(id text primary key,name text,public boolean,
    file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(bucket_id text); alter table storage.objects enable row level security;
    alter default privileges in schema public grant all on tables to service_role;`);
  await base.db.exec(fs.readFileSync(path.join(__dirname,'..','..','migrations','035_commercial_business_tools.sql'),'utf8'));
  const originalRpc = base.client.rpc.bind(base.client), objects = new Map(), attempts = [], faults = {};
  const casts = {
    commercial_business_record:['uuid','integer','uuid','jsonb','text','jsonb'],
    commercial_email_claim:['uuid','uuid','uuid','text','jsonb','jsonb','boolean'],
    commercial_email_finish:['uuid','text','text','text','boolean'],
    commercial_email_event:['uuid','jsonb'], commercial_file_record:['uuid','uuid','jsonb','jsonb','boolean'],
  };
  base.client.rpc = async (name, args) => {
    if (!casts[name]) return originalRpc(name,args);
    if (faults.rpc === name) return {data:null,error:{code:'XX000',message:'Fixture storage unavailable'}};
    try {
      const values=Object.values(args).map(value=>value && typeof value==='object' ? JSON.stringify(value) : value);
      const result=await base.db.query(`select ${name}(${values.map((_,i)=>`$${i+1}::${casts[name][i]}`).join(',')}) result`,values);
      return {data:result.rows[0].result,error:null};
    } catch(error) {return {data:null,error:{code:error.code,message:error.message}};}
  };
  base.client.storage = {
    async getBucket() { return {data:{public:!!faults.publicBucket},error:null}; },
    from(name) {
      assert.equal(name,'commercial-private-files');
      return {
        async upload(key, bytes, options) {
          assert.equal(options.upsert,false);
          if (faults.upload || objects.has(key)) return {data:null,error:{message:'Fixture upload unavailable or duplicate'}};
          objects.set(key,Buffer.from(bytes)); return {data:{path:key},error:null};
        },
        async download(key) {return {data:objects.has(key)?new Blob([objects.get(key)]):null,error:objects.has(key)?null:{message:'Missing fixture upload'}};},
        async createSignedUrl(key) {return {data:{signedUrl:`https://fixture.invalid/private/${key}?fixture=1`},error:null};},
      };
    },
  };
  const globals = { process:{env}, Buffer, AbortController, Headers, Blob,
    fetch:async(url,options)=>{
      assert.equal(url,'https://api.sendgrid.com/v3/mail/send','Unmocked network blocked');
      const message=JSON.parse(options.body); attempts.push(message);
      if (faults.beforeProvider) await faults.beforeProvider();
      if (faults.network) throw new Error('Fixture network outcome unknown');
      return new Response(null,{status:faults.providerStatus||202,headers:{'x-message-id':`fixture-provider-${attempts.length}`}});
    },
  };
  const imports = {
    'node:crypto':crypto, '@/lib/supabase':{getSupabase:()=>base.client},
    '@/lib/dashboardAuth': {getDashboardAuthUserFromSession: async request => {
      const auth=request.headers.get('authorization');
      return auth === 'Bearer fixture-admin' ? {userId:id(9),displayName:'Fixture Admin',role:'ADMIN',username:'ADMIN_FIXTURE'}
        : auth === 'Bearer fixture-staff' ? {userId:id(10),displayName:'Fixture Staff',role:'VA',username:'STAFF_FIXTURE'} : null;
    }},
    '@/lib/adminAuth':{corsHeaders:()=>({})},
  };
  const business = evaluate('lib\\commercial_business.ts',imports,globals);
  imports['@/lib/commercial_business']=business;
  const email=evaluate('lib\\commercial_email.ts',imports,globals);
  imports['@/lib/commercial_email']=email;
  const routes = Object.fromEntries(['commercial-business','commercial-business-files','commercial-email-events'].map(name =>
    [name,evaluate(`app\\api\\${name}\\route.ts`,imports,globals)]));
  async function request(name,method='GET',body,token='fixture-admin',extraHeaders={}) {
    const url=`http://fixture.invalid/api/${name}?leadId=${id(1)}`;
    return routes[name][method](new Request(url,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',...extraHeaders},
      ...(method==='POST'?{body:typeof body==='string'?body:JSON.stringify(body)}:{})}));
  }
  return {...base,env,business,email,attempts,objects,businessFaults:faults,routes,businessRequest:request};
}
module.exports={createBusinessFixture,id};

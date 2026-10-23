const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const { createOperationsFixture, id } = require('./commercial_operations_fixture.cjs');
const { createFixture } = require('./commercial_contact_fixture.cjs');

async function startOperationsServer(port = 3014, root = path.resolve(__dirname, '..', '..', '..'), options = {}) {
  const operations = options.calendar ? await require('./commercial_calendar_fixture.cjs').createCalendarFixture(
    options.business ? await require('./commercial_business_fixture.cjs').createBusinessFixture() : undefined)
    : options.business ? await require('./commercial_business_fixture.cjs').createBusinessFixture() : await createOperationsFixture();
  const queue = createFixture();
  async function syncBusinessRecords() {
    for (const lead of queue.tables.commercial_leads) {
      await operations.db.query(`insert into commercial_leads(lead_id,email,phone,contact_preference)
        values($1,$2,$3,$4) on conflict(lead_id) do update
        set email=excluded.email,phone=excluded.phone,contact_preference=excluded.contact_preference`,
      [lead.lead_id,lead.email,lead.phone,lead.contact_preference]);
    }
    for (const consultation of queue.tables.commercial_consultation_requests) {
      await operations.db.query(`insert into commercial_consultation_requests(request_id,lead_id,status,metadata)
        values($1,$2,$3,$4) on conflict(request_id) do update set metadata=excluded.metadata`,
      [consultation.request_id,consultation.lead_id,consultation.status,JSON.stringify(consultation.metadata)]);
    }
  }
  for (const number of [1,2]) {
    const timestamp = new Date(Date.now()-number*60000).toISOString();
    queue.tables.commercial_leads.push({lead_id:id(number),full_name:'Fixture Customer',company_name:number===1?'Northline Office Park':'Fixture second lead',
      email:'fixture@example.invalid',phone:'+15550000005',contact_preference:'email',service_needs:['Security Cameras'],
      scope_summary:'Synthetic fixture: install commercial security cameras.',timeline:'asap',budget_band:'5k_10k',
      project_city:'Fixture City',project_state:'NC',created_at:timestamp,updated_at:timestamp,last_submitted_at:timestamp});
  }
  const json = (response,data,status=200) => {response.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});response.end(JSON.stringify(data));};
  const server = http.createServer(async (request,response) => {
    try {
      const url = new URL(request.url,`http://127.0.0.1:${port}`);
      const businessName=url.pathname.slice('/api/'.length);
      if (options.business && (operations.routes[businessName] || ['commercial-intake','commercial-intake/photo','commercial-consultation'].includes(businessName))) {
        const chunks=[];for await(const chunk of request)chunks.push(chunk);
        const method=request.method,route=operations.routes[businessName] || queue.route(businessName);
        if(typeof route[method]!=='function')return json(response,{ok:false},405);
        const result=await route[method](new Request(url,{method,headers:request.headers,
          ...(['GET','HEAD'].includes(method)?{}:{body:Buffer.concat(chunks)})}));
        if (result.ok && method==='POST' && ['commercial-intake','commercial-consultation'].includes(businessName)) await syncBusinessRecords();
        response.writeHead(result.status,Object.fromEntries(result.headers));return response.end(Buffer.from(await result.arrayBuffer()));
      }
      if (url.pathname==='/api/commercial-operations' || options.calendar && url.pathname==='/api/commercial-calendar') {
        const chunks=[];for await(const chunk of request)chunks.push(chunk);
        const method=request.method;
        if (!['GET','POST','OPTIONS'].includes(method)) return json(response,{ok:false},405);
        const route=url.pathname==='/api/commercial-calendar' ? operations.calendarRoute : operations.route;
        const result=await route[method](new Request(url,{method,headers:request.headers,
          ...(method==='POST'?{body:Buffer.concat(chunks)}:{})}));
        response.writeHead(result.status,Object.fromEntries(result.headers));return response.end(Buffer.from(await result.arrayBuffer()));
      }
      if (url.pathname==='/_fixture/change-queue' && request.method==='POST') {
        queue.tables.commercial_leads[0].notes='Synthetic background update while an operations draft is open.';
        queue.tables.commercial_leads[0].updated_at=new Date().toISOString();
        return json(response,{ok:true});
      }
      if (!['GET','HEAD'].includes(request.method)) return json(response,{ok:false,error:'Only fixture commercial operation writes are allowed'},405);
      if(url.pathname==='/api/v1') {
        const action=url.searchParams.get('action');
        if(action==='dashboardMe')return json(response,{ok:true,me:{userId:id(9),username:'ADMIN_FIXTURE',displayName:'Fixture Admin',role:'ADMIN'}});
        if(action==='ping')return json(response,{ok:true,ping:{ok:true}});
        if(action==='smsMessages')return json(response,{ok:true,thread:{contact_phone:url.searchParams.get('contact_phone')},
          messages:[{direction:'OUTBOUND',body:'Fixture staff manual follow-up',status:'sent',created_at:new Date().toISOString()},
            {direction:'INBOUND',body:'Fixture customer requested a callback',status:'received',created_at:new Date().toISOString()}],
          page:{has_more:false}});
        if(action==='commercialQueue'){
          if(options.calendar) queue.tables.commercial_lead_operations=(await operations.db.query('select * from commercial_lead_operations')).rows;
          return json(response,{ok:true,commercialQueue:await queue.queue(url.searchParams)});
        }
        const empty={candidates:[],tasks:[],taskResources:[],viewerTaskReminderSeen:[],messagesConversations:[],messagesUsers:[],smsThreads:[],smsNumbers:[],notifications:[]};
        return json(response,{ok:true,[action]:[],...empty});
      }
      if(url.pathname.startsWith('/api/'))return json(response,{ok:false,error:'Unsupported fixture read'},404);
      const frontend=path.resolve(root,'frontend'), relative=decodeURIComponent(url.pathname).replace(/^\/+/,'')||'dash.html';
      const file=path.resolve(frontend,relative);
      if(!file.startsWith(frontend+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return json(response,{ok:false},404);
      response.writeHead(200,{'Content-Type':({'.html':'text/html','.js':'application/javascript','.css':'text/css','.woff2':'font/woff2','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});
      fs.createReadStream(file).pipe(response);
    } catch(error){console.error('Commercial operations fixture:',error);json(response,{ok:false,error:error.message},500);}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  console.log(`Commercial operations full-shell fixture http://127.0.0.1:${port}/dash.html — local PGlite, fake Stripe/mail only.`);
  return {server,operations,queue,async close(){await new Promise(resolve=>server.close(resolve));await operations.db.close();}};
}
module.exports={startOperationsServer};
if(require.main===module)startOperationsServer(Number(process.env.H2S_OPERATIONS_FIXTURE_PORT||3014),process.env.H2S_OPERATIONS_REVIEW_ROOT)
  .catch(error=>{console.error(error.message);process.exitCode=1;});

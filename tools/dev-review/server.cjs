const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),https=require('node:https'),crypto=require('node:crypto'),zlib=require('node:zlib');
const workspace=path.resolve(__dirname,'..','..'),frontend=path.join(workspace,'frontend');
const port=Number(process.env.H2S_REVIEW_PORT||50267);
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('H2S_REVIEW_PORT must be an integer from 1024 to 65535.');
const origin='http://127.0.0.1:'+port;
const {createCommerceFixture,id}=require(path.join(workspace,'backend','tests','helpers','field_commerce_fixture.cjs'));
const {evaluate}=require(path.join(workspace,'backend','tests','helpers','commercial_operations_fixture.cjs'));
const {createFixture:createQueueFixture}=require(path.join(workspace,'backend','tests','helpers','commercial_contact_fixture.cjs'));
global.fetch=async()=>{throw Error('Outbound network is disabled in local review');};
for(const client of [http,https])for(const method of ['request','get'])
    client[method]=()=>{throw Error('Outbound HTTP is disabled in local review');};
const blocked=[],started=new Date().toISOString();
const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
const quote=name=>{if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))throw Error('Invalid local query identifier');return '"'+name+'"';};
function localReadDb(f){
    return {rpc:f.client.rpc.bind(f.client),from(table){
        let columns='*',limit=1001,offset=0,conditions=[],params=[],orders=[];
        const add=value=>{params.push(value);return '$'+params.length;};
        const b={select(value='*'){columns=value;return b;},returns(){return b;},limit(n){limit=n;return b;},
            range(start,end){offset=start;limit=end-start+1;return b;},order(column,opts={}){orders.push(quote(column)+(opts.ascending===false?' desc':' asc'));return b;},
            eq(column,value){conditions.push(quote(column)+'='+add(value));return b;},
            in(column,values){conditions.push(values.length?quote(column)+' in ('+values.map(add).join(',')+')':'false');return b;},
            async then(resolve){try{const rows=(await f.db.query('select '+(columns==='*'?'*':columns.split(',').map(quote).join(','))+' from '+quote(table)+(conditions.length?' where '+conditions.join(' and '):'')+(orders.length?' order by '+orders.join(','):'')+' limit '+Number(limit)+' offset '+Number(offset),params)).rows;
                resolve({data:JSON.parse(JSON.stringify(rows)),count:rows.length,error:null});}
                catch(error){resolve({data:null,error:{code:error.code||'LOCAL',message:error.message},count:null});}}};return b;
    }};
}
function png(){
    const width=480,height=240,raw=Buffer.alloc(height*(width*3+1));
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){const n=y*(width*3+1)+1+x*3,v=(Math.floor(x/40)+Math.floor(y/40))%2?220:245;raw[n]=v;raw[n+1]=v;raw[n+2]=v;}
    const crc=b=>{let n=0xffffffff;for(const byte of b){n^=byte;for(let i=0;i<8;i++)n=(n>>>1)^((n&1)?0xedb88320:0);}return (n^0xffffffff)>>>0;};
    const chunk=(type,data)=>{const t=Buffer.from(type),size=Buffer.alloc(4),sum=Buffer.alloc(4);size.writeUInt32BE(data.length);sum.writeUInt32BE(crc(Buffer.concat([t,data])));return Buffer.concat([size,t,data,sum]);};
    const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;
    return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
(async()=>{
    const f=await createCommerceFixture();f.env.H2S_FIELD_SALES_ORIGIN=origin;await f.enable();await f.publish();await f.legal();
    const queueProjection=createQueueFixture();
    delete f.env.H2S_FIELD_STRIPE_TEST_SECRET_KEY;delete f.env.H2S_FIELD_STRIPE_TEST_WEBHOOK_SECRET;
    const imports={'@/lib/supabase':{getSupabase:()=>f.client},'@/lib/adminAuth':{corsHeaders:()=>({})},'@/lib/fieldSales':f.sales};
    const globals={process:{env:f.env},Buffer,Blob,Headers};
    const sales=evaluate(path.join('app','api','field-sales','route.ts'),imports,globals),photos=evaluate(path.join('app','api','field-sales-photos','route.ts'),imports,globals);
    const invoke=async(route,method,body,actor='a',query='')=>route[method](new Request('http://local.invalid/api/'+query,{method,headers:{Authorization:'Bearer '+actor,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}));
    const leads=[];
    for(const [index,name] of ['SYNTHETIC TV prospect','SYNTHETIC camera assessment','SYNTHETIC commercial inquiry'].entries()){
        const response=await invoke(sales,'POST',{action:'create',operationId:crypto.randomUUID(),fullName:name,phone:'+15550000'+String(101+index),address:(100+index)+' Synthetic Review Lane',city:'Synthetic City',market:index===2?'commercial':'residential',
            services:index===1?['cameras_owned','cameras_included']:['tv_mounting'],notes:'Local synthetic visual review record, never production.',followUpAt:new Date(Date.now()+index*86400000).toISOString()});
        const result=await response.json();if(!result.ok)throw Error(result.error);leads.push(result.leadId);
    }
    const detail=await f.sales.ownedOpportunity(id(20),leads[0]);
    let response=await invoke(sales,'POST',{action:'save',operationId:crypto.randomUUID(),leadId:leads[0],revision:detail.opportunity.revision,services:['tv_mounting'],answers:{tv_mounting:{quantity:2,size:65,surface:'Drywall / studs',mount:'Discuss options'}},
        photoConsent:true,consentNote:'Synthetic permission for a checkerboard placeholder, not a real property photograph.',notes:'Review the photo intake and configurable assessment controls.',followUpAt:new Date().toISOString(),submit:false});
    if(response.status!==200)throw Error(await response.text());
    response=await invoke(photos,'POST',{operationId:crypto.randomUUID(),leadId:leads[0],serviceId:'tv_mounting',label:'Mounting surface',filename:'SYNTHETIC-checkerboard.png',data:'data:image/png;base64,'+png().toString('base64')});
    if(response.status!==200)throw Error(await response.text());
    const first=await f.quote(leads[0]),approved=await f.submit(leads[0],first);
    const prepared=await(await f.post({action:'agreement',leadId:leads[0],quoteId:approved})).json();
    if(!prepared.ok)throw Error(prepared.error);
    const unusual=f.lines();unusual[0].answers.wall='masonry';await f.submit(leads[1],await f.quote(leads[1],unusual));
    await f.quote(leads[2]);
    await f.db.exec(`alter table h2s_pros add column if not exists email text;
      alter table h2s_dispatch_jobs add column if not exists created_at timestamptz not null default now();
      alter table h2s_payouts_ledger add column if not exists state text;
      create table if not exists h2s_dispatch_legacy_job_links(dispatch_job_id uuid,legacy_job_id text,evidence_basis text,evidence_reference text,reviewed_by_user_id text,reviewed_at timestamptz);
      create table if not exists h2s_dispatch_pros(pro_id uuid,status text);
      create table if not exists h2s_dispatch_pros_availability(avail_id text,pro_id text,date_local text,type text,weekday text,start_time_local text,end_time_local text);
      create table if not exists h2s_dispatch_pro_capacity(capacity_id text,pro_id text,date_local text,time_slot text,max_jobs integer,booked_jobs integer,available_spots integer,blocked boolean);
      update h2s_orders set customer_name='SYNTHETIC installation customer',service_name=case when order_id='APPT-COM-FIXTURE' then 'SYNTHETIC commercial consultation' else 'SYNTHETIC TV installation' end,address='100 Synthetic Review Lane',status='pending',session_id=null,payment_intent_id=null;
      update h2s_pros set name='SYNTHETIC '||name;
      insert into h2s_dispatch_job_assignments(job_id,pro_id,state) values('unresolved-local-job','unresolved-local-technician','pending');`);
    const start=new Date(Date.now()+86400000),end=new Date(start.getTime()+7200000);
    await f.db.query("update h2s_dispatch_jobs set due_at=$1 where job_id=$2",[start.toISOString(),id(101)]);
    await f.db.query("update h2s_orders set metadata_json=metadata_json||$1::jsonb where id=$2",[JSON.stringify({scheduled_end:end.toISOString(),scheduled_tz:'America/New_York'}),id(100)]);
    const foundation=evaluate(path.join('lib','operationsFoundation.ts'),{}),operations=evaluate(path.join('lib','managementOperations.ts'),{'@/lib/operationsFoundation':foundation});
    const planning=evaluate(path.join('lib','managementPlanning.ts'),{'node:crypto':crypto,'@/lib/operationsFoundation':foundation,'@/lib/managementOperations':operations});
    const readDb=localReadDb(f);
    const candidates=[{Candidate_ID:'LOCAL-CANDIDATE-1',First_Name:'SYNTHETIC',Last_Name:'Technician Applicant',Email:'applicant@example.invalid',Phone:'+15550000201',Stage:'Screening',Status:'New',Position:'Installation technician',Created_At:new Date().toISOString()}];
    const known={
        candidates:{candidates},aiProfiles:{profiles:[]},training:{training:[],resources:[]},tasks:{tasks:[]},
        deliverables:{deliverables:[]},hours:{hours:[]},knowledgeProfile:{profile:null},getKnowledgeProfile:{profile:null},vaKnowledgeProfile:{vaKnowledgeProfile:null},taskResources:{taskResources:[]},
        trainingCompletions:{trainingCompletions:[]},taskCounts:{taskCounts:null},bug_reports:{bug_reports:{reports:[],meta:{localPreview:true}}},
        reports:{reports:[]},smsContacts:{contacts:[]},smsThreads:{threads:[],hidden_threads:[]},smsGroups:{groups:[],group_members:[]},smsMessages:{messages:[],page:{has_more:false}},
        dashboardUsers:{users:[{User_ID:id(9),Username:'LOCALADMIN',Display_Name:'SYNTHETIC Review Admin',Role:'ADMIN',Is_Disabled:false},{User_ID:id(20),Username:'SALESA',Display_Name:'SYNTHETIC Representative A',Role:'SALES',Is_Disabled:false}]},
        messagesUsers:{users:[]},messagesThreads:{threads:[]},messagesUnread:{unread:0},userProfile:{profile:null}
    };
    const block=(res,endpoint,reason='Disabled for inspection; no production call was made.')=>{blocked.push({at:new Date().toISOString(),endpoint});if(blocked.length>200)blocked.shift();json(res,423,{ok:false,error:'LOCAL REVIEW: '+reason});};
    const server=http.createServer(async(req,res)=>{
        try{
            const host=req.headers.host;if(!host||!['127.0.0.1:'+port,'localhost:'+port].includes(host)){json(res,403,{ok:false,error:'Loopback review only'});return;}
            const url=new URL(req.url,'http://'+host),requestOrigin=req.headers.origin;
            if(requestOrigin&&requestOrigin!=='http://'+host){json(res,403,{ok:false,error:'Cross-origin requests are blocked'});return;}
            res.setHeader('Cache-Control','no-store');
            res.setHeader('Content-Security-Policy',"default-src 'self'; connect-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://unpkg.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com; font-src 'self' data: https://fonts.gstatic.com https://cdnjs.cloudflare.com; img-src 'self' data: blob:; media-src 'self' blob: data:; frame-src 'self'; form-action 'self'; base-uri 'self'; object-src 'none'");
            if(url.pathname==='/review-status'){json(res,200,{mode:'LOCAL_SYNTHETIC_ONLY',started,pid:process.pid,productionNetwork:false,stripe:false,assignmentWrites:false,notifications:false,sourceFilesModified:false,leadIds:leads,blocked});return;}
            let body='';if(req.method!=='GET'&&req.method!=='HEAD'){for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>9*1024*1024)throw Error('Request too large');}}
            const payload=body?JSON.parse(body):{},token=(req.headers.authorization||'').replace(/^Bearer /i,''),actor=token.startsWith('h2s-sales:')?'a':token==='local-review-admin'?'admin':null;
            if(url.pathname.startsWith('/api/')){
                const name=url.pathname.slice(5);
                if(name==='v1'){
                    const action=url.searchParams.get('action')||payload.action;
                    if(action==='ping'){json(res,200,{ok:true,preview:true});return;}
                    if(!actor){json(res,401,{ok:false,error:'Synthetic local review session required. Use the review index links.'});return;}
                    if(action==='dashboardMe'){json(res,200,{ok:true,me:{username:actor==='a'?'SALESA':'LOCALADMIN',role:actor==='a'?'SALES':'ADMIN',userId:actor==='a'?id(20):id(9)}});return;}
                    if(actor!=='admin'){json(res,403,{ok:false,error:'ADMIN-only legacy preview'});return;}
                    if(req.method==='GET'&&Object.hasOwn(known,action)){json(res,200,{ok:true,preview:true,...known[action]});return;}
                    if(req.method==='GET'&&action==='commercialQueue'){
                        for(const table of ['commercial_leads','commercial_lead_operations','commercial_consultation_requests','h2s_orders'])
                            queueProjection.tables[table]=JSON.parse(JSON.stringify((await f.db.query('select * from '+quote(table))).rows));
                        json(res,200,{ok:true,commercialQueue:await queueProjection.queue(url.searchParams)});return;
                    }
                    block(res,'v1:'+action,'This legacy action has no safe local adapter. Its real UI is available; no successful action is simulated.');return;
                }
                if(name.startsWith('admin_')){
                    if(actor!=='admin'){json(res,403,{ok:false,error:'ADMIN-only Dispatch preview'});return;}
                    if(name==='admin_jobs_list'){
                        const jobs=(await f.db.query('select j.*,j.due_at scheduled_start_at,j.due_at start_iso,o.customer_name,o.address,o.service_name,o.total,o.metadata_json metadata from h2s_dispatch_jobs j left join h2s_orders o on o.order_id=j.order_id')).rows;
                        json(res,200,{ok:true,jobs});return;
                    }
                    if(name==='admin_pros_list'){json(res,200,{ok:true,pros:(await f.db.query('select * from h2s_pros')).rows});return;}
                    if(name==='admin_payouts_overview'||name==='admin_payouts_cockpit'){json(res,200,{ok:true,rows:[],payouts:[]});return;}
                    if(name==='admin_business_intelligence'){json(res,200,{ok:true,preview:true,revenue:{total:0,margin:0},operations:{jobs_completed:0,completion_rate:0},workforce:{active_pros:2,utilization_rate:0},growth:{mom_growth:0,this_month_jobs:2,repeat_rate:0,unique_customers:1},capacity:{utilization_pct:0,current_load:2},charts:{}});return;}
                    block(res,name);return;
                }
                if(!actor&&name!=='field-sales-agreement'){json(res,401,{ok:false,error:'Local synthetic session required'});return;}
                if(name==='management-assignments'){if(req.method!=='GET'){block(res,name,'Technician assignment writes remain disabled.');return;}json(res,200,{ok:true,enabled:false,reason:'Assignment writes are deliberately disabled for this review.'});return;}
                if(name==='management-operations'){
                    if(req.method!=='GET'||actor!=='admin'){block(res,name);return;}
                    json(res,200,{ok:true,...await operations.readManagementOperations(readDb,{offset:Number(url.searchParams.get('offset')||0),limit:25,
                        verifyPayment:async()=>({status:'unverified',detail:'Synthetic data; Stripe verification disabled.'})})});return;
                }
                if(name==='management-planning'){
                    if(req.method!=='GET'||actor!=='admin'){block(res,name);return;}
                    json(res,200,{ok:true,reviewOwnerId:id(9),...await planning.readManagementPlanning(readDb,{view:url.searchParams.get('view')==='reconciliation'?'reconciliation':'schedule',filter:url.searchParams.get('filter')||'all',offset:Number(url.searchParams.get('offset')||0),limit:25})});return;
                }
                const route=name==='field-sales'?sales:name==='field-sales-photos'?photos:f.routes[name];
                if(route){
                    if(name==='field-sales-stripe-webhook'||name==='field-sales-transactions'&&['checkout','refresh_payment'].includes(payload.action)){block(res,name,'Stripe/payment activity is disabled, including synthetic Checkout.');return;}
                    if(name==='field-sales'&&req.method==='POST'&&!['create','save','review'].includes(payload.action)){block(res,name,'Account administration and representative reassignment are disabled in this review.');return;}
                    const headers={...req.headers};if(actor)headers.authorization='Bearer '+actor;
                    const out=await route[req.method](new Request('http://'+host+req.url,{method:req.method,headers,...(body?{body}:{})}));
                    res.writeHead(out.status,Object.fromEntries(out.headers));res.end(Buffer.from(await out.arrayBuffer()));return;
                }
                block(res,name,'No isolated adapter exists for this endpoint. Production is never used as a fallback.');return;
            }
            if(url.pathname==='/'){
                const links=[['Management dashboard','/dash.html'],['Operations','/dash.html?reviewTab=operations'],['Field Sales (representative mobile shell)','/dash.html?reviewRole=SALES'],['Quotes & Payments (ADMIN review)','/dash.html?reviewTab=quotes'],['Field Sales management','/dash.html?reviewTab=fieldsales'],['Customer agreement (synthetic unaccepted terms)','/review-agreement'],['Dispatch comparison','/dispatch.html'],['Customer Queue','/dash.html?reviewTab=commercialqueue']];
                const pages=fs.readdirSync(frontend).filter(n=>n.endsWith('.html')).sort();
                res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><title>Home2Smart Local Visual Review</title><h1>Home2Smart local visual review</h1><p>Current saved working tree. Synthetic, in-memory records only. No production connection or deployment.</p><p><strong>Stripe, assignment writes, email/SMS, account administration and legacy mutations are blocked.</strong> Field Sales prospect/assessment/photo and quote/approval/agreement changes affect only disposable synthetic data. Test prices and placeholder legal text are not approved Home2Smart offers. No paid states are simulated.</p><ul>'+links.map(([label,href])=>'<li><a target="_blank" rel="noopener" href="'+href+'">'+label+'</a></li>').join('')+'</ul><h2>Limits</h2><p>Original interfaces and scripts are served, not replacement mockups. Legacy lists have minimal synthetic/empty read data; unsupported actions explicitly fail. Real integrations, externally hosted media and external API connections are not available. Unsaved editor buffers are not accessible to this server; they have been left untouched. Synthetic state resets if this server stops.</p><p><a href="/review-status">Live safety / blocked-action status</a></p><details><summary>Other existing frontend pages (same safety restrictions; may need unavailable APIs)</summary><ul>'+pages.map(n=>'<li><a target="_blank" rel="noopener" href="/'+encodeURIComponent(n)+'">'+n+'</a></li>').join('')+'</ul></details>');return;
            }
            if(url.pathname==='/review-agreement'){res.writeHead(302,{Location:prepared.agreementUrl});res.end();return;}
            if(url.pathname==='/review-boot.js'){res.setHeader('Content-Type','application/javascript');res.end(fs.readFileSync(path.join(__dirname,'bootstrap.js')));return;}
            let relative=decodeURIComponent(url.pathname).replace(/^\/frontend\//,'/').replace(/^\//,'');
            if(/^dash\.PORTAL_BUILD_.*\.css$/.test(relative))relative='dash.css';
            if(/^dash\.PORTAL_BUILD_.*\.js$/.test(relative))relative='dash.js';
            const target=path.resolve(frontend,relative);
            if(!target.startsWith(frontend+path.sep)||!['.html','.css','.js','.json','.png','.jpg','.jpeg','.svg','.webp','.ico','.woff','.woff2'].includes(path.extname(target))){res.writeHead(404);res.end('Not a local frontend asset');return;}
            if(!fs.existsSync(target)||!fs.statSync(target).isFile()){res.writeHead(404);res.end('Frontend asset unavailable: '+relative);return;}
            let data=fs.readFileSync(target);
            if(target.endsWith('.html'))data=data.toString().replace(/<head([^>]*)>/i,'<head$1><script src="/review-boot.js"></script>').replace('content="https://h2s-backend.vercel.app"','content="http://'+host+'"').replaceAll('https://cdn.jsdelivr.net/gh/gkstrmtm/home2smart-assets@main/logo-180.png','/media/home2smart-logo.png').replaceAll('https://storage.googleapis.com/msgsndr/7Drmpw623JAkrfDKPdjG/media/68da0ce6f00445991d64a63f.png','/media/home2smart-logo.png');
            res.setHeader('Content-Type',({'.html':'text/html','.css':'text/css','.js':'application/javascript','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp'})[path.extname(target)]||'application/octet-stream');res.end(data);
        }catch(error){console.error('Local review error:',error.message);json(res,500,{ok:false,error:'Local preview error: '+error.message});}
    });
    server.listen(port,'127.0.0.1',()=>console.log('READY '+origin+' - PID '+process.pid+'; synthetic only; no production or payment access'));
})().catch(error=>{console.error('Isolated review startup failed:',error);process.exitCode=1;});

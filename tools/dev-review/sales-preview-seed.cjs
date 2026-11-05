'use strict';
const crypto=require('node:crypto');
async function seedSalesPreview(engine,photo,{readiness=false}={}){
    async function call(name,body,actor='admin',query=''){
        const response=await engine.request(name,body?'POST':'GET',body?{operationId:crypto.randomUUID(),...body}:null,actor,query);
        const result=await response.json();
        if(!response.ok||result.ok!==true)throw Error('Synthetic preview initialization failed: '+name+': '+(result.error||response.status));
        return result;
    }
    const initial=await engine.status();
    const create=(name,phone,services)=>call('field-sales',{action:'create',fullName:name,phone,address:'214 Cedar Grove Lane',city:'Greenville',market:'residential',
        services,notes:'SYNTHETIC visual review only. No real person or property.',followUpAt:new Date().toISOString()},'sales');
    const first=await create('Morgan & Jordan Wellington','+15551112223',[initial.suggestions.serviceId]);
    const leadId=first.leadId;
    const draft=await call('field-sales-transactions',{action:'quote',leadId,catalogId:initial.suggestions.catalogId,lines:initial.suggestions.lines},'sales');
    const submitted=await call('field-sales-transactions',{action:'submit',leadId,quoteId:draft.id},'sales');
    const record={leadId,quoteId:submitted.id};
    async function workflow(body){
        const current=(await engine.status()).workflow;
        return call('field-sales-workflow',{...record,revision:current?.revision||0,...body});
    }
    await workflow({action:'enroll',...initial.suggestions.enrollment});
    let w=(await engine.status()).workflow;
    await workflow({action:'documents_publish',artifacts:w.requiredArtifacts,evidence:{reference:'SYNTHETIC approved review copies'}});
    const prepared=await call('field-sales-transactions',{action:'agreement',...record},'sales');
    const token=new URLSearchParams(new URL(prepared.agreementUrl).hash.slice(1)).get('token');
    const agreement=await call('field-sales-agreement',null,token);
    await call('field-sales-agreement',{name:'Morgan Wellington',email:'synthetic@example.invalid',accepted:true,electronicDelivery:true,
        quoteHash:agreement.quote.quote_hash,policyVersion:agreement.agreement.policy_snapshot.version},token);
    await call('field-sales-agreement',{action:'checkout',kind:'deposit'},token);
    await engine.control('provider_capture',{sessionId:(await engine.status()).provider.sessionId,feeCents:151});
    for(const [action,key]of [['schedule','schedule'],['preparation','preparation'],['assign','assignment']])
        await workflow({action,...(await engine.status()).suggestions[key]});
    w=(await engine.status()).workflow;
    const jobId=w.jobId;
    await call('portal_accept',{job_id:jobId},'pro');
    const read=async()=> (await call('field-sales-installation',null,'pro','?job_id='+jobId)).workflow;
    let installation=await read();
    const bindings=[],checklists=[];
    for(const requirement of installation.proof.requirements){
        if(requirement.type==='checklist'){
            checklists.push({serviceId:requirement.serviceId,requirementId:requirement.id,affirmed:true,evidence:{reference:'SYNTHETIC onsite checklist'}});
        }else{
            const artifactIds=[];
            for(let n=0;n<requirement.minimumCount;n++){
                const uploaded=await call(requirement.type==='signature'?'portal_upload_signature':'portal_upload_artifact',
                    {job_id:jobId,type:requirement.type,data:photo.toString('base64'),filename:'SYNTHETIC-evidence.png',mimetype:'image/png'},'pro');
                artifactIds.push(uploaded.artifact.artifact_id);
            }
            bindings.push({serviceId:requirement.serviceId,requirementId:requirement.id,artifactIds});
        }
    }
    installation=await read();
    await call('field-sales-installation',{action:'proof_record',job_id:jobId,workflowRevision:installation.revision,bindings,checklists},'pro');
    installation=await read();
    let hints=(await engine.status()).suggestions;
    await call('portal_mark_done',{job_id:jobId,workflowRevision:installation.revision,expenses:hints.expenses,hours:hints.hours,evidence:hints.completionEvidence},'pro');
    await call('field-sales-agreement',{action:'checkout',kind:'balance'},token);
    await engine.control('provider_capture',{sessionId:(await engine.status()).provider.sessionId,feeCents:249});
    await workflow({action:'cost_review',expenses:hints.expenses,evidence:hints.costReviewEvidence});
    hints=(await engine.status()).suggestions;
    const run=await call('field-sales-earnings',{action:'create_run',settlementPolicyId:hints.settlement.settlementPolicyId,runDate:hints.settlement.runDate});
    await call('field-sales-earnings',{action:'approve_run',runId:run.runId,evidence:'SYNTHETIC Friday review only; no transfer'});
    const intake=await create('Avery Chen','+15551112224',['cameras_included']);
    const quoteLead=await create('Taylor Brooks','+15551112225',['tv_mounting']);
    const reviewDraft=await call('field-sales-transactions',{action:'quote',leadId:quoteLead.leadId,catalogId:initial.suggestions.catalogId,lines:initial.suggestions.lines},'sales');
    let ownerInstallationLeadId=null;
    if(readiness){
        const returning=await call('field-sales',{action:'repeat',leadId,ownerId:initial.suggestions.enrollment.representativeId,
            services:['cameras_included'],evidence:'Verified returning household; separate camera service',notes:'Isolated company installation review'});
        ownerInstallationLeadId=returning.leadId;
        let camera=await call('field-sales-transactions',{action:'quote',leadId:returning.leadId,catalogId:initial.suggestions.catalogId,
            lines:[{serviceId:'cameras_included',offerId:'package',quantity:2,answers:{installation:'wireless'},options:[]}]},'sales');
        camera=await call('field-sales-transactions',{action:'submit',leadId:returning.leadId,quoteId:camera.id},'sales');
        const second={leadId:returning.leadId,quoteId:camera.id};
        async function manage(body){
            const read=await call('field-sales-workflow',null,'admin','?lead_id='+second.leadId),w=read.workflows.find(w=>w.quoteId===second.quoteId);
            return call('field-sales-workflow',{...second,revision:w?.revision||0,...body});
        }
        await manage({action:'enroll',...initial.suggestions.enrollment});
        const current=(await call('field-sales-workflow',null,'admin','?lead_id='+second.leadId)).workflows[0];
        await manage({action:'documents_publish',artifacts:current.requiredArtifacts,evidence:{reference:'Isolated approved camera copies'}});
        const agreement=await call('field-sales-transactions',{action:'agreement',...second},'sales');
        const secondToken=new URLSearchParams(new URL(agreement.agreementUrl).hash.slice(1)).get('token');
        const facts=await call('field-sales-agreement',null,secondToken);
        await call('field-sales-agreement',{name:'Morgan Wellington',email:'synthetic@example.invalid',accepted:true,electronicDelivery:true,
            quoteHash:facts.quote.quote_hash,policyVersion:facts.agreement.policy_snapshot.version},secondToken);
        await call('field-sales-agreement',{action:'checkout',kind:'deposit'},secondToken);
        await engine.control('provider_capture',{sessionId:(await engine.status()).provider.sessionId,feeCents:151});
        await manage({action:'schedule',...initial.suggestions.schedule});
        await manage({action:'preparation',...initial.suggestions.preparation});
        const company=await call('field-sales-company-installation',null);
        if(!company.candidates.length)throw Error('Isolated company identity is unavailable');
        await call('field-sales-company-installation',{action:'authorize_self',proId:company.candidates[0].proId,evidence:{reference:'Verified isolated company owner identity'}});
        for(let n=0;n<30;n++)await create(['Jordan','Riley','Casey','Avery','Morgan'][Math.floor(n/6)]+' '+['Ellis','Bennett','Chen','Brooks','Rivera','Foster'][n%6],'+1555222'+String(n).padStart(4,'0'),['tv_mounting']);
    }
    return {completedLeadId:leadId,assessmentLeadId:intake.leadId,quoteLeadId:quoteLead.leadId,draftQuoteId:reviewDraft.id,jobId,runId:run.runId,ownerInstallationLeadId,
        note:'Synthetic payment receipts, storage and Friday review only. No external transfer or production records.'};
}
module.exports={seedSalesPreview};

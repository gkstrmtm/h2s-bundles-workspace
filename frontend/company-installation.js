(function(global){
    'use strict';
    const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    function mount(root,options){
        const controller=new AbortController(),started=options.getSession();
        let ended=false,instance,busy=false,attempt,readVersion=0;
        const valid=()=>!ended&&options.getSession()?.token===started?.token&&options.getSession()?.role==='ADMIN';
        const endpoint=String(options.apiBase).replace(/\/+$/,'').replace(/\/api$/i,'')+'/api/field-sales-company-installation';
        function status(message,error=false){if(!valid())return;const el=root.querySelector('[data-company-status]');el.textContent=message;el.setAttribute('role',error?'alert':'status');}
        async function api(body){
            const response=await global.fetch(endpoint+(body||!options.jobId?'':'?job_id='+encodeURIComponent(options.jobId)),{
                method:body?'POST':'GET',cache:'no-store',signal:controller.signal,referrerPolicy:'no-referrer',
                headers:{Authorization:'Bearer '+started.token,...(body?{'Content-Type':'application/json'}:{})},
                ...(body?{body:JSON.stringify(body)}:{})});
            if(!valid())throw Error('Company session changed; response discarded.');
            const result=await response.json();
            if(!response.ok||result.ok!==true)throw Error(result.error||'Company installation request failed.');
            return result;
        }
        async function load(){
            const read=++readVersion;
            instance?.destroy();instance=null;
            root.innerHTML='<p data-company-status role="status">Verifying your company installer identity...</p>';
            try{
                const data=await api();if(!valid()||read!==readVersion)return;
                if(!data.authorized){
                    root.insertAdjacentHTML('beforeend',data.candidates?.length?`<form data-company-identity class="field-sales__form"><label>My existing company installer identity<select name="proId">${data.candidates.map(p=>`<option value="${esc(p.proId)}">${esc(p.email)}</option>`).join('')}</select></label><label>Company identity verification<textarea name="reference" required minlength="3" maxlength="2000"></textarea></label><button type="submit">Authorize my verified company identity</button></form>`:'<p>Your management account needs an approved matching active company installer profile. No outside technician account or identity is invented here.</p>');
                    status('Only your verified company identity can record your installation.');return;
                }
                if(!options.jobId){status('Schedule the installation and review readiness before personally accepting it.');return;}
                if(!data.enrolled){
                    root.insertAdjacentHTML('beforeend',`<form data-company-claim class="field-sales__form"><label>Company installation confirmation<textarea name="reference" required minlength="3" maxlength="2000"></textarea></label><button type="submit"${options.canClaim?'':' disabled'}>I will perform this installation</button></form>`);
                    status(options.canClaim?'Personally accept this prepared company installation. No external workforce activation is required.':'Scheduling, readiness or another installer prevents personal acceptance.');return;
                }
                status('Your verified company installation. Actual costs still require separate management approval.');
                root.insertAdjacentHTML('beforeend',`${data.workflow.completedAt?'':`<form data-company-upload class="field-sales__form"><label>Evidence type<select name="type"><option value="photo">Installation photograph</option><option value="signature">Customer signature image</option></select></label><label>Actual evidence image<input name="photo" type="file" accept="image/png,image/jpeg" required></label><button type="submit">Save installation evidence</button></form>`}<div data-company-completion></div>`);
                instance=global.H2SFieldInstallation.mount(root.querySelector('[data-company-completion]'),{
                    ...options,enrolled:true,company:true,onCompleted:()=>options.onChanged?.()});
                await instance.ready;
            }catch(error){if(valid()&&read===readVersion){console.error('Company installation read failed:',error.message);status(error.message,true);root.insertAdjacentHTML('beforeend','<button type="button" data-company-retry>Retry company installation</button>');}}
        }
        root.addEventListener('click',event=>{if(event.target.closest('[data-company-retry]'))load();});
        root.addEventListener('submit',async event=>{
            const form=event.target.closest('[data-company-identity],[data-company-claim],[data-company-upload]');
            if(!form)return;event.preventDefault();event.stopPropagation();if(busy||!valid())return;
            busy=true;
            try{
                if(form.matches('[data-company-upload]')){
                    const file=form.elements.photo.files[0];if(!file||file.size>2*1024*1024)throw Error('Choose a PNG/JPEG evidence image up to 2 MB.');
                    const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(Error('Evidence image could not be read.'));reader.readAsDataURL(file);});
                    await api({action:'upload',job_id:options.jobId,type:form.elements.type.value,data,filename:file.name,mimetype:file.type});
                    if(!valid())return;form.reset();await instance.refresh();status('Native installation evidence saved. Bind any required service evidence below.');return;
                }
                if(!attempt)attempt={action:form.matches('[data-company-identity]')?'authorize_self':'claim',
                    operationId:global.crypto.randomUUID(),...(form.elements.proId?{proId:form.elements.proId.value}:{job_id:options.jobId,workflowRevision:options.revision}),
                    evidence:{reference:form.elements.reference.value.trim()}};
                await api(attempt);if(!valid())return;attempt=null;await load();options.onChanged?.();
            }catch(error){if(valid()){console.error('Company installation write failed:',error.message);status(error.message+' Retry preserves the same authorization/acceptance operation.',true);}}
            finally{busy=false;}
        });
        const ready=load();
        return {ready,destroy(){ended=true;controller.abort();instance?.destroy();root.replaceChildren();}};
    }
    global.H2SCompanyInstallation={mount};
})(window);

(function () {
    'use strict';
    const steps = [
        ['sales','dashboard','Representative session & assigned leads','Use the actual isolated representative session. Review assigned leads and follow-ups. Performance is also available in the application navigation.'],
        ['sales','new','Create customer prospect','Enter synthetic contact/address details, choose the scenario service and save the new prospect. Fill sample values is optional; submit the actual form yourself.'],
        ['sales','detail','Assessment & property photos','Answer the service questions. Explicitly grant synthetic photograph permission, save the assessment, select a sample photo and upload it using the actual labeled-photo form.'],
        ['sales','quote','Itemized quote & qualification','Choose the scenario offer, quantity and installation answers. Calculate the immutable draft, review itemization/conditions and submit the quote. Nonstandard jobs require approval.'],
        ['admin','approval','Management quote / exception review','Review the exact customer and quote. For a pending exception, enter approval reason and final scope, then approve the actual immutable revision. Standard qualified quotes may not need an exception approval.'],
        ['admin','enroll','Enroll approved sale','Use the existing New order enrollment form. Fill sample values supplies fixture policy IDs, not approval. Explicitly confirm enrollment and submit. These are synthetic approved test policies, never production policy.'],
        ['admin','documents','Publish required customer copies','Publish the exact server-provided immutable copies using the actual management form and synthetic source evidence. The customer must retrieve and accept them; staff delivery alone does not substitute for retrieval.'],
        ['sales','present','Present the approved quote','Use Prepare exact-quote agreement / Present existing agreement and the finite secure customer link. The actual customer page opens within this review navigator.'],
        ['customer','agreement','Customer quote, notices & acceptance','Read itemized services, terms and notices, download the copies and enter a synthetic name/email. Explicitly acknowledge the checkboxes and record customer acceptance.'],
        ['customer','deposit','Customer 25% deposit','Create checkout with the real customer button, then follow the link to the clearly separate simulated provider. No card information or real Stripe charge is involved.'],
        ['admin','schedule','Deposit, clearance & scheduling','Review verified synthetic deposit and cancellation gates. Confirm agreed installation times using the existing company-calendar form. Sample times/timezone are supplied for this isolated scenario.'],
        ['admin','preparation','Installation readiness','Record scope, actual materials/access readiness and source note in the existing management form. Explicitly check reviewed scope. Readiness belongs to the scheduled native job.'],
        ['admin','assign','Managed technician assignment','Select the available canonical synthetic technician and submit the actual managed assignment. This updates only isolated records; production/global assignment remains off.'],
        ['pro','job','Technician job & offer','Enter the existing technician portal, review the assigned offer/job and accept it with the actual controls. Open the job detail to review customer, scope and requirements.'],
        ['pro','proof','Technician installation proof','Use native Add photo controls and the customer signature canvas. Select synthetic photos if needed, draw a test onsite signature, and save configured proof bindings/checklists in the enrolled installation component.'],
        ['pro','costs','Actual materials, hours & completion','Enter evidenced synthetic equipment/material quantities, actual unit cents, totals and hours in the real enrolled job component. Explicitly attest costs and complete only after all proof gates are satisfied.'],
        ['admin','costReview','Management completion & actual-cost review','Review retained proof and technician expense rows. Explicitly attest each actual cost and approve the separate immutable management cost snapshot. Wages are not deducted from commission.'],
        ['customer','balance','Customer remaining 75%','Return to the exact accepted customer handoff. Create post-install balance checkout and use the explicitly simulated provider. Then inspect actual verified payment records.'],
        ['sales','commissions','Representative qualifying earnings','Review real isolated earned entries. Completion, final verified receipt, actual-cost review and processing fees—not estimates—control the amount.'],
        ['admin','commissions','Friday commission review & export','Review the actual ledger. Create the Friday run using sample policy/date, approve it and export using the real forms. Download is review bookkeeping, not sending money.'],
        ['admin','settlement','Settlement-recording exercise','After export, inspect the actual settlement form. Use clearly synthetic method/reference/beneficiaries evidence and explicitly confirm reconciliation. This records only simulated evidence and never initiates a transfer.']
    ].map(([role,mode,title,instructions]) => ({role,mode,title,instructions}));
    const frame = document.getElementById('application');
    let step = 0, state, busy = false, loaded = false, manualRole, navigationVersion=0, documentVersion=0, pendingNavigation=0, selectingPhoto=false;
    const error = text => { document.getElementById('error').textContent = text || ''; };
    async function status() {
        const response = await fetch('/walkthrough/status', {cache:'no-store'});
        const data = await response.json(); if (!response.ok || data.ok === false) throw Error(data.error || 'Scenario unavailable.');
        state = data;
        document.getElementById('journey').textContent = [data.customer?.name || 'Create your synthetic customer',
            data.stage || 'Prospect not yet created', data.totalCents != null ? 'Quote $' + (data.totalCents / 100).toFixed(2) : '',
            data.netPaidCents != null ? 'Verified synthetic paid $' + (data.netPaidCents / 100).toFixed(2) : '',
            data.nextAction || ''].filter(Boolean).join(' · ');
        document.querySelectorAll('[data-scenario]').forEach(button => button.setAttribute('aria-pressed', button.dataset.scenario === data.scenario));
        document.querySelector('[data-role="customer"]').disabled = !data.agreementUrl;
        return data;
    }
    function position() {
        if (!loaded || !state) return;
        const s = steps[step], role = manualRole || s.role;
        if (!['sales','admin'].includes(role)) return;
        const detail = manualRole ? role==='sales'&&!!state.leadId : ['detail','quote','approval','present'].includes(s.mode);
        const mode = manualRole ? (detail?'opportunities':role==='admin'&&state.orderId?'orders':'dashboard') :
            detail ? 'opportunities' : ['enroll','documents','schedule','preparation','assign','costReview'].includes(s.mode) ? 'orders' :
            s.mode === 'settlement' ? 'commissions' : s.mode;
        const focus = { new:'[data-sales-form="create"]',detail:'[data-sales-form="save"]', quote:'[data-commerce-create]', approval:'[data-commerce-review]',
            enroll:'[data-workflow-form="enroll"]', documents:'[data-workflow-form="documents_publish"]',
            present:'[data-commerce-agreement]', schedule:'[data-workflow-form="schedule"],[data-workflow-form="reschedule"]',
            preparation:'[data-workflow-form="preparation"]', assign:'[data-workflow-form="assign"]',
            costReview:'[data-workflow-form="cost_review"]', settlement:'[data-earnings-form="record_settlement"]' }[s.mode];
        frame.contentWindow.postMessage({type:'h2s-review-position',mode,leadId:detail?state.leadId:null,focus:manualRole?null:focus,navigationVersion,documentVersion},location.origin);
    }
    function draw() {
        const s = steps[step], role = manualRole || s.role;
        document.getElementById('step-label').textContent = (step+1) + '/' + steps.length + ' · ' + role;
        document.getElementById('instructions').textContent = s.instructions;
        document.getElementById('back').disabled = step === 0;
        document.getElementById('forward').disabled = step === steps.length-1;
        document.querySelectorAll('[data-role]').forEach(button => button.setAttribute('aria-pressed', button.dataset.role === role));
        document.querySelectorAll('[data-step]').forEach(button => button.setAttribute('aria-current', Number(button.dataset.step) === step ? 'step' : 'false'));
    }
    async function open(refresh = true) {
        const version=++navigationVersion;
        pendingNavigation=version;
        try{
        error('');
        document.getElementById('suggest').disabled=true;document.getElementById('photo').disabled=true;
        await status();if(version!==navigationVersion)return;draw();
        const role = manualRole || steps[step].role;
        if (role === 'customer' && !state.agreementUrl) {
            error('No customer handoff exists yet. Complete actual quote approval, enrollment/copies and Prepare exact-quote agreement first.'); return;
        }
        if (role === 'pro' && !state.jobId) {
            error('No scheduled job exists yet. Complete management scheduling before the technician journey.'); return;
        }
        const url = role === 'customer' ? state.agreementUrl : role === 'pro' ? '/portal.html?reviewRole=PRO' :
            '/dash.html?reviewRole=' + (role === 'sales' ? 'SALES' : 'ADMIN') + '&reviewTab=fieldsales';
        const target = new URL(url,location.origin);
        if (target.origin !== location.origin) throw Error('External application handoff blocked.');
        target.searchParams.set('reviewNavigation',String(version));
        if (refresh || !loaded || frame.dataset.role !== role) { loaded = false; documentVersion=version; frame.dataset.role = role; frame.src = target.href; }
        else {
            position();
            if(['customer','pro'].includes(role)){document.getElementById('suggest').disabled=false;document.getElementById('photo').disabled=false;}
        }
        }finally{if(pendingNavigation===version)pendingNavigation=0;}
    }
    async function control(action, extra) {
        if (busy) return; busy = true; error('');
        try {
            const response = await fetch('/walkthrough/control', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...extra})});
            const data = await response.json(); if (!response.ok || data.ok === false) throw Error(data.error || 'Review action rejected.');
            step = 0; manualRole = null; await open();
        } catch (e) { error(e.message); } finally { busy = false; }
    }
    function setValue(element,value) {
        if (!element || element.disabled || value == null) return;
        if(element.type==='checkbox'||element.type==='radio')return;
        if(element._flatpickr){element._flatpickr.setDate(/^\d{4}-\d\d-\d\dT/.test(String(value))?new Date(value):String(value),true);return;}
        if(element.readOnly)return;
        if(element.type==='datetime-local'&&/^\d{4}-\d\d-\d\dT/.test(String(value))){
            const date=new Date(value),pad=n=>String(n).padStart(2,'0');
            element.value=date.getFullYear()+'-'+pad(date.getMonth()+1)+'-'+pad(date.getDate())+'T'+pad(date.getHours())+':'+pad(date.getMinutes());
        }else element.value = String(value);
        element.dispatchEvent(new Event('input',{bubbles:true})); element.dispatchEvent(new Event('change',{bubbles:true}));
    }
    async function fill() {
        error(''); await status();
        const doc = frame.contentDocument; if (!doc) throw Error('Application screen unavailable.');
        const mode = steps[step].mode, hints = state.suggestions || {};
        const put = (selector,value) => setValue(doc.querySelector(selector),value);
        if (mode === 'new') {
            for (const [name,value] of Object.entries(hints.prospect || {fullName:'SYNTHETIC Review Customer',phone:'+15550007891',address:'100 Synthetic Review Lane',city:'Synthetic City',market:'residential',notes:'Isolated visual review only.'}))
                if(name!=='services')put('[data-sales-form="create"] [name="'+name+'"]',value);
            const service = doc.querySelector('[data-sales-form="create"] [name="services"][value="'+(hints.assessmentServiceId || (state.scenario==='camera'?'cameras_included':'tv_mounting'))+'"]');
            if(service){service.checked=true;service.dispatchEvent(new Event('change',{bubbles:true}));}
        } else if (mode === 'detail') {
            for (const input of doc.querySelectorAll('[data-question]')) {
                const value=(hints.assessment || {})[input.dataset.question];
                if(value!=null)setValue(input,value); else if(input.type==='number')setValue(input,input.dataset.question==='quantity'?(state.scenario==='camera'?2:1):65);
                else if(input.tagName==='SELECT')setValue(input,input.options[1]?.value);else setValue(input,'Synthetic standard installation');
            }
            put('[data-sales-form="save"] [name="consentNote"]','Synthetic permission only; no real property or person photographed.');
            put('[data-sales-form="save"] [name="notes"]','Synthetic assessed scope and customer access.');
        } else if(mode==='quote'){
            put('[data-commerce-offer]',hints.offerValue || (state.scenario==='camera'?'equipment_cameras:package':'tv_mounting:standard'));
            put('[data-commerce-inputs] [name="quantity"]',hints.quantity || (state.scenario==='camera'?2:1));
            for(const input of doc.querySelectorAll('[data-q]'))setValue(input,(hints.quoteAnswers||{})[input.dataset.q] ?? (input.type==='number'?65:input.tagName==='SELECT'?(state.scenario==='exception'?'masonry':input.options[1]?.value):'Synthetic assessed installation'));
            if(state.scenario==='exception')put('[name="exceptionNote"]','Synthetic nonstandard masonry installation: management approval required.');
        } else if(mode==='agreement'){
            if(!doc.querySelector('[data-agreement-accept]'))throw Error('Customer acceptance form is not available yet, or acceptance is already recorded. Review the actual customer page before continuing.');
            put('[data-agreement-accept] [name="name"]',state.customer?.name || 'SYNTHETIC Review Customer');
            put('[data-agreement-accept] [name="email"]','review-customer@example.invalid');
        } else if(mode==='costs'){
            const form=doc.querySelector('[data-installation-form]');
            if(!form)throw Error('Open the assigned job detail and enrolled installation component first.');
            const expenses=hints.costs || [
                {quantity:state.scenario==='camera'?2:1,unitCents:state.scenario==='camera'?12000:2500,amountCents:state.scenario==='camera'?24000:2500},
                {quantity:1,unitCents:1200,amountCents:1200}
            ];
            for(const [index,row] of [...form.querySelectorAll('[data-installation-expense]')].entries()){
                for(const [name,value] of Object.entries(expenses[index]||{}))setValue(row.querySelector('[name="'+name+'"]'),value);
                setValue(row.querySelector('[name="expenseEvidence"]'),'SYNTHETIC actual installed supplies for this test only.');
            }
            setValue(form.elements.hours,'2');
            for(const textarea of form.querySelectorAll('textarea'))if(!textarea.value&&!textarea.name.includes('zero'))setValue(textarea,'SYNTHETIC installation evidence only.');
        } else {
            const selector={approval:'[data-commerce-approve]',enroll:'[data-workflow-form="enroll"]',documents:'[data-workflow-form="documents_publish"]',
                schedule:'[data-workflow-form="schedule"],[data-workflow-form="reschedule"]',preparation:'[data-workflow-form="preparation"]',
                assign:'[data-workflow-form="assign"]',costReview:'[data-workflow-form="cost_review"]',
                commissions:'[data-earnings-form="create_run"]',settlement:'[data-earnings-form="record_settlement"]'}[mode];
            const form=selector&&doc.querySelector(selector);
            if(!form)throw Error('Required real form is not yet available. Complete its prerequisites and refresh this screen.');
            form.closest('details')?.setAttribute('open','');
            const values={reason:'Synthetic reviewed installation scope.',scopeConfirmation:'Synthetic approved scope: quoted service, site access and required proof.',
                evidence:'SYNTHETIC review evidence only; no real approval, receipt or settlement.',
                note:'Synthetic reviewed readiness; equipment and access confirmed for isolated test.',
                timezone:'UTC',...hints[mode]};
            for(const [name,value] of Object.entries(values))setValue(form.elements.namedItem(name),typeof value==='object'?JSON.stringify(value):value);
            if(mode==='preparation'){setValue(form.elements.materials,'ready');setValue(form.elements.access,'ready');}
            if(mode==='costReview')for(const input of form.querySelectorAll('[name="rowEvidence"]'))setValue(input,'SYNTHETIC evidenced actual installed supplies.');
        }
        document.getElementById('instructions').textContent=steps[step].instructions+' Sample values filled; review and explicitly acknowledge before submitting.';
    }
    async function photo() {
        error('');
        const doc=frame.contentDocument, version=navigationVersion;
        const inputs=[...doc.querySelectorAll('input[type="file"]')].filter(input=>!input.disabled&&/image|photo/i.test(input.accept+' '+input.name+' '+input.id));
        const role=manualRole||steps[step].role;
        let input=role==='pro'
            ? inputs.find(input=>input.id==='modal-upload-'+state.jobId)||inputs.find(input=>input.id==='upload-'+state.jobId)
            : inputs.find(input=>input.name==='photo');
        if(!input)throw Error('Open the actual assessment/photo upload or technician Add photo control first.');
        if(role==='pro'&&!input.onchange){
            const button=frame.contentDocument.querySelector('button[data-photos="'+state.jobId+'"]');
            if(!button)throw Error('The current installation photo control is unavailable.');
            const prototype=frame.contentWindow.HTMLInputElement.prototype;
            const ownClick=Object.getOwnPropertyDescriptor(prototype,'click'), originalClick=prototype.click, jobId=state.jobId;
            // Supply a synthetic File instead of opening the native OS file picker.
            prototype.click=function(){
                if(this.type==='file'&&this.id==='upload-'+jobId)return;
                return originalClick.call(this);
            };
            try{
                button.click();
                for(let i=0;i<50;i++){
                    if(frame.contentDocument!==doc||version!==navigationVersion)throw Error('Review perspective changed. Select the synthetic photo again on the current screen.');
                    input=doc.querySelector('[id="modal-upload-'+state.jobId+'"]')||doc.querySelector('[id="upload-'+state.jobId+'"]');
                    if(input?.onchange)break;
                    await new Promise(resolve=>setTimeout(resolve,100));
                }
                if(!input?.onchange)throw Error('The native photo upload handler did not become available.');
            }finally{
                if(ownClick)Object.defineProperty(prototype,'click',ownClick);else delete prototype.click;
            }
        }
        const blob=await(await fetch('/walkthrough/sample-photo.png')).blob();
        if(frame.contentDocument!==doc||version!==navigationVersion||!input.isConnected)throw Error('Review perspective changed. Select the synthetic photo again on the current screen.');
        const transfer=new frame.contentWindow.DataTransfer();transfer.items.add(new frame.contentWindow.File([blob],'SYNTHETIC-review-photo.png',{type:'image/png'}));
        input.files=transfer.files;input.dispatchEvent(new frame.contentWindow.Event('change',{bubbles:true}));
        document.getElementById('instructions').textContent=steps[step].instructions+(role==='pro'
            ? ' Synthetic checkerboard selected; confirm the actual native upload preview and verify the saved photo.'
            : ' Synthetic checkerboard selected; use the actual Upload control.');
    }
    document.getElementById('steps').innerHTML=steps.map((s,i)=>'<li><button data-step="'+i+'">'+(i+1)+'. '+s.title+'</button></li>').join('');
    document.getElementById('steps').onclick=event=>{const b=event.target.closest('[data-step]');if(b){step=Number(b.dataset.step);manualRole=null;open().catch(e=>error(e.message));}};
    document.querySelectorAll('[data-scenario]').forEach(button=>button.onclick=()=>{if(confirm('Reset disposable synthetic state and select this scenario? Unsaved form entries in this walkthrough will be lost.'))control('reset',{scenario:button.dataset.scenario});});
    document.getElementById('reset').onclick=()=>{if(confirm('Reset only the isolated synthetic scenario?'))control('reset',{scenario:state.scenario});};
    document.querySelectorAll('[data-role]').forEach(button=>button.onclick=()=>{manualRole=button.dataset.role;open().catch(e=>error(e.message));});
    for(const [id,offset] of [['back',-1],['forward',1]])document.getElementById(id).onclick=()=>{step=Math.max(0,Math.min(steps.length-1,step+offset));manualRole=null;open(false).catch(e=>error(e.message));};
    document.getElementById('refresh').onclick=()=>open().catch(e=>error(e.message));
    document.getElementById('current').onclick=()=>{manualRole=null;if(state.leadId&&['sales','admin'].includes(steps[step].role))step=steps[step].role==='admin'?4:2;open().catch(e=>error(e.message));};
    document.getElementById('suggest').onclick=()=>fill().catch(e=>error(e.message));
    document.getElementById('photo').onclick=async()=>{
        if(selectingPhoto)return;
        selectingPhoto=true;const version=navigationVersion;document.getElementById('photo').disabled=true;
        try{await photo();}catch(e){error(e.message);}
        finally{selectingPhoto=false;if(version===navigationVersion)document.getElementById('photo').disabled=false;}
    };
    addEventListener('message',event=>{
        if(event.origin!==location.origin||event.source!==frame.contentWindow||event.data?.documentVersion!==documentVersion)return;
        if(event.data?.type==='h2s-review-ready'){
            loaded=true;position();
            if(['customer','pro'].includes(frame.dataset.role)){document.getElementById('suggest').disabled=false;document.getElementById('photo').disabled=false;}
        }
        if(event.data?.type==='h2s-review-positioned'&&event.data.navigationVersion===navigationVersion){document.getElementById('suggest').disabled=false;document.getElementById('photo').disabled=false;}
        if(event.data?.type==='h2s-review-change')status().catch(e=>error(e.message));
        if(event.data?.type==='h2s-review-position-failed'&&event.data.navigationVersion===navigationVersion)error('This real form is not available yet. Review the current server state and prerequisites; no transition has been invented.');
        if(event.data?.type==='h2s-review-navigation'){
            if(pendingNavigation)return;
            const url=new URL(event.data.url,location.origin);if(url.origin!==location.origin){error('External navigation blocked.');return;}
            if(url.pathname==='/field-agreement.html'||url.pathname==='/walkthrough/provider'){frame.dataset.role='customer';manualRole='customer';draw();}
            documentVersion=++navigationVersion;url.searchParams.set('reviewNavigation',String(documentVersion));
            loaded=false;document.getElementById('suggest').disabled=true;document.getElementById('photo').disabled=true;frame.src=url.href;
        }
    });
    setInterval(()=>status().catch(e=>error(e.message)),5000);
    open().catch(e=>error(e.message));
})();

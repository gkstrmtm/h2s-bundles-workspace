(function () {
    'use strict';
    const fragment=location.hash;
    let token=new URLSearchParams(fragment.slice(1)).get('token');
    history.replaceState(null,'',location.pathname);
    const status=document.querySelector('[data-agreement-status]'),content=document.querySelector('[data-agreement-content]'),
        base=document.querySelector('meta[name="h2s-api-base"]').content.replace(/\/+$/,'').replace(/\/api$/i,'');
    const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const money=value=>Number.isSafeInteger(value)?new Intl.NumberFormat(undefined,{style:'currency',currency:'USD'}).format(value/100):'Evidence pending';
    const copyText=value=>typeof value==='string'?value:JSON.stringify(value,null,2);
    let facts,busy=false,attempt,ended=false,sync,dirty=false,edits=0,readVersion=0;
    const lifetime=new AbortController();
    const downloads=new Set();
    addEventListener('pagehide',()=>{ended=true;sync?.destroy();lifetime.abort();token='';facts=attempt=null;for(const url of downloads)URL.revokeObjectURL(url);downloads.clear();content.replaceChildren();message('Reopen the secure agreement link to continue.');});
    function message(text,error=false){
        status.textContent=text;status.setAttribute('role',error?'alert':'status');
        if(error&&sync&&!ended){
            const button=document.createElement('button');button.type='button';button.textContent=attempt?'Discard interrupted action':'Retry';
            button.onclick=()=>{
                if(attempt){if(!confirm('Discard this interrupted retry? Your entered acceptance remains. Ask Home2Smart to confirm the prior server outcome before another action.'))return;attempt=null;message('Interrupted retry discarded. Your inputs are retained.');}
                else sync.request('retry',{force:true});
            };
            status.append(' ',button);
        }
    }
    async function request(body){
        const response=await fetch(base+'/api/field-sales-agreement',{method:body?'POST':'GET',cache:'no-store',referrerPolicy:'no-referrer',
            signal:!body&&window.H2SDataSync?window.H2SDataSync.signal(lifetime.signal):lifetime.signal,
            headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
        const result=await response.json();if(ended)throw Error('Agreement page ended. Reopen the secure link.');
        if([401,403,410].includes(response.status)){
            ended=true;sync?.destroy();lifetime.abort();token='';facts=attempt=null;content.replaceChildren();
            const text=(result.error||'Secure link unavailable.')+' Ask Home2Smart for a fresh finite customer-copy/payment link. An expired link cannot record late initial acceptance.';
            message(text,true);throw Error(text);
        }
        if(!response.ok||!result.ok)throw Error(result.error||'Agreement unavailable. No acceptance or payment is implied.');return result;
    }
    function render(){
        const q=facts.quote,s=q.snapshot,a=facts.agreement,p=a.policy_snapshot;
        for(const url of downloads)URL.revokeObjectURL(url);downloads.clear();
        content.innerHTML=`<h3>${esc(s.customer.name)}</h3><p>${esc(s.customer.address)} / ${esc(s.customer.city)} / ${esc(s.customer.phone)}</p>
            <p>Exact quote revision ${esc(q.revision)} / ${esc(s.catalogVersion)}</p>
            ${s.lines.map(line=>`<article><h3>${esc(line.service)} / ${esc(line.description)}</h3><p>Quantity ${esc(line.quantity)}; base ${money(line.baseCents)}</p>
                <p>Equipment/materials: ${esc(line.equipment.join('; '))}</p><p>Scope: ${esc(line.scope.join('; '))}</p>
                ${Object.entries(line.answers||{}).map(([id,value])=>`<p>${esc(line.answerLabels?.[id]||id)}: ${esc(value)}</p>`).join('')}
                ${line.addOns.map(a=>`<p>${esc(a.label)}: ${money(a.amountCents)}</p>`).join('')}<p>Line total: ${money(line.totalCents)}</p>
                <p>Exclusions/conditions: ${esc(line.exclusions.join('; '))}</p></article>`).join('')}
            ${s.managementReview?`<p>Approved scope confirmation: ${esc(s.managementReview.scopeConfirmation)}</p>`:''}
            ${s.managementAdjustmentCents!==undefined?`<p>Management adjustment: ${money(s.managementAdjustmentCents)}</p>`:''}
            <h3>Approved quote total: ${money(s.totalCents)}</h3><p>Quote valid until ${esc(new Date(q.expires_at).toLocaleString())}</p>
            ${p.paymentPlan?.depositCents>0?`<p>${facts.workflow?'Exact new-sales 25% deposit':'Approved optional deposit'}: ${money(p.paymentPlan.depositCents)}; remaining balance: ${money(p.paymentPlan.remainingAfterDepositCents)}.${facts.workflow?' Net balance is collected after installation.':' Full payment: '+money(p.paymentPlan.fullCents)+'.'} Payment terms are shown below.</p>`:''}
            <p class="field-sales__id">Quote ${esc(q.quote_id)} / ${esc(q.quote_hash)}</p><h3>Agreement version ${esc(p.version)}</h3>
            <h4>Service agreement</h4><pre>${esc(p.terms)}</pre><h4>Payment terms</h4><pre>${esc(p.payment_terms)}</pre>
            <h4>Cancellation information</h4><pre>${esc(p.cancellation_information)}</pre><h4>Electronic delivery</h4><pre>${esc(p.electronic_delivery)}</pre>
            ${facts.workflow?`<h3>Approved immutable customer copies & notices</h3>
                <p>These copies belong to this exact approved quote. Retrieval is recorded by the secure server. Download and retain them before acknowledging acceptance.</p>
                ${(facts.workflow.documents||[]).map((doc,index)=>`<section><h4>${esc(doc.label)} / ${esc(doc.kind)}</h4>
                    <p class="field-sales__id">${esc(doc.contentHash)}</p><pre>${esc(copyText(doc.content))}</pre><button type="button" data-agreement-download="${index}">Download ${esc(doc.label)}</button></section>`).join('')||'<p>Approved copies unavailable. Acceptance and legal clearance remain blocked.</p>'}
                <p>Cancellation deadline: ${facts.workflow.cancellationDeadline?esc(new Date(facts.workflow.cancellationDeadline).toLocaleString()):'Not established — legal policy and delivery evidence required'}. Deposit alone is not scheduling clearance.</p>`:''}
            ${a.accepted_at?`<p>Acceptance recorded ${esc(new Date(a.accepted_at).toLocaleString())} by ${esc(a.acceptance.name)}. This is not a payment receipt.</p>`:
                `<form class="field-sales__form" data-agreement-accept><label>Your full name<input name="name" autocomplete="name" maxlength="120" required></label>
                <label>Email for this agreement<input name="email" type="email" autocomplete="email" maxlength="254" required></label>
                <label class="field-sales__wide field-sales__check"><input type="checkbox" name="accepted" required>I have reviewed and accept this exact quote, agreement and ${facts.workflow?'approved immutable copies and notices':'terms'} shown above.</label>
                <label class="field-sales__wide field-sales__check"><input type="checkbox" name="electronicDelivery" required>I have reviewed and consent to the electronic delivery information shown above.</label>
                <button type="submit"${facts.workflow&&!(facts.workflow.documents||[]).length?' disabled':''}>Record customer acceptance</button></form>`}
            ${facts.workflow?`<h3>Secure deposit, installation & balance</h3>
                <p>Total verified payments (net of refunds): ${money(facts.workflow.netPaidCents)}. Outstanding balance: ${money(facts.workflow.balanceCents)}.</p>
                <p>Installation: ${facts.workflow.completedAt?'Completion recorded '+esc(new Date(facts.workflow.completedAt).toLocaleString()):'Not completed — balance collection blocked'}.</p>
                <p>${esc((facts.workflow.holds||[]).join('; '))}</p>
                ${(facts.workflow.payments||[]).map(payment=>`<article><p>${esc(payment.state)} / verified captured ${money(payment.captured_cents)} / refunded ${money(payment.refunded_cents)}${payment.disputed?' / Dispute review — payment clearance blocked':''}</p>
                    <button type="button" data-agreement-verify="${esc(payment.checkout_id)}">Verify this payment with provider</button></article>`).join('')||'<p>No verified payment records. Acceptance is not a receipt.</p>'}
                <button type="button" data-agreement-checkout="${facts.workflow.netPaidCents>0?'balance':'deposit'}"${(facts.workflow.netPaidCents>0?facts.workflow.gates?.canBalance:facts.workflow.gates?.canDeposit)===true?'':' disabled'}>Open secure ${facts.workflow.netPaidCents>0?'post-install net balance':'25% deposit'} checkout</button>
                <p>No card details are entered here. Checkout creation or return is never proof of payment. Current approved gates are checked again by the server.</p>
                <div data-agreement-handoff></div>`:''}`;
        message(a.accepted_at?'Acceptance recorded. Payment is verified separately.':'Review the complete quote and approved agreement before accepting. No card details are collected on this page.');
    }
    if(fragment==='#checkout-returned'||fragment==='#checkout-cancelled'){message('Checkout returned or was canceled. This page does not verify payment. Ask your representative to verify the payment status with Stripe.');return;}
    if(!token||!/^[a-f0-9]{64}$/.test(token)){message('Secure agreement link missing or invalid. Contact Home2Smart.',true);return;}
    async function paymentAction(body){
        if(busy||ended)return;
        if(attempt&&attempt.action!==body.action){message('Retry the interrupted action or explicitly discard it before choosing a different action.',true);return;}
        busy=true;readVersion++;attempt||={...body,operationId:crypto.randomUUID()};
        try{
            message('Verifying secure server handoff. No payment is implied.');
            const result=await request(attempt);attempt=null;
            facts=await request();dirty=false;render();
            if(result.checkoutUrl){
                const url=new URL(result.checkoutUrl);if(url.protocol!=='https:'||url.hostname!=='checkout.stripe.com')throw Error('Untrusted checkout URL. No link opened.');
                const a=document.createElement('a');a.href=url.href;a.target='_blank';a.rel='noopener noreferrer';a.textContent='Continue to secure checkout — not a payment receipt';content.querySelector('[data-agreement-handoff]').append(a);
                message('Checkout created, not paid. Return to this secure page and verify the provider record after checkout.');
            }else message('Provider records refreshed. Only the verified amounts and states shown above establish payment.');
        }catch(error){if(!ended){console.error('Customer payment action failed:',error.message);message(error.message+' Retry the same action with its retained key.',true);}}
        finally{busy=false;}
    }
    content.addEventListener('click',async event=>{
        if(busy||ended)return;
        const payment=event.target.closest('[data-agreement-checkout],[data-agreement-verify]');
        if(payment){
            if(payment.dataset.agreementVerify)paymentAction({action:'refresh_payment',checkoutId:payment.dataset.agreementVerify});
            else paymentAction({action:'checkout',kind:payment.dataset.agreementCheckout});
            return;
        }
        const button=event.target.closest('[data-agreement-download]');if(!button||ended)return;
        const doc=facts.workflow?.documents?.[Number(button.dataset.agreementDownload)];if(!doc)return;
        const blob=new Blob([copyText(doc.content)],{type:'text/plain;charset=utf-8'}),url=URL.createObjectURL(blob);downloads.add(url);
        const a=document.createElement('a');a.href=url;a.download=`Home2Smart-${String(doc.kind||'copy').replace(/[^a-z0-9-]/gi,'')}-${String(doc.contentHash||'approved').replace(/[^a-z0-9]/gi,'').slice(0,16)}.txt`;a.textContent='Download approved copy';content.append(a);a.click();a.remove();
    });
    content.addEventListener('submit',async event=>{
        const form=event.target.closest('[data-agreement-accept]');if(!form)return;event.preventDefault();if(busy)return;busy=true;readVersion++;
        try{if(attempt?.action)throw Error('A payment operation is interrupted. Retry it unchanged before accepting a different operation.');if(!attempt)attempt={operationId:crypto.randomUUID(),name:form.elements.name.value,email:form.elements.email.value,
            quoteHash:facts.quote.quote_hash,policyVersion:facts.agreement.policy_snapshot.version,
            accepted:form.elements.accepted.checked,electronicDelivery:form.elements.electronicDelivery.checked};
            message('Recording the exact acceptance. Interrupted requests keep the same retry key.');
            facts=await request(attempt);attempt=null;dirty=false;render();
        }catch(error){console.error('Customer agreement acceptance failed.');message(error.message,true);}finally{busy=false;}
    });
    const edited=event=>{if(event.target.closest('form')){dirty=true;edits++;}};
    content.addEventListener('input',edited);content.addEventListener('change',edited);
    async function synchronize(){
        const read=++readVersion,edit=edits,result=await request();
        if(ended||read!==readVersion||busy||dirty||edit!==edits||window.H2SDataSync?.interacting(content))return false;
        const links=facts?.quote?.quote_hash===result.quote?.quote_hash?[...content.querySelector('[data-agreement-handoff]')?.childNodes||[]]:[];
        facts=result;render();content.querySelector('[data-agreement-handoff]')?.append(...links);return true;
    }
    sync=window.H2SDataSync?.register({id:'customer-agreement',isActive:()=>!ended&&!!token,isDirty:()=>dirty||busy||!!attempt||window.H2SDataSync.interacting(content),
        refresh:synchronize,onState:s=>{if(!attempt)window.H2SDataSync.feedback(document,'[data-agreement-status]',s,()=>sync.request('retry',{force:true}));}});
    if(sync)sync.request('mount',{force:true});
    else synchronize().catch(error=>{console.error('Customer agreement read failed.');message(error.message+' Ask Home2Smart for a valid finite link if it expired.',true);});
})();

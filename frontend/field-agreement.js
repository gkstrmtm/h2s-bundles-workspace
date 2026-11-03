(function () {
    'use strict';
    const fragment=location.hash;
    let token=new URLSearchParams(fragment.slice(1)).get('token');
    history.replaceState(null,'',location.pathname);
    const status=document.querySelector('[data-agreement-status]'),content=document.querySelector('[data-agreement-content]'),
        base=document.querySelector('meta[name="h2s-api-base"]').content.replace(/\/$/,'');
    const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const money=value=>value===null?'Unpriced':new Intl.NumberFormat(undefined,{style:'currency',currency:'USD'}).format(value/100);
    let facts,busy=false,attempt,ended=false;
    addEventListener('pagehide',()=>{ended=true;token='';facts=attempt=null;content.replaceChildren();message('Reopen the secure agreement link to continue.');});
    function message(text,error=false){status.textContent=text;status.setAttribute('role',error?'alert':'status');}
    async function request(body){
        const response=await fetch(base+'/api/field-sales-agreement',{method:body?'POST':'GET',cache:'no-store',referrerPolicy:'no-referrer',
            headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
        const result=await response.json();if(ended)throw Error('Agreement page ended. Reopen the secure link.');if(!response.ok||!result.ok)throw Error(result.error||'Agreement unavailable. No acceptance or payment is implied.');return result;
    }
    function render(){
        const q=facts.quote,s=q.snapshot,a=facts.agreement,p=a.policy_snapshot;
        content.innerHTML=`<h3>${esc(s.customer.name)}</h3><p>${esc(s.customer.address)} / ${esc(s.customer.city)} / ${esc(s.customer.phone)}</p>
            <p>Exact quote revision ${q.revision} / ${esc(s.catalogVersion)}</p>
            ${s.lines.map(line=>`<article><h3>${esc(line.service)} / ${esc(line.description)}</h3><p>Quantity ${line.quantity}; base ${money(line.baseCents)}</p>
                <p>Equipment/materials: ${esc(line.equipment.join('; '))}</p><p>Scope: ${esc(line.scope.join('; '))}</p>
                ${Object.entries(line.answers||{}).map(([id,value])=>`<p>${esc(line.answerLabels?.[id]||id)}: ${esc(value)}</p>`).join('')}
                ${line.addOns.map(a=>`<p>${esc(a.label)}: ${money(a.amountCents)}</p>`).join('')}<p>Line total: ${money(line.totalCents)}</p>
                <p>Exclusions/conditions: ${esc(line.exclusions.join('; '))}</p></article>`).join('')}
            ${s.managementReview?`<p>Approved scope confirmation: ${esc(s.managementReview.scopeConfirmation)}</p>`:''}
            ${s.managementAdjustmentCents!==undefined?`<p>Management adjustment: ${money(s.managementAdjustmentCents)}</p>`:''}
            <h3>Total: ${money(s.totalCents)}</h3><p>Quote valid until ${esc(new Date(q.expires_at).toLocaleString())}</p>
            ${p.paymentPlan?.depositCents>0?`<p>Approved optional deposit: ${money(p.paymentPlan.depositCents)}; remaining balance: ${money(p.paymentPlan.remainingAfterDepositCents)}. Full payment: ${money(p.paymentPlan.fullCents)}. Payment terms are shown below.</p>`:''}
            <p class="field-sales__id">Quote ${esc(q.quote_id)} / ${esc(q.quote_hash)}</p><h3>Agreement version ${esc(p.version)}</h3>
            <h4>Service agreement</h4><pre>${esc(p.terms)}</pre><h4>Payment terms</h4><pre>${esc(p.payment_terms)}</pre>
            <h4>Cancellation information</h4><pre>${esc(p.cancellation_information)}</pre><h4>Electronic delivery</h4><pre>${esc(p.electronic_delivery)}</pre>
            ${a.accepted_at?`<p>Acceptance recorded ${esc(new Date(a.accepted_at).toLocaleString())} by ${esc(a.acceptance.name)}. This is not a payment receipt.</p>`:
                `<form class="field-sales__form" data-agreement-accept><label>Your full name<input name="name" autocomplete="name" maxlength="120" required></label>
                <label>Email for this agreement<input name="email" type="email" autocomplete="email" maxlength="254" required></label>
                <label class="field-sales__wide field-sales__check"><input type="checkbox" name="accepted" required>I have reviewed and accept this exact quote and the agreement shown above.</label>
                <label class="field-sales__wide field-sales__check"><input type="checkbox" name="electronicDelivery" required>I have reviewed and consent to the electronic delivery information shown above.</label>
                <button type="submit">Record customer acceptance</button></form>`}`;
        message(a.accepted_at?'Acceptance recorded. Payment is verified separately.':'Review the complete quote and approved agreement before accepting. No payment is collected on this page.');
    }
    if(fragment==='#checkout-returned'||fragment==='#checkout-cancelled'){message('Checkout returned or was canceled. This page does not verify payment. Ask your representative to verify the payment status with Stripe.');return;}
    if(!token||!/^[a-f0-9]{64}$/.test(token)){message('Secure agreement link missing or invalid. Contact Home2Smart.',true);return;}
    content.addEventListener('submit',async event=>{
        const form=event.target.closest('[data-agreement-accept]');if(!form)return;event.preventDefault();if(busy)return;busy=true;
        try{if(!attempt)attempt={operationId:crypto.randomUUID(),name:form.elements.name.value,email:form.elements.email.value,
            quoteHash:facts.quote.quote_hash,policyVersion:facts.agreement.policy_snapshot.version,
            accepted:form.elements.accepted.checked,electronicDelivery:form.elements.electronicDelivery.checked};
            message('Recording the exact acceptance. Interrupted requests keep the same retry key.');
            facts=await request(attempt);attempt=null;render();
        }catch(error){console.error('Customer agreement acceptance failed.');message(error.message,true);}finally{busy=false;}
    });
    request().then(result=>{facts=result;render();}).catch(error=>{console.error('Customer agreement read failed.');message(error.message,true);});
})();

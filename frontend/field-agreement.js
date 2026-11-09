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
    const signatureIntent='I intend to electronically sign this exact Home2Smart service agreement.';
    let reachedEnd=false,reviewedBundle='',reviewObserver;
    addEventListener('pagehide',()=>{ended=true;sync?.destroy();reviewObserver?.disconnect();lifetime.abort();token='';facts=attempt=null;for(const url of downloads)URL.revokeObjectURL(url);downloads.clear();content.replaceChildren();message('Reopen the secure agreement link to continue.');});
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
    function customerDocuments(){
        const workflow=facts.workflow||{};
        if(facts.agreement.accepted_at&&Array.isArray(workflow.acceptedDocuments)){
            return workflow.acceptedDocuments.map(doc=>{
                const value=doc.content||doc,html=value.html||'';
                const parsed=new DOMParser().parseFromString(html,'text/html');
                return {kind:doc.kind,version:value.version||doc.version,label:doc.label,
                    contentHash:value.contentHash||doc.contentHash,html,text:parsed.body.textContent||''};
            });
        }
        return workflow.reviewDocuments||[];
    }
    function documentExperience(){
        const documents=customerDocuments(),agreement=documents.find(doc=>doc.kind==='agreement'),
            notices=documents.filter(doc=>doc.kind==='notice'&&doc.version!=='electronic-records-v1'),consent=documents.find(doc=>doc.kind==='electronic_consent'||doc.version==='electronic-records-v1');
        if(!agreement)return `<p role="alert">${esc(facts.signatureUnavailableReason||'Required customer documents are unavailable. New acceptance and checkout remain blocked.')}</p>`;
        return `<section class="agreement-document"><h3>Full customer service agreement</h3>
            <p>Review the exact document below. Reaching its end enables the signing controls; it does not prove every word was read.</p>
            <div class="agreement-controls"><button type="button" data-agreement-end-link>Go to end of agreement</button>
                <button type="button" data-customer-document="${documents.indexOf(agreement)}">Download agreement copy (HTML)</button></div>
            <div class="agreement-review" tabindex="0" role="region" aria-label="Full customer service agreement">
                <pre>${esc(agreement.text)}</pre><p data-agreement-end tabindex="-1">End of service agreement.</p>
            </div><p class="agreement-review-note" data-agreement-review-note>${facts.agreement.accepted_at?'Signed evidence retained.':'Reach the end of the agreement before signing.'}</p></section>
            ${notices.map(doc=>`<section class="agreement-cancellation"><h3>${esc(doc.label)}</h3>
                <pre>${esc(doc.text)}</pre><button type="button" data-customer-document="${documents.indexOf(doc)}">Download this separate cancellation notice (HTML)</button></section>`).join('')}
            ${consent?`<section class="agreement-document"><h3>Electronic records: your choices and requirements</h3><pre>${esc(consent.text)}</pre>
                <button type="button" data-customer-document="${documents.indexOf(consent)}">Download electronic-record disclosure (HTML)</button>
                ${!facts.agreement.accepted_at?'<button type="button" data-agreement-access>Download and open electronic access demonstration (HTML)</button>':''}</section>`:''}
            ${facts.agreement.accepted_at?`<section class="agreement-confirmation"><h3>Signature and acceptance recorded</h3>
                <p>Signed by ${esc(facts.agreement.acceptance.name)} at ${esc(new Date(facts.agreement.accepted_at).toLocaleString())}.</p>
                <p>Intent: ${esc(facts.agreement.acceptance.signatureIntentText||signatureIntent)}</p>
                <p>Exact signed copies are retained. This confirmation is not a payment receipt.</p>
                ${documents.map((doc,index)=>`<button type="button" data-customer-document="${index}">Download retained ${esc(doc.label)}</button>`).join('')}</section>`:
                `<form class="field-sales__form" data-agreement-accept>
                    <label>Your full signature name<input name="name" autocomplete="name" maxlength="120" required></label>
                    <label>Your email for transaction records<input name="email" type="email" autocomplete="email" maxlength="254" required></label>
                    <label class="field-sales__wide">Electronic access code<input name="accessCode" maxlength="8" minlength="8" autocomplete="off" required aria-describedby="agreement-access-help"></label>
                    <p id="agreement-access-help" class="field-sales__wide">Open the downloaded access demonstration and enter its displayed code. Download links alone are not proof that a file was saved.</p>
                    <label class="field-sales__wide field-sales__check"><input type="checkbox" name="agreementAccepted" required>I accept this exact approved quote and customer service agreement.</label>
                    <label class="field-sales__wide field-sales__check"><input type="checkbox" name="cancellationNoticeReceived" required>I acknowledge receipt of both separate cancellation-notice copies. This does not waive cancellation rights.</label>
                    <label class="field-sales__wide field-sales__check"><input type="checkbox" name="electronicRecordsConsent" required>I consent to the electronic-record disclosure for this transaction and have demonstrated access to its HTML format. I may choose paper instead.</label>
                    <p class="field-sales__wide agreement-signature-notice">You, the buyer, may cancel this transaction at any time prior to midnight of the third business day after the date of this transaction. See the attached Notice of Cancellation form for an explanation of this right.</p>
                    <label class="field-sales__wide field-sales__check"><input type="checkbox" name="signatureIntent" required>${esc(signatureIntent)}</label>
                    <button type="submit" disabled>Sign agreement and record acceptance</button>
                </form>`}`;
    }
    function updateSigningControls(){
        const form=content.querySelector('[data-agreement-accept]');
        if(form)form.querySelector('[type="submit"]').disabled=!reachedEnd||!form.checkValidity();
        const note=content.querySelector('[data-agreement-review-note]');
        if(note&&!facts.agreement.accepted_at)note.textContent=reachedEnd?'End reached. Complete each separate acknowledgment and signature; scrolling is not proof of reading.':'Reach the end of the agreement before signing.';
    }
    function bindReviewEnd(){
        reviewObserver?.disconnect();
        if(reviewedBundle!==facts.workflow?.reviewedBundleHash){reviewedBundle=facts.workflow?.reviewedBundleHash||'';reachedEnd=false;}
        const root=content.querySelector('.agreement-review'),end=content.querySelector('[data-agreement-end]');
        if(!root||!end)return;
        const check=()=>{
            const bounds=root.getBoundingClientRect(),marker=end.getBoundingClientRect();
            if(bounds.height>0&&marker.height>0&&marker.top>=bounds.top&&marker.bottom<=bounds.bottom+2){reachedEnd=true;updateSigningControls();}
        };
        root.addEventListener('scroll',check,{passive:true});end.addEventListener('focus',check);
        if(window.IntersectionObserver){reviewObserver=new IntersectionObserver(entries=>{
            if(entries.some(entry=>entry.isIntersecting)){reachedEnd=true;updateSigningControls();}
        },{root,threshold:1});reviewObserver.observe(end);}
        updateSigningControls();check();
    }
    function render(){
        const q=facts.quote,s=q.snapshot,a=facts.agreement,p=a.policy_snapshot;
        const staging=s.pricingStatus==='staging_only'||p.status==='staging_only';
        const documentLabel=doc=>staging&&['agreement','quote'].includes(doc.kind)?'STAGING ONLY '+doc.kind+' copy':doc.label;
        for(const url of downloads)URL.revokeObjectURL(url);downloads.clear();
        content.innerHTML=`${staging?'<p role="note">STAGING ONLY - synthetic test pricing and documents. Not production-approved legal terms or a real customer obligation.</p>':''}<h3>${esc(s.customer.name)}</h3><p>${esc(s.customer.address)} / ${esc(s.customer.city)} / ${esc(s.customer.phone)}</p>
            <p>Exact quote revision ${esc(q.revision)} / ${esc(s.catalogVersion)}</p>
            ${s.lines.map(line=>`<article><h3>${esc(line.service)} / ${esc(line.description)}</h3><p>Quantity ${esc(line.quantity)}; base ${money(line.baseCents)}</p>
                <p>Equipment/materials: ${esc(line.equipment.join('; '))}</p><p>Scope: ${esc(line.scope.join('; '))}</p>
                ${Object.entries(line.answers||{}).map(([id,value])=>`<p>${esc(line.answerLabels?.[id]||id)}: ${esc(value)}</p>`).join('')}
                ${line.addOns.map(a=>`<p>${esc(a.label)}: ${money(a.amountCents)}</p>`).join('')}<p>Line total: ${money(line.totalCents)}</p>
                <p>Exclusions/conditions: ${esc(line.exclusions.join('; '))}</p></article>`).join('')}
            ${s.managementReview?`<p>Approved scope confirmation: ${esc(s.managementReview.scopeConfirmation)}</p>`:''}
            ${s.managementAdjustmentCents!==undefined?`<p>Management adjustment: ${money(s.managementAdjustmentCents)}</p>`:''}
            <h3>${staging?'Staging-only test quote':'Approved quote'} total: ${money(s.totalCents)}</h3><p>Quote valid until ${esc(new Date(q.expires_at).toLocaleString())}</p>
            ${p.paymentPlan?.depositCents>0?`<p>${facts.workflow?'Exact new-sales 25% deposit':'Approved optional deposit'}: ${money(p.paymentPlan.depositCents)}; remaining balance: ${money(p.paymentPlan.remainingAfterDepositCents)}.${facts.workflow?' Net balance is collected after installation.':' Full payment: '+money(p.paymentPlan.fullCents)+'.'} Payment terms are shown below.</p>`:''}
            <h3>Agreement version ${esc(p.version)}</h3>
            ${facts.workflow?.signatureProtocol||a.accepted_at&&facts.workflow?.acceptedDocuments?documentExperience():`<h4>Service agreement</h4><pre>${esc(p.terms)}</pre><h4>Payment terms</h4><pre>${esc(p.payment_terms)}</pre>
            <h4>Cancellation information</h4><pre>${esc(p.cancellation_information)}</pre><h4>Electronic delivery</h4><pre>${esc(p.electronic_delivery)}</pre>
            ${facts.workflow?`<h3>${staging?'Staging-only immutable test':'Approved immutable customer'} copies & notices</h3>
                <p>These copies belong to this exact approved quote. Retrieval is recorded by the secure server. Download and retain them before acknowledging acceptance.</p>
                ${(facts.workflow.documents||[]).map((doc,index)=>`<section><h4>${esc(documentLabel(doc))} / ${esc(doc.kind)}</h4>
                    <p class="field-sales__id">${esc(doc.contentHash)}</p><pre>${esc(copyText(doc.content))}</pre><button type="button" data-agreement-download="${index}">Download ${esc(documentLabel(doc))}</button></section>`).join('')||'<p>Approved copies unavailable. Acceptance and legal clearance remain blocked.</p>'}
                <p>Cancellation deadline: ${facts.workflow.cancellationDeadline?esc(new Date(facts.workflow.cancellationDeadline).toLocaleString()):'Not established — legal policy and delivery evidence required'}. Deposit alone is not scheduling clearance.</p>`:''}
            ${a.accepted_at?`<p>Acceptance recorded ${esc(new Date(a.accepted_at).toLocaleString())} by ${esc(a.acceptance.name)}. This is not a payment receipt.</p>`:
                `<p role="alert">${esc(facts.signatureUnavailableReason||'Updated separate notices and electronic signature are required before new acceptance.')}</p>`}`}
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
        bindReviewEnd();
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
        const endLink=event.target.closest('[data-agreement-end-link]');
        if(endLink){const end=content.querySelector('[data-agreement-end]');end?.scrollIntoView({block:'end'});end?.focus({preventScroll:true});return;}
        const documentButton=event.target.closest('[data-customer-document],[data-agreement-access]');
        if(documentButton){
            const demo=documentButton.hasAttribute('data-agreement-access'),doc=demo?null:customerDocuments()[Number(documentButton.dataset.customerDocument)];
            const html=demo?facts.workflow?.accessDemonstrationHtml:doc?.html;
            if(!html){message('Exact retained customer copy is unavailable. Contact Home2Smart.',true);return;}
            const blob=new Blob([html],{type:'text/html;charset=utf-8'}),url=URL.createObjectURL(blob);downloads.add(url);
            const link=document.createElement('a');link.href=url;link.download=`Home2Smart-${demo?'electronic-access':String(doc.label).replace(/[^a-z0-9-]/gi,'-')}.html`;
            content.append(link);link.click();link.remove();return;
        }
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
        try{if(!reachedEnd)throw Error('Reach the end of the agreement before signing.');if(attempt?.action)throw Error('A payment operation is interrupted. Retry it unchanged before accepting a different operation.');if(!attempt)attempt={operationId:crypto.randomUUID(),name:form.elements.name.value,email:form.elements.email.value,
            quoteHash:facts.quote.quote_hash,policyVersion:facts.agreement.policy_snapshot.version,
            accepted:form.elements.agreementAccepted.checked,electronicDelivery:form.elements.electronicRecordsConsent.checked,
            agreementAccepted:form.elements.agreementAccepted.checked,cancellationNoticeReceived:form.elements.cancellationNoticeReceived.checked,
            electronicRecordsConsent:form.elements.electronicRecordsConsent.checked,signatureIntent:form.elements.signatureIntent.checked,
            signatureIntentText:signatureIntent,accessCode:form.elements.accessCode.value,
            reviewedBundleHash:facts.workflow.reviewedBundleHash,reviewDate:facts.workflow.reviewDate};
            message('Recording the exact acceptance. Interrupted requests keep the same retry key.');
            facts=await request(attempt);attempt=null;dirty=false;render();
        }catch(error){console.error('Customer agreement acceptance failed.');message(error.message,true);}finally{busy=false;}
    });
    const edited=event=>{if(event.target.closest('form')){dirty=true;edits++;updateSigningControls();}};
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

(function (global) {
    'use strict';
    const apiRoot = base => String(base).replace(/\/+$/,'').replace(/\/api$/i,'') + '/api';
    const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const money = value => Number.isSafeInteger(value) ? new Intl.NumberFormat(undefined,{style:'currency',currency:'USD'}).format(value / 100) : 'Evidence pending';
    const date = value => value ? esc(new Date(value).toLocaleString()) : 'Not established';
    const contentText = value => typeof value === 'string' ? value : JSON.stringify(value,null,2);
    const labels = {enrolled:'Agreement in progress',deposit_pending:'Deposit pending',deposit_paid:'Deposit received',ready:'Ready for scheduling',scheduled:'Installation scheduled',completed:'Installation completed',cancelled:'Cancelled',refund_review:'Refund under review',legal_review:'Agreement under review',accepted:'Agreement accepted',awaiting_deposit:'Awaiting deposit'};
    const human = value => labels[value] || 'Order under review';
    const policyLabel = (p,index=0) => `${({legal:'Customer agreement',commission:'Commission',settlement:'Friday settlement'})[p.kind] || 'Policy'} · ${p.version || p.definition?.version ? 'Version '+(p.version || p.definition.version) : p.approved_at ? 'Approved '+new Date(p.approved_at).toLocaleDateString() : 'Record '+(index+1)+' (version not supplied)'}`;
    const recordTitle = (w,index,names) => w.customerName || w.customer?.name || quoteCopy(w)?.content?.customer?.name || names?.[w.leadId] || `Order ${index + 1}`;
    const staffName = (value,identity) => {
        const name = typeof value==='string' ? value.trim() : '';
        return name && name.toLowerCase()!==String(identity || '').toLowerCase()
            && !/^[A-Z0-9_-]{3,}$/.test(name) && !/^[a-f0-9-]{16,}$/i.test(name)
            && !/^[^\s@]+@[^\s@]+$/.test(name) ? name : '';
    };
    const facts = rows => `<dl class="field-workflow__facts">${rows.map(([label,value])=>`<dt>${esc(label)}</dt><dd>${value}</dd>`).join('')}</dl>`;
    const strip = (rows,kind) => `<dl class="field-workflow__facts field-workflow__${kind}">${rows.map(([label,value])=>`<div><dt>${esc(label)}</dt><dd>${value}</dd></div>`).join('')}</dl>`;
    const quoteCopy = w => (w.documents || []).find(d=>d.kind==='quote') || (w.requiredArtifacts || []).find(d=>d.kind==='quote');
    const quoteLines = w => Array.isArray(quoteCopy(w)?.content?.lines) ? quoteCopy(w).content.lines : [];
    const serviceTitle = w => [...new Set(quoteLines(w).map(line=>line.service).filter(value=>typeof value==='string'))].join(' · ') || 'Service details pending';
    const summaryPanel = (title,status,body,tone='info') => `<section class="field-workflow__summary-panel"><header><h5>${esc(title)}</h5><span class="field-sales__badge" data-tone="${tone}">${esc(status)}</span></header>${body}</section>`;
    const paymentFeeLabel = w => {
        const rows = Array.isArray(w.processingFeeEvidence) ? w.processingFeeEvidence : w.processingFeeEvidence ? [w.processingFeeEvidence] : [];
        return rows.length && rows.every(row => {
            const evidence = row?.evidence || row;
            return evidence?.verified === true && evidence.source === 'stripe.balance_transaction';
        }) ? 'Stripe payment fees' : 'Card payment fees';
    };
    function exactCost(quantity,unitCents,amountCents){
        const [whole,fraction='']=quantity.split('.');
        const millionths=BigInt(whole)*1000000n+BigInt(fraction.padEnd(6,'0'));
        return millionths*BigInt(unitCents)===BigInt(amountCents)*1000000n;
    }
    let current, generation = 0;
    function reset() { generation++; current?.sync?.destroy(); current?.companyViews?.forEach(view=>view.destroy()); current?.controller.abort(); current?.root.replaceChildren(); current = null; }
    function mount(root, options) {
        reset();
        const started = options.getSession()?.token, startedRole=options.getSession()?.role, id = generation;
        const state = {root,controller:new AbortController(),data:null,busy:false,attempt:null,dirty:false,edits:0,read:0,companyViews:[]};
        current = state;
        const valid = () => {
            const matches=current===state&&id===generation&&!!started&&options.getSession()?.token===started&&options.getSession()?.role===startedRole&&['ADMIN','SALES'].includes(startedRole);
            if(!matches&&current===state&&id===generation)reset();
            return matches;
        };
        const admin = () => options.getSession()?.role === 'ADMIN';
        // Upgrade only this mounted work surface. Move existing nodes, never clone forms:
        // native-backed controls, listeners and unsaved values must survive navigation.
        function preparePanels() {
            const tabLabels = {
                'New order enrollment — exact quote and approved policies':'Enroll sale',
                'Versioned legal, commission and settlement policies':'Policy management'
            };
            root.querySelectorAll('details:not(.field-workflow__audit)').forEach(disclosure => {
                const panel = document.createElement('section'), heading = document.createElement('h4');
                panel.className = disclosure.className + ' field-workflow__panel';
                panel.setAttribute('data-context-view','');
                heading.textContent = disclosure.querySelector(':scope > summary').textContent;
                disclosure.querySelector(':scope > summary').remove();
                panel.append(heading,...disclosure.childNodes);
                disclosure.replaceWith(panel);
            });
            root.querySelectorAll('[data-context-panels]').forEach((group,groupIndex) => {
                const panels = [...group.children].filter(el => el.matches('[data-context-view]'));
                if (!panels.length) return;
                const tabs = document.createElement('div');
                tabs.className = 'field-workflow__tabs';
                tabs.setAttribute('role','tablist');
                tabs.setAttribute('aria-label',group.getAttribute('aria-label'));
                panels.forEach((panel,index) => {
                    const key = `field-workflow-${id}-${groupIndex}-${index}`, tab = document.createElement('button');
                    tab.type = 'button'; tab.className = 'field-workflow__tab'; tab.id = key+'-tab';
                    const heading = panel.querySelector('h4').textContent;
                    tab.textContent = panel.dataset.tabLabel || tabLabels[heading] || heading;
                    tab.setAttribute('role','tab'); tab.setAttribute('aria-controls',key+'-panel');
                    tab.setAttribute('aria-selected',String(index===0)); tab.tabIndex = index===0 ? 0 : -1;
                    panel.id = key+'-panel'; panel.setAttribute('role','tabpanel');
                    panel.setAttribute('aria-labelledby',tab.id); panel.tabIndex = 0; panel.hidden = index!==0;
                    tabs.append(tab);
                });
                group.prepend(tabs);
            });
        }
        function activatePanel(tab, focus = false) {
            const tabs = tab.closest('.field-workflow__tabs');
            for (const item of tabs.children) {
                const selected = item===tab;
                item.setAttribute('aria-selected',String(selected)); item.tabIndex = selected ? 0 : -1;
                root.querySelector('#'+item.getAttribute('aria-controls')).hidden = !selected;
            }
            if (focus) tab.focus();
        }
        root.onkeydown = event => {
            const tab = event.target.closest('.field-workflow__tab');
            if (!tab || !valid()) return;
            const tabs = [...tab.parentElement.children], index = tabs.indexOf(tab);
            const next = {ArrowRight:(index+1)%tabs.length,ArrowLeft:(index+tabs.length-1)%tabs.length,Home:0,End:tabs.length-1}[event.key];
            if (next===undefined) return;
            event.preventDefault(); event.stopPropagation(); activatePanel(tabs[next],true);
        };
        // A required field in another tab must be reachable by native validation.
        root.addEventListener('invalid',event => {
            if (!valid()) return;
            const panel = event.target.closest('[role="tabpanel"]');
            if (panel?.hidden) activatePanel(root.querySelector('#'+panel.getAttribute('aria-labelledby')));
            const audit = event.target.closest('details.field-workflow__audit');
            if (audit) audit.open = true;
        },{capture:true,signal:state.controller.signal});
        function status(text, error = false) {
            if (!valid()) return;
            const el = root.querySelector('[data-workflow-status]');
            if (el) { el.textContent = text; el.setAttribute('role',error ? 'alert' : 'status'); }
            if (el && error && !state.attempt) el.insertAdjacentHTML('beforeend',' <button type="button" data-workflow-refresh>Retry</button>');
        }
        async function api(body) {
            if (!valid()) throw Error('Session changed; workflow response discarded.');
            const query = new URLSearchParams();
            if (options.quoteId) query.set('quote_id',options.quoteId);
            else if (options.leadId) query.set('lead_id',options.leadId);
            const response = await global.fetch(`${apiRoot(options.apiBase)}/field-sales-workflow${!body && query.size ? '?' + query : ''}`, {
                method:body ? 'POST' : 'GET',cache:'no-store',referrerPolicy:'no-referrer',signal:!body&&global.H2SDataSync?global.H2SDataSync.signal(state.controller.signal):state.controller.signal,
                headers:{Authorization:'Bearer '+started,...(body ? {'Content-Type':'application/json'} : {})},...(body ? {body:JSON.stringify(body)} : {})
            });
            if (!valid()) throw Error('Session changed; workflow response discarded.');
            if ([401,403].includes(response.status)) { options.onSessionEnded?.(); reset(); throw Error('Workflow access ended.'); }
            const result = await response.json();
            if (!valid()) throw Error('Session changed; workflow response discarded.');
            if (!response.ok || !result.ok) throw Error(result.error || 'Order workflow unavailable. No clearance or completion is implied.');
            return result;
        }
        function policies(kind) {
            return state.data.policies.filter(p => p.kind === kind && p.status === 'approved').map((p,index) => `<option value="${esc(p.policy_id)}">${esc(policyLabel(p,index))}</option>`).join('');
        }
        function form(action, w, contents, label, disabled = false) {
            return `<form data-workflow-form="${action}" class="field-sales__form">${w ? `<input type="hidden" name="quoteId" value="${esc(w.quoteId)}"><input type="hidden" name="leadId" value="${esc(w.leadId)}"><input type="hidden" name="revision" value="${esc(w.revision)}">` : ''}
                ${contents}<button type="submit"${disabled ? ' disabled' : ''}>${label}</button></form>`;
        }
        const evidence = '<label class="field-sales__wide">Approval/source evidence<textarea name="evidence" required maxlength="6000"></textarea></label>';
        const reason = '<label class="field-sales__wide">Reason<textarea name="reason" required maxlength="2000"></textarea></label>';
        function nextAction(w) {
            if(!admin()){
                if(['cancelled','refund_review'].includes(w.state))return 'Contact management for cancellation or refund updates. Payments and scheduling are on hold.';
                if(w.gates?.canBalance)return 'Follow up with the customer about their remaining balance after installation.';
                if(w.completedAt)return w.balanceCents>0?'Installation is complete. Management is reviewing payment readiness.':'Installation is complete. Check Earnings for commission review and payment history.';
                if(w.state==='scheduled')return w.technicianId?'Confirm the customer is ready for the scheduled visit.':'Management is arranging the installation team.';
                if(w.gates?.canSchedule)return 'Coordinate a suitable installation time with the customer and management.';
                if(w.gates?.canDeposit)return 'Help the customer complete their secure 25% deposit.';
                if(!w.documents?.length)return 'Management is preparing the customer agreement. Follow up when it is ready.';
                return 'Follow up on the customer agreement. Management will confirm when payment and scheduling are ready.';
            }
            if(['cancelled','refund_review'].includes(w.state))return 'Management: reconcile cancellation/refund holds; collection and scheduling remain blocked.';
            if(w.gates?.canBalance)return 'Customer: verify and pay the outstanding post-installation net balance.';
            if(w.completedAt)return w.balanceCents>0?'Management: resolve payment clearance before post-install balance collection.':'Management: review actual costs, earned commission and the eligible Friday settlement run.';
            if(w.state==='scheduled'){
                if(!w.technicianId)return w.gates?.canAssign?'Management: arrange your authorized company installer in Scheduling.':'Management: resolve scheduled job preparation before assigning an installer.';
                return w.gates?.canComplete?'Assigned technician: record actual materials, hours and completion in the existing pro job detail.':'Management: resolve assigned-job readiness before technician completion.';
            }
            if(w.gates?.canSchedule)return 'Management: confirm an eligible installation in the existing company calendar.';
            if(w.gates?.canDeposit)return 'Customer: pay the exact 25% deposit through the secure agreement handoff.';
            if(!w.documents?.length)return 'Management: publish exact approved customer copies; customer retrieval and acceptance are required.';
            return 'Management: resolve the current legal, delivery and verified-deposit gates before scheduling.';
        }
        function order(w,index) {
            const holds = Array.isArray(w.holds) ? w.holds : ['Readiness evidence unavailable'];
            const balanceText = !Number.isSafeInteger(w.balanceCents) ? 'Evidence pending'
                : w.balanceCents === 0 ? 'No balance due'
                : w.balanceCents < 0 ? `${money(w.balanceCents)} — credit balance under management review`
                : `${money(w.balanceCents)}${w.gates?.canBalance ? ' — available after installation' : ' — not ready for collection'}`;
            const rep = staffName(w.representativeName,w.representativeId) || staffName(options.representativeNames?.[w.representativeId],w.representativeId);
            const payment = Number.isSafeInteger(w.depositCents)&&w.depositCents>0&&Number.isSafeInteger(w.netPaidCents)&&w.netPaidCents>=w.depositCents ? 'Verified net payment covers deposit' : 'Deposit verification pending';
            const deposit = `${money(w.depositCents)}<span class="field-workflow__inline-note">${payment}</span>`;
            const summary = admin() ? strip([
                ['Deposit required (25%)',deposit],['Outstanding balance',balanceText],
                ['Credited representative',esc(rep || (w.representativeId?'Assigned — profile name unavailable':'Not supplied'))],['Installation team',w.technicianId?'Assigned':'Not assigned']
            ],'identity') : strip([
                ['Deposit required (25%)',`${deposit}<span class="field-workflow__inline-note">Total verified payments (net): ${money(w.netPaidCents)}</span>`],
                ['Outstanding balance',balanceText],['Installation team',w.technicianId?'Assigned':'Not assigned'],
                ['Completion',date(w.completedAt)],['Customer copies',w.documents?.length?'Published':'Being prepared']
            ],'payment-strip');
            return `<article class="field-workflow__record${admin()?' field-workflow__order-detail':' field-workflow__mobile-order'}"><header class="field-workflow__header"><div><p class="field-workflow__eyebrow">${admin()?'Management order review':'Your order'}</p><h4>${esc(recordTitle(w,index,options.customerNames))}</h4><p class="field-workflow__service">${esc(serviceTitle(w))}</p></div>
                <span class="field-sales__badge" data-tone="${w.state==='completed'?'success':['cancelled','refund_review'].includes(w.state)?'attention':'info'}">${esc(human(w.state))}</span></header>
                ${summary}
                <p class="field-workflow__next"><strong>Next step</strong> ${esc(nextAction(w))}</p>
                ${admin()?orderPanels(w,index,holds):''}</article>`;
        }
        function orderPanels(w,index,holds) {
            const actions = management(w,holds), docs = w.documents || [], quote = quoteCopy(w);
            const agreement = docs.find(d=>d.kind==='agreement');
            const prep = w.preparation?.record;
            const readyLabel = value => ({ready:'Ready',blocked:'Blocked',not_required:'Not required',unreviewed:'Not reviewed'})[value] || 'Not recorded';
            const panel = (label,heading,body) => `<section class="field-workflow__panel" data-context-view data-tab-label="${label}"><h4>${heading}</h4>${body}</section>`;
            const overview = `<div class="field-workflow__overview field-workflow__overview--order">
                ${summaryPanel('Customer quote',docs.some(d=>d.kind==='quote')?'Customer copy ready':'Copy being prepared',facts([
                    ['Service quoted',esc(serviceTitle(w))],['Approved quote total',money(w.totalCents)],['Customer payments after refunds',money(w.netPaidCents)],['Quote approved',date(quote?.approvedAt)]
                ]),docs.some(d=>d.kind==='quote')?'success':'info')}
                ${summaryPanel('Customer acceptance',w.acceptedAt?'Accepted':'Acceptance pending',facts([
                    ['Agreement copy',agreement?'Available':'Being prepared'],['Customer accepted',date(w.acceptedAt)],['Document delivery evidence',esc(w.deliveryEvidence?.length ?? 0)]
                ]),w.acceptedAt?'success':'info')}
                ${summaryPanel('Installation appointment',w.completedAt?'Completed':w.state==='scheduled'?'Scheduled':'Not scheduled',facts([
                    ['Scheduled installation',w.reservation?.starts_at?date(w.reservation.starts_at):'Not established'],['Installation team',w.technicianId?'Assigned':'Not assigned'],['Installed on',date(w.completedAt)]
                ]),w.completedAt?'success':'info')}
                ${summaryPanel('Installation checklist',w.proof?.complete===true?'Evidence complete':'Review required',facts([
                    ['Service scope',prep?.scope_reviewed===true?'Reviewed':prep?.scope_reviewed===false?'Not reviewed':'Not recorded'],['Installation materials',readyLabel(prep?.materials)],['Property access',readyLabel(prep?.access)],['Completion evidence',w.proof?.complete===true?'Requirements satisfied':'Not complete']
                ]),w.proof?.complete===true?'success':'info')}
                ${summaryPanel('Installation cost review',w.costsComplete===true?'Approved':'Approval pending',facts([
                    ['Cost approval',w.costsComplete===true?'Approved by management':'Management review required'],['Costs approved',date(w.costApprovedAt)],[paymentFeeLabel(w),money(w.processingFeeCents)]
                ]),w.costsComplete===true?'success':'info')}
                ${summaryPanel('Sales commission review', 'See Earnings',facts([
                    ['Installation',w.completedAt?'Completed':'Not completed'],['Installation costs',w.costsComplete===true?'Approved':'Not approved'],['Eligibility & amount','Review in Earnings']
                ]))}</div>${holds.length ? `<p class="field-workflow__note">Needs attention: ${esc(holds.join('; '))}</p>` : ''}`;
            const quoteBody = `<p class="field-workflow__note">${docs.some(d=>d.kind==='quote')?'Published approved customer copy.':'Approved source copy awaiting publication.'} Original copies and hashes remain in Audit.</p>
                ${facts([['Approved revenue',money(w.totalCents)],['Approved copy date',date(quote?.approvedAt)]])}
                ${quoteLines(w).map(line=>`<section class="field-workflow__summary-panel"><header><h5>${esc(line.description || line.service || 'Quoted service')}</h5><strong>${money(line.totalCents)}</strong></header>${facts([['Service',esc(line.service || 'Not supplied')],['Quantity',esc(line.quantity ?? 'Not supplied')]])}${['scope','equipment','exclusions'].filter(key=>Array.isArray(line[key])&&line[key].length).map(key=>`<h5>${({scope:'Included scope',equipment:'Equipment',exclusions:'Exclusions'})[key]}</h5><ul>${line[key].map(item=>`<li>${esc(item)}</li>`).join('')}</ul>`).join('')}</section>`).join('') || '<p>Structured quote line details were not supplied. No scope or amount has been substituted.</p>'}`;
            const docsBody = `<div class="field-workflow__overview">${docs.map(doc=>summaryPanel(doc.label || ({quote:'Approved quote',agreement:'Customer agreement',notice:'Customer notice'})[doc.kind] || 'Customer document','Published',facts([['Approved',date(doc.approvedAt)],['Copy type',esc(({quote:'Quote',agreement:'Agreement',notice:'Notice'})[doc.kind] || 'Customer copy')]]))).join('') || '<p>No approved customer copies published.</p>'}</div>
                ${facts([['Customer accepted agreement',date(w.acceptedAt)],['Document delivery evidence',esc(w.deliveryEvidence?.length ?? 0)],['Cancellation deadline',date(w.cancellationDeadline)]])}
                <p class="field-workflow__note">Approved policy and delivery evidence control clearance. Published copies do not establish acceptance.</p>
                <h5>Publish and record delivery</h5>${actions.documents}<section class="field-workflow__review"><h5>Cancellation & refund review</h5>${actions.cancellation}</section>`;
            const costsBody = `${facts([[paymentFeeLabel(w),money(w.processingFeeCents)],['Technician labor hours',esc(w.hours ?? 'Not recorded')+' — technician pay is separate from sales commission'],['Installation cost approval',w.costsComplete===true?'Approved by management':'Not approved'],['Costs approved',date(w.costApprovedAt)]])}
                <p>${w.costsComplete===true?'Actual costs approved by management. Commission qualification and amount still require their separate Earnings review.':'Technician costs are not approved costs. Commission remains in review until management approves evidenced actual costs.'}</p>
                <p class="field-workflow__note">No estimated margin is presented. Earnings retains the authoritative actual commission basis.</p>${(w.expenses || []).map(row=>`<p>${esc(({equipment:'Equipment',materials:'Installation materials',wages:'Technician wages'})[row.category] || 'Reviewed actual cost')}: <strong>${money(row.amountCents)}</strong></p>`).join('')}${costReview(w)}`;
            return `<div data-context-panels aria-label="${esc(recordTitle(w,index,options.customerNames))} order actions">
                ${panel('Overview','Order overview',overview)}
                ${panel('Quote','Approved quote',quoteBody)}
                ${panel('Customer Docs','Customer documents & acceptance',docsBody)}
                ${panel('Scheduling','Scheduling & installation readiness',`<h5>Readiness review</h5>${actions.readiness}<h5>Owner / company installation</h5><div data-company-installation="${esc(w.quoteId)}"></div>${installationProof(w)}<h5>Company calendar & managed assignment</h5>${actions.scheduling}`)}
                ${panel('Costs & Margin','Actual costs & margin review',costsBody)}
                ${panel('Commission Review','Commission qualification review',`<p>Qualification and the commission amount are established in Earnings, not calculated on this order screen.</p>${facts([['Installation completed',date(w.completedAt)],['Verified net paid',money(w.netPaidCents)],['Actual costs',w.costsComplete===true?'Approved by management':'Awaiting management approval']])}<p>Technician wages are separate. A completed installation or verified deposit alone does not establish earned commission or a paid Friday run.</p>`)}
                ${panel('Audit','Technical evidence & audit',`<p class="field-workflow__note">Secondary technical records. Original identifiers, immutable copies, source evidence and revisions are retained here.</p>
                <details class="field-workflow__audit"><summary>Admin audit details — IDs, documents & evidence</summary>
                <p class="field-sales__id">Lead ${esc(w.leadId)} / quote ${esc(w.quoteId)} / revision ${esc(w.revision)} / representative ${esc(w.representativeId)}</p>
                <h4>Approved immutable customer copies & delivery</h4>
                ${(w.documents || []).map(doc => `<section><h4>${esc(doc.label)} / ${esc(doc.kind)}</h4><p class="field-sales__id">${esc(doc.artifactId)} / ${esc(doc.contentHash)}</p><pre>${esc(contentText(doc.content))}</pre></section>`).join('') || '<p>No approved immutable copies published.</p>'}
                <pre>${esc(JSON.stringify({...w,proof:undefined},null,2))}</pre></details>${(w.refunds||[]).length?'<p>Reserved or provider-pending refunds are not confirmed refunds. Management must reconcile the provider evidence.</p>':''}`)}
                </div>`;
        }
        function installationProof(w){
            if(!admin())return '';
            const p=w.proof;if(!p)return '<p>Assigned-job installation proof status unavailable. No completion clearance is implied.</p>';
            return `<h4>Pinned installation requirements</h4><p>Baseline saved photos: ${esc(p.photoCount)} / customer signatures: ${esc(p.signatureCount)}. ${p.complete===true?'Server proof requirements satisfied.':'Proof remains incomplete: '+esc((p.missing||[]).join('; '))}</p>
                ${Array.isArray(p.requirements)&&p.requirements.length?`<ul>${p.requirements.map(r=>`<li>${esc(r.label)} / ${esc(r.type)} / required ${esc(r.minimumCount)} / ${r.complete===true?'Saved requirement satisfied':'Missing '+esc(r.missingCount)}</li>`).join('')}</ul>`:'<p>No additional service requirements reported. Baseline photo/signature requirements remain mandatory.</p>'}
                <p>Requirements are pinned to the approved quote. The assigned technician records native evidence and explicit checklist completion; management does not bypass proof here.</p>`;
        }
        function management(w, holds) {
            const docForms = form('documents_publish',w,`<p class="field-sales__wide">Publish the approved customer copies below without changing their content.</p><details class="field-sales__wide field-workflow__audit"><summary>Admin evidence details — exact required customer copies</summary><label>Server copies (read-only JSON)<textarea name="artifacts" readonly required>${esc(JSON.stringify(w.requiredArtifacts || [],null,2))}</textarea></label></details>${evidence}`,'Publish approved immutable copies',
                !w.requiredArtifacts?.length || !!w.documents?.length || ['cancelled','completed'].includes(w.state)) +
                form('delivery_record',w,`<label>Approved delivery method<input name="method" required maxlength="120"></label><label>Delivered at (device timezone)<input name="deliveredAt" type="datetime-local" required></label>
                <label>Exact recipient<input name="recipient" required maxlength="500"></label><label>Delivery reference<input name="reference" required maxlength="2000"></label>`,'Record document delivery evidence');
            const readiness = form('preparation',w,`<input type="hidden" name="preparationRevision" value="${esc(w.preparation?.record?.revision ?? 0)}">
                <label class="field-sales__check"><input name="scopeReviewed" type="checkbox">Scope reviewed</label>
                ${['materials','access'].map(name => `<label>${name === 'materials' ? 'Materials readiness' : 'Customer access'}<select name="${name}"><option value="unreviewed">Unreviewed</option><option value="ready">Ready</option><option value="blocked">Blocked</option>${name === 'materials' ? '<option value="not_required">Not required — approved scope</option>' : ''}</select></label>`).join('')}
                <label class="field-sales__wide">Readiness blockers (leave blank only when none)<textarea name="blockers"></textarea></label><label class="field-sales__wide">Preparation evidence / note<textarea name="note" required maxlength="4000"></textarea></label>`,'Record readiness evidence',!w.jobId || ['cancelled','completed','refund_review'].includes(w.state));
            const schedule = form(w.reservation ? 'reschedule' : 'schedule',w,`<input type="hidden" name="reservationRevision" value="${esc(w.reservation?.revision ?? 0)}">
                <label>Start (device timezone)<input name="start" type="datetime-local" required></label><label>End (device timezone)<input name="end" type="datetime-local" required></label>
                <label>Approved IANA timezone<input name="timezone" required></label><label class="field-sales__check"><input name="customerAgreed" type="checkbox" required>Customer agreed to these times</label>${reason}`,
                'Confirm in existing company calendar',w.gates?.canSchedule !== true);
            const preview = w.assignmentPreview, technicians = preview?.technicians || [];
            const assignment = form('assign',w,`<label>Available technician<select name="proId" required><option value="">Choose an authorized technician</option>${technicians.map((t,i)=>`<option value="${esc(t.proId)}">${esc(t.name || 'Technician '+(i+1))}</option>`).join('')}</select></label>
                <input name="context" type="hidden" value="${esc(preview?.job?.context || '')}"><label class="field-sales__wide">Assignment note<textarea name="note" required maxlength="4000"></textarea></label>`,'Submit managed assignment',w.gates?.canAssign !== true || !preview?.job?.context || !technicians.length);
            return {documents:docForms,readiness,scheduling:`${holds.length ? '<p>Scheduling and assignment have separate requirements; disabled actions are not ready. The server revalidates every transition.</p>' : ''}${schedule}${assignment}`,
                cancellation:`<p>Review only — no automatic refund.</p>${form('cancel',w,reason+evidence,'Record cancellation and holds')}${form('refund_review',w,reason+evidence,'Record refund review — no automatic transfer')}`};
        }
        function costReview(w){
            if(!w.completedAt||w.costsComplete===true)return '';
            const rows=w.technicianExpenses||[];
            return `<p class="field-workflow__note">Approval required: review actual equipment and materials costs before commission can be calculated. Technician wages are separate.</p><details class="field-workflow__review"><summary>Review technician actual costs before commission calculation</summary><p>Technician rows stay immutable. Document any correction here. Approval saves a separate immutable actual-cost snapshot; wages are excluded.</p>
                ${form('cost_review',w,`${rows.map((row,index)=>`<fieldset class="field-sales__wide" data-workflow-cost-row><legend>Reviewed actual cost ${index+1}</legend>
                    <label>Category<select name="category"><option value="equipment"${row.category==='equipment'?' selected':''}>Equipment</option><option value="materials"${row.category==='materials'?' selected':''}>Installation materials</option></select></label>
                    <label>Quantity (up to 6 decimals)<input name="quantity" type="number" min="0" max="100000" step="0.000001" value="${esc(row.quantity)}" required></label>
                    <p class="field-sales__wide">Reported unit cost <strong>${money(row.unitCents)}</strong> · reported line total <strong>${money(row.amountCents)}</strong></p>
                    <details class="field-sales__wide field-workflow__audit"><summary>Technical cost correction — exact amounts</summary>
                    <label>Actual unit cost (integer cents)<input name="unitCents" type="number" min="0" step="1" value="${esc(row.unitCents)}" required></label>
                    <label>Actual line total (quantity × unit cents)<input name="amountCents" type="number" min="0" step="1" value="${esc(row.amountCents)}" required></label></details>
                    <label>Receipt/source/correction evidence<textarea name="rowEvidence" required maxlength="4000">${esc(row.evidence?.reference||'')}</textarea></label>
                    <label>Zero-cost attestation (required when total is zero)<textarea name="zeroCostAttestation" maxlength="2000">${esc(row.zeroCostAttestation||'')}</textarea></label>
                    <label class="field-sales__check"><input name="actual" type="checkbox" required>I attest these are evidenced actual costs, not estimates.</label></fieldset>`).join('')}
                    ${evidence}<label class="field-sales__wide field-sales__check"><input name="actualCostsReviewed" type="checkbox" required>I reviewed both equipment and materials, including any zero costs and documented corrections.</label>`,'Approve immutable actual-cost snapshot',!rows.length)}
                ${!rows.length?'<p>Technician actual-cost rows unavailable. Approval is blocked; do not substitute zero costs.</p>':''}</details>`;
        }
        function render() {
            state.companyViews.forEach(view=>view.destroy());state.companyViews=[];
            const d = state.data;
            root.innerHTML = '<div class="field-sales__toolbar"><h3>Orders & next actions</h3>'+(admin()?'<button type="button" data-workflow-discard-draft>Discard review inputs</button>':'')+'</div><p data-workflow-status role="status" aria-live="polite"></p>';
            if (!d.enabled) { status('Sales workflow disabled. Legal, scheduling and completion actions are unavailable.'); return; }
            if (!Array.isArray(d.workflows) || !Array.isArray(d.policies)) { status('Incomplete workflow response. No readiness or scheduling is assumed.',true); return; }
            root.insertAdjacentHTML('beforeend', `<div class="field-sales__summary" aria-label="Loaded order summary">
                <div class="field-sales__metric"><span>Orders</span><strong>${d.workflows.length}</strong></div>
                <div class="field-sales__metric"><span>Scheduled</span><strong>${d.workflows.filter(w=>w.state==='scheduled').length}</strong></div>
                <div class="field-sales__metric"><span>Completed</span><strong>${d.workflows.filter(w=>w.completedAt).length}</strong></div></div>
                <p class="field-workflow__note" title="The remaining net balance becomes collectible only after installation and current payment clearance. A deposit is not an appointment.">25% deposit · final balance after installation</p>
                <section class="field-sales__section" aria-label="Order records">${[...d.workflows].sort((a,b)=>Number(!!a.completedAt)-Number(!!b.completedAt)
                    || (Date.parse(a.reservation?.starts_at)||Infinity)-(Date.parse(b.reservation?.starts_at)||Infinity)
                    || (Date.parse(a.completedAt)||Infinity)-(Date.parse(b.completedAt)||Infinity)).map(order).join('') || '<div class="field-sales__empty"><h4>No orders yet</h4><p>Accepted new sales will appear here after management enrollment. Existing Dispatch orders stay in Dispatch.</p></div>'}</section>`);
            if (admin()) root.insertAdjacentHTML('beforeend', `<div data-context-panels aria-label="Order enrollment and policy management"><details><summary>New order enrollment — exact quote and approved policies</summary>
                ${form('enroll',null,`<details class="field-sales__wide field-workflow__audit"><summary>Admin linkage details — approved quote, lead & commission credit</summary><p>Use the exact approved records. These identifiers establish order ownership and cannot be substituted.</p><label>Exact approved quote ID<input name="quoteId" value="${esc(options.quoteId || '')}" required></label>
                    <input type="hidden" name="revision" value="0">
                    <label>Shared lead ID<input name="leadId" value="${esc(options.leadId || '')}" required></label><label>Immutable commission credit representative ID<input name="representativeId" required></label></details>
                    ${[['legalPolicyId','legal','Legal policy'],['commissionPolicyId','commission','Commission policy'],['settlementPolicyId','settlement','Settlement policy']].map(([name,kind,label]) => `<label>${label}<select name="${name}" required><option value="">Choose approved version</option>${policies(kind)}</select></label>`).join('')}
                    <label class="field-sales__wide">Commission credit approval evidence<textarea name="creditEvidence" required maxlength="4000"></textarea></label>`,'Enroll exact new-sales order')}</details>
                <details><summary>Versioned legal, commission and settlement policies</summary><p>No jurisdiction, legal days, refund rule, rate-effective event or settlement method is preselected. Drafts are not approved.</p>
                    ${d.policies.map((p,index) => `<article class="field-workflow__record"><header class="field-workflow__header"><h4>${esc(policyLabel(p,index))}</h4><span class="field-sales__badge">${esc(({draft:'Draft — not approved',approved:'Approved',retired:'Retired'})[p.status] || 'Review required')}</span></header>
                    <details class="field-workflow__audit"><summary>Admin audit details — policy ID, definition & approval</summary><pre>${esc(JSON.stringify(p,null,2))}</pre>
                    ${p.status === 'draft' ? form('policy_update',null,`<input type="hidden" name="policyId" value="${esc(p.policy_id)}"><input type="hidden" name="expectedDefinitionHash" value="${esc(p.definitionHash||'')}"><label class="field-sales__wide">Policy definition JSON<textarea name="definition" required>${esc(JSON.stringify(p.definition,null,2))}</textarea></label>`,'Save draft policy',!p.definitionHash) +
                        form('policy_approve',null,`<input type="hidden" name="policyId" value="${esc(p.policy_id)}"><input type="hidden" name="expectedDefinitionHash" value="${esc(p.definitionHash||'')}">${evidence}`,'Explicitly approve policy version',!p.definitionHash) +
                        form('policy_delete_draft',null,`<input type="hidden" name="policyId" value="${esc(p.policy_id)}">`,'Delete unapproved draft') : p.status === 'approved' ? form('policy_retire',null,`<input type="hidden" name="policyId" value="${esc(p.policy_id)}">`,'Retire policy for future enrollment') : ''}</details></article>`).join('')}
                    <details class="field-workflow__audit"><summary>Admin policy authoring — create an unapproved version</summary>${form('policy_create',null,`<label>New policy UUID<input name="policyId" required></label><label>Policy kind<select name="kind"><option value="legal">Legal</option><option value="commission">Commission</option><option value="settlement">Settlement</option></select></label>
                        <label class="field-sales__wide">Policy definition JSON<textarea name="definition" required></textarea></label>`,'Create unapproved policy draft')}</details></details></div>`);
            preparePanels();
            for(const target of root.querySelectorAll('[data-company-installation]')){
                const w=state.data.workflows.find(row=>row.quoteId===target.dataset.companyInstallation);
                if(global.H2SCompanyInstallation)state.companyViews.push(global.H2SCompanyInstallation.mount(target,{
                    serviceNames:Object.fromEntries(quoteLines(w).map(line=>[line.serviceId,line.service])),
                    apiBase:options.apiBase,getSession:options.getSession,jobId:w.jobId,revision:w.revision,
                    canClaim:w.gates?.canAssign===true&&!w.technicianId,
                    onChanged:()=>{
                        const unsaved=[...root.querySelectorAll('form input,form select,form textarea')].filter(el=>!el.closest('[data-company-installation]')).some(el=>
                            el.type==='checkbox'?el.checked!==el.defaultChecked:el.tagName==='SELECT'?el.selectedIndex!==Math.max(0,[...el.options].findIndex(o=>o.defaultSelected)):el.value!==el.defaultValue);
                        if(!unsaved){state.dirty=false;load();}else status('Company installation updated. Other unsaved review inputs are preserved; finish or discard them before reading updated order summaries.');
                    }}));
                else target.textContent='Company installation module unavailable. No completion is assumed.';
            }
        }
        const dirty = () => state.dirty || state.busy || !!state.attempt || global.H2SDataSync?.interacting(root);
        async function load(background = false) {
            if (!valid()) return;
            const read=++state.read, edits=state.edits;
            if (!state.data) root.innerHTML = '<h3>Orders</h3><p data-workflow-status role="status">Loading orders…</p>';
            try { const d = await api(); if (!valid() || read!==state.read || background && (dirty()||edits!==state.edits)) return false;
                if(typeof d.enabled!=='boolean'||d.enabled&&(!Array.isArray(d.workflows)||!Array.isArray(d.policies)))throw Error('Incomplete workflow response. No readiness or scheduling is assumed.');
                state.data = d; if(global.H2SDataSync)global.H2SDataSync.preserveView(root,render);else render(); return true; }
            catch (error) { if (valid()) { console.error('Field workflow read failed:',error.message); if(background)throw error; status(error.message,true); } return false; }
        }
        async function write(body) {
            if (!valid() || !admin() || state.busy) return;
            if (state.attempt) { status('An interrupted operation is pending. Retry it unchanged using Retry, or explicitly discard the interrupted action.',true); return; }
            state.attempt = {...body,operationId:global.crypto.randomUUID()};
            await retry();
        }
        async function retry() {
            if (!valid() || !admin() || state.busy || !state.attempt) return;
            state.busy = true; status('Recording evidence on the server. No payment or scheduling success is assumed.');
            try { await api(state.attempt); if (!valid()) return; state.attempt = null; state.dirty=false; await load(); }
            catch (error) {
                if (valid()) {
                    console.error('Field workflow action failed:',error.message); status(error.message + ' The exact interrupted operation is retained.',true);
                    if (!root.querySelector('[data-workflow-retry]')) root.querySelector('[data-workflow-status]').insertAdjacentHTML('afterend','<button type="button" data-workflow-retry>Retry identical interrupted operation</button><button type="button" data-workflow-discard-attempt>Discard interrupted action</button>');
                }
            } finally { state.busy = false; }
        }
        root.onclick = event => {
            const b = event.target.closest('button'); if (!b || !valid()) return;
            if (b.matches('.field-workflow__tab')) { activatePanel(b,true); return; }
            if (state.busy) return;
            if (b.hasAttribute('data-workflow-refresh')) { if(state.sync)state.sync.request('retry',{force:true});else load(); }
            if (b.hasAttribute('data-workflow-discard-attempt')&&global.confirm('Discard only this interrupted retry? Your form is retained. Review current records before a new action.')) {state.attempt=null;status('Interrupted retry discarded. Your form is retained.');b.previousElementSibling?.remove();b.remove();}
            if(b.hasAttribute('data-workflow-discard-draft')){
                if(state.attempt){status('Retry or explicitly discard the interrupted action first.',true);return;}
                if(!global.confirm('Discard unsaved order review inputs and read current records? Server-recorded actions are not undone.'))return;
                state.dirty=false;state.edits++;load();
            }
            if (b.hasAttribute('data-workflow-retry')) retry();
        };
        root.onsubmit = event => {
            const f = event.target.closest('[data-workflow-form]'); if (!f || !valid() || !admin()) return;
            event.preventDefault(); event.stopPropagation();
            try {
                const body = {...Object.fromEntries(new FormData(f)),action:f.dataset.workflowForm};
                if(['policy_update','policy_approve'].includes(body.action)&&!String(body.expectedDefinitionHash||'').trim())throw Error('Policy definition hash unavailable. Refresh the policy records before editing or approving.');
                for (const name of ['revision','reservationRevision','preparationRevision']) if (body[name] !== undefined) {
                    if (body[name] === '') delete body[name]; else body[name] = Number(body[name]);
                }
                if (body.definition !== undefined) { body.definition = JSON.parse(body.definition); if (!body.definition || Array.isArray(body.definition) || typeof body.definition !== 'object') throw Error('Policy definition must be a JSON object.'); }
                if (body.artifacts !== undefined) { body.artifacts = JSON.parse(body.artifacts); if (!Array.isArray(body.artifacts) || !body.artifacts.length) throw Error('Provide the approved immutable document copies.'); }
                if (typeof body.evidence === 'string') { if (!body.evidence.trim()) throw Error('Source approval evidence is required.'); body.evidence = {reference:body.evidence}; }
                if (typeof body.creditEvidence === 'string') { if (!body.creditEvidence.trim()) throw Error('Commission credit approval evidence is required.'); body.creditEvidence = {reference:body.creditEvidence}; }
                if(body.action==='cost_review'){
                    if(!f.elements.actualCostsReviewed.checked)throw Error('Explicit management actual-cost review attestation is required.');
                    body.expenses=[...f.querySelectorAll('[data-workflow-cost-row]')].map(row=>{
                        const rawQuantity=row.querySelector('[name="quantity"]').value,rawUnit=row.querySelector('[name="unitCents"]').value,rawAmount=row.querySelector('[name="amountCents"]').value;
                        const quantity=Number(rawQuantity),unitCents=Number(rawUnit),amountCents=Number(rawAmount);
                        if(!/^\d+(?:\.\d{1,6})?$/.test(rawQuantity)||quantity>100000||!rawUnit||!rawAmount||!Number.isSafeInteger(unitCents)||unitCents<0||unitCents>100000000||!Number.isSafeInteger(amountCents)||amountCents<0||amountCents>100000000)throw Error('Use supported quantities and nonnegative integer actual cost cents.');
                        if(!exactCost(rawQuantity,unitCents,amountCents))throw Error('Reviewed line total must exactly equal quantity × unit cents. No rounding is allowed.');
                        if(!row.querySelector('[name="actual"]').checked)throw Error('Each reviewed cost needs explicit actual-cost attestation.');
                        const reference=row.querySelector('[name="rowEvidence"]').value.trim();if(!reference)throw Error('Reviewed source/correction evidence is required.');
                        const zeroCostAttestation=row.querySelector('[name="zeroCostAttestation"]').value.trim();if(amountCents===0&&zeroCostAttestation.length<3)throw Error('Explicit reviewed zero-cost attestation is required.');
                        return {category:row.querySelector('[name="category"]').value,quantity,unitCents,amountCents,evidence:{reference},actual:true,...(amountCents===0?{zeroCostAttestation}:{})};
                    });
                    if(!body.expenses.some(e=>e.category==='equipment')||!body.expenses.some(e=>e.category==='materials'))throw Error('Review both equipment and materials, including evidenced zero costs.');
                    body.evidence={...body.evidence,actualCostsReviewed:true};
                    for(const name of ['category','quantity','unitCents','amountCents','rowEvidence','zeroCostAttestation','actual','actualCostsReviewed'])delete body[name];
                }
                for (const name of ['start','end']) if (body[name]) body[name] = new Date(body[name]).toISOString();
                if (body.action === 'delivery_record') {
                    body.evidence = {method:body.method,deliveredAt:new Date(body.deliveredAt).toISOString(),recipient:body.recipient,reference:body.reference};
                    for (const name of ['method','deliveredAt','recipient','reference']) delete body[name];
                }
                if (body.action === 'preparation') { body.scopeReviewed = f.elements.scopeReviewed.checked; body.blockers = body.blockers.trim(); }
                if (['schedule','reschedule'].includes(body.action)) body.customerAgreed = f.elements.customerAgreed.checked;
                write(body);
            } catch (error) { status(error.message,true); }
        };
        const edited=event=>{if(event.target.closest('form')){state.dirty=true;state.edits++;}};
        root.addEventListener('input',edited,{signal:state.controller.signal});root.addEventListener('change',edited,{signal:state.controller.signal});
        state.sync=global.H2SDataSync?.register({id:'field-workflow',isActive:()=>valid()&&root.isConnected&&root.closest('.pane')?.classList.contains('active'),
            isDirty:dirty,refresh:()=>load(true),onState:s=>{if(!state.attempt)global.H2SDataSync.feedback(root,'[data-workflow-status]',s,()=>state.sync.request('retry',{force:true}));}});
        if(state.sync)state.sync.request('mount',{force:true});else load();
    }
    global.H2SFieldWorkflow = {mount,reset};
})(window);

(function (global) {
    'use strict';
    let active = null;
    const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const money = cents => cents === null || cents === undefined ? 'Management review required' : new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(cents/100);
    const flagNames = {
        outdoor:'Supported outdoor location',coveragePositionVerified:'Independent coverage position verified',sunlightSuitable:'Suitable direct solar exposure',
        batteryMaintenanceAccepted:'Customer accepts battery maintenance if solar is insufficient',c31PowerCompatible:'Exact C31 USB-C DC power and weather protection verified',
        floodlightPowerCompatible:'Compatible floodlight hardwired AC verified',wifiConfirmed:'Compatible camera Wi-Fi verified at this position',
        homebaseLinkConfirmed:'Camera-to-HomeBase radio link verified',mountingCompatible:'Mounting surface and hardware verified',
        standardInstallation:'Standard installation complexity verified',storageVerified:'Recording media, compatibility and retention verified',
        equipmentCompatibilityVerified:'Exact camera SKU, manual, firmware and accessories verified'
    };
    const tv = () => ({location:'',size:null,weight:null,vesaWidth:null,vesaHeight:null,ownership:null,mountStyle:null,surface:null,concealment:null,compatibilityVerified:null});
    const camera = index => ({id:'camera_'+(index+1),coverage:[],directSunHours:null,requiredFeatures:[],preferredEquipmentId:null,ownership:null,recording:null,
        ...Object.fromEntries(Object.keys(flagNames).map(key=>[key,null]))});
    const empty = () => ({schemaVersion:1,step:0,services:[],tvs:[],cameras:[],tvQuantity:null,cameraQuantity:null,catalogId:null,
        preferences:{priority:'balanced',storage:'no_preference',homebaseType:'homebase_s380'},
        existingHub:{type:'none',compatibilityVerified:null,availableCameraSlots:null},hubRouterConnectionConfirmed:null,quoteAnswers:{}});
    function mount(root,options) {
        reset();
        const s = active = {root,options,readController:new AbortController(),data:null,answers:empty(),revision:0,started:false,dirty:false,
            saving:false,attempt:null,quoteAttempt:null,pendingStage:null,edits:0,timer:null,error:null,asking:false,referenceRecorded:false};
        root.classList.add('field-offers');root.dataset.fieldOffers='';
        const style=document.createElement('link');style.rel='stylesheet';style.href=global.__h2sResolveDashSiblingAsset?.('field-offers.css') || './field-offers.css';
        if (!document.querySelector('link[data-offer-style]')) {style.dataset.offerStyle='';document.head.append(style);}
        const current=()=>active===s && root.isConnected;
        function status(message,error=false) {
            if (!current()) return;
            const target=root.querySelector('[data-offer-status]');
            if (target) {target.textContent=message;target.setAttribute('role',error?'alert':'status');}
        }
        async function api(body) {
            const session=options.getSession();
            if (!session?.token) throw Error('Sign in again to access this opportunity.');
            const base=String(options.apiBase).replace(/\/+$/,'').replace(/\/api$/i,'')+'/api/field-sales-offers';
            const response=await global.fetch(base+(body?'':'?leadId='+encodeURIComponent(options.leadId)),{method:body?'POST':'GET',
                headers:{authorization:'Bearer '+session.token,'content-type':'application/json'},cache:'no-store',credentials:'omit',
                ...(body?{body:JSON.stringify(body)}:{signal:s.readController.signal})});
            const data=await response.json();
            if (!response.ok || data.ok!==true) {
                if (response.status===401) options.onSessionEnded?.();
                const error=Error(data.error || 'Offer assistant returned an incomplete response. No save or quote is assumed.');error.status=response.status;throw error;
            }
            return data;
        }
        const select=(label,path,value,choices,kind='text')=>`<label>${esc(label)}<select data-offer-path="${esc(path)}" data-offer-kind="${kind}"><option value="">Not yet known</option>${choices.map(([id,name])=>`<option value="${esc(id)}"${String(value??'')===String(id)?' selected':''}>${esc(name)}</option>`).join('')}</select></label>`;
        const flag=(label,path,value)=>select(label,path,value===null?'':value?'yes':'no',[['yes','Yes, verified'],['no','No']],'flag');
        const input=(label,path,value,min,max)=>`<label>${esc(label)}<input data-offer-path="${esc(path)}" data-offer-kind="${min===undefined?'text':'number'}" type="${min===undefined?'text':'number'}" value="${esc(value??'')}"${min===undefined?' maxlength="100"':` min="${min}" max="${max}" step="any"`}></label>`;
        function steps() {
            const result=[{kind:'scope',title:'Services and pricing version'}];
            s.answers.tvs.forEach((_,index)=>result.push({kind:'tv',index,title:`TV ${index+1} - scope`},{kind:'tvCompatibility',index,title:`TV ${index+1} - compatibility`}));
            if (s.answers.cameras.length) result.push({kind:'cameraSettings',title:'Recording storage and existing HomeBase'});
            s.answers.cameras.forEach((_,index)=>result.push({kind:'camera',index,title:`Camera ${index+1} - coverage and recording`},
                {kind:'cameraSite',index,title:`Camera ${index+1} - location qualifications`},{kind:'cameraPower',index,title:`Camera ${index+1} - power`}));
            result.push({kind:'review',title:'Recommendation and next action'});return result;
        }
        function shell() {
            root.innerHTML='<h3>Find the Right Offer</h3><p>Guided homeowner discovery. Recommendations are separate from quote approval, customer acceptance and payment.</p><p data-offer-status role="status" aria-live="polite"></p><div data-offer-wizard></div>'+
                '<details data-offer-reference><summary>Home2Smart product reference</summary><label>Find a product or answer<input type="search" data-offer-search placeholder="Try S220, continuous recording or VESA"></label><div data-offer-reference-results></div>'+
                '<form data-offer-ask><label>Ask Home2Smart about products<input name="question" required maxlength="500" placeholder="Do solar cameras record continuously?"></label><p>Product questions only. Do not include customer names, addresses, contact details or credentials. Chat is not saved discovery.</p><button type="submit">Find a grounded answer</button></form><p data-offer-ask-status role="status" aria-live="polite"></p><div data-offer-ask-results></div></details>';
        }
        function render() {
            if (!current()) return;
            if (!s.data) {shell();status('Loading saved discovery and controlled product knowledge...');return;}
            const target=root.querySelector('[data-offer-wizard]');
            if (!s.started) {
                target.innerHTML=s.data.closed?'<p>Closed opportunity. Product reference remains available; use the existing additional-service workflow for new work.</p>':'<button type="button" data-offer-start>Start guided discovery</button>';
                reference('');return;
            }
            const sequence=steps();s.answers.step=Math.min(s.answers.step,sequence.length-1);
            const step=sequence[s.answers.step],a=s.answers;
            let fields='';
            if (step.kind==='scope') {
                fields=`<fieldset><legend>Which services are needed?</legend>${[['tv','TV mounting'],['cameras','Camera installation'],['other','Other / custom services']].map(([id,title])=>`<label class="field-sales__check"><input type="checkbox" data-offer-service="${id}"${a.services.includes(id)?' checked':''}>${title}</label>`).join('')}</fieldset>`+
                    select('Quote pricing version','catalogId',a.catalogId,s.data.catalogs.filter(c=>c.status!=='retired').map(c=>[c.catalog_id,`${c.version} - ${c.status.replace(/_/g,' ')}`]))+
                    (a.services.includes('tv')?input('Number of TVs','tvQuantity',a.tvQuantity,1,100):'')+
                    (a.services.includes('cameras')?input('Independent camera positions','cameraQuantity',a.cameraQuantity,1,100):'')+
                    '<p>Every TV is assessed individually. Four or more TVs, quantities outside the supported catalog, and other services require a custom quote. No launch experiment is substituted for published pricing.</p>';
            } else if (step.kind==='tv') {
                const t=a.tvs[step.index],path='tvs.'+step.index+'.';
                fields=input('Room / mounting location (no customer identity)',path+'location',t.location)+input('TV diagonal inches',path+'size',t.size,19,150)+
                    select('Who supplies the mount?',path+'ownership',t.ownership,[['supplied','Home2Smart'],['customer','Customer-owned compatible mount']])+
                    select('Mount style',path+'mountStyle',t.mountStyle,[['fixed','Fixed'],['tilt','Tilt'],['full_motion','Full motion']])+
                    select('Wall / mounting surface',path+'surface',t.surface,[['drywall','Drywall / studs'],['masonry','Brick / masonry'],['fireplace','Above fireplace'],['other','Other / review']])+
                    select('Cable treatment',path+'concealment',t.concealment,[['external','Standard external raceway'],['none','No concealment requested'],['in_wall','In-wall / custom scope']]);
            } else if (step.kind==='tvCompatibility') {
                const t=a.tvs[step.index],path='tvs.'+step.index+'.';
                fields='<p>Screen-size ranges alone do not prove compatibility. Verify the exact TV and mount manuals. These discovery answers never replace required installation evidence.</p>'+
                    input('TV weight (lb)',path+'weight',t.weight,1,400)+input('Exact VESA width (mm)',path+'vesaWidth',t.vesaWidth,20,2000)+
                    input('Exact VESA height (mm)',path+'vesaHeight',t.vesaHeight,20,2000)+
                    flag('Exact VESA pattern, weight, wall and mount hardware compatibility verified',path+'compatibilityVerified',t.compatibilityVerified);
            } else if (step.kind==='cameraSettings') {
                fields=select('Recommendation priority','preferences.priority',a.preferences.priority,[['balanced','Balanced suitability'],['budget','Economical suitable model'],['premium','Tracking / zoom preference']])+
                    select('Storage preference','preferences.storage',a.preferences.storage,[['no_preference','No preference - verify each model'],['standalone','Standalone local storage'],['shared_homebase','Shared compatible HomeBase']])+
                    select('Existing HomeBase','existingHub.type',a.existingHub.type,[['none','None'],['homebase_2','HomeBase 2'],['homebase_s380','HomeBase S380 / HomeBase 3']])+
                    (a.existingHub.type!=='none'?flag('Existing hub exact model / firmware compatibility verified','existingHub.compatibilityVerified',a.existingHub.compatibilityVerified)+
                        input('Verified available camera slots','existingHub.availableCameraSlots',a.existingHub.availableCameraSlots,0,16)+
                        flag('HomeBase-to-router connection verified','hubRouterConnectionConfirmed',a.hubRouterConnectionConfirmed):'')+
                    '<p>HomeBase, microSD and built-in storage are not interchangeable. A required new hub, unverified shared-storage path or missing recording media needs an explicit scope and management review.</p>';
            } else if (step.kind==='camera') {
                const c=a.cameras[step.index],path='cameras.'+step.index+'.';
                fields=select('Who supplies the camera?',path+'ownership',c.ownership,[['supplied','Home2Smart'],['customer','Customer-owned']])+
                    select('Model preference / exact owned model',path+'preferredEquipmentId',c.preferredEquipmentId,
                        s.data.knowledge.entries.filter(e=>e.recording).map(e=>[e.id,e.title]).concat([['unknown','Other or unknown - management review']]))+
                    '<p>Leave model preference unknown for a Home2Smart equipment comparison; an unknown customer-owned model is not replaced by another model.</p>'+
                    `<fieldset><legend>Coverage area for this position</legend>${[['front_door','Front door'],['driveway','Driveway'],['backyard','Backyard'],['side_yard','Side yard'],['other','Other']].map(([id,title])=>`<label class="field-sales__check"><input type="checkbox" data-offer-coverage="${id}" data-offer-index="${step.index}"${c.coverage.includes(id)?' checked':''}>${title}</label>`).join('')}</fieldset>`+
                    select('Recording needed',path+'recording',c.recording,[['events','Motion-event clips'],['continuous','Continuous 24/7 recording']])+
                    `<fieldset><legend>Additional required features (optional)</legend>${[['pan_tilt','Pan / tilt'],['tracking','Tracking'],['zoom_detail','Zoom detail'],['color_night_vision','Color night vision'],['floodlighting','Floodlighting']].map(([id,title])=>`<label class="field-sales__check"><input type="checkbox" data-offer-feature="${id}" data-offer-index="${step.index}"${c.requiredFeatures.includes(id)?' checked':''}>${title}</label>`).join('')}</fieldset>`;
            } else if (step.kind==='cameraSite') {
                const c=a.cameras[step.index],path='cameras.'+step.index+'.';
                fields=['outdoor','coveragePositionVerified','mountingCompatible','standardInstallation','storageVerified','equipmentCompatibilityVerified','wifiConfirmed']
                    .map(key=>flag(flagNames[key],path+key,c[key])).join('')+
                    ((s.data.knowledge.entries.find(entry=>entry.id===c.preferredEquipmentId)?.requiresHomebase || a.existingHub.type!=='none' || a.preferences.storage==='shared_homebase')
                        ? flag(flagNames.homebaseLinkConfirmed,path+'homebaseLinkConfirmed',c.homebaseLinkConfirmed):'')+
                    '<p>Wi-Fi describes data, not power. Confirm the coverage position independently; tracking is not simultaneous coverage of separate areas.</p>';
            } else if (step.kind==='cameraPower') {
                const c=a.cameras[step.index],path='cameras.'+step.index+'.',model=s.data.knowledge.entries.find(entry=>entry.id===c.preferredEquipmentId);
                const solar=!model || model.solarSupported;
                fields='<p>An outlet alone is not verified camera power. Solar charges a battery; it does not guarantee runtime or continuous recording. Consult the product reference for exact requirements.</p>'+
                    (solar?flag(flagNames.sunlightSuitable,path+'sunlightSuitable',c.sunlightSuitable)+input('Verified direct sun hours per day',path+'directSunHours',c.directSunHours,0,24)+
                        flag(flagNames.batteryMaintenanceAccepted,path+'batteryMaintenanceAccepted',c.batteryMaintenanceAccepted):'')+
                    (!model || model.powerMode==='continuous_usb_c_dc'?flag(flagNames.c31PowerCompatible,path+'c31PowerCompatible',c.c31PowerCompatible):'')+
                    (!model || model.powerMode==='hardwired_ac'?flag(flagNames.floodlightPowerCompatible,path+'floodlightPowerCompatible',c.floodlightPowerCompatible):'');
            } else fields=review();
            target.innerHTML=`${s.data.changed?'<p class="field-offers__warning">The saved catalog or knowledge changed. Historical recommendations are preserved. Select the current version and update the recommendation before quoting.</p>':''}
                ${s.data.quoteLocked?'<p>This opportunity has a signed agreement. Discovery does not amend it. Use Additional service for this customer for a separate purchase.</p>':''}
                <p class="field-offers__progress">Step ${a.step+1} of ${sequence.length}</p><progress value="${a.step+1}" max="${sequence.length}" aria-label="Discovery progress"></progress>
                <h4 tabindex="-1" data-offer-step-title>${esc(step.title)}</h4><form data-offer-discovery class="field-offers__form">${fields}</form>
                <div class="field-sales__toolbar"><button type="button" data-offer-back${a.step===0?' disabled':''}>Back</button>
                ${step.kind!=='review'?'<button type="button" data-offer-next class="field-sales__primary">Continue</button>':'<button type="button" data-offer-update>Update recommendation</button>'}
                <button type="button" data-offer-save>Save progress</button></div>
                <div class="field-sales__toolbar"><button type="button" data-offer-retry${s.attempt?'':' hidden'}>Retry identical interrupted save</button><button type="button" data-offer-retry-quote${s.quoteAttempt?'':' hidden'}>Retry identical interrupted quote creation</button><button type="button" data-offer-reload>Reload saved copy</button></div>
                ${s.data.history.length?`<details><summary>Saved discovery revisions</summary>${s.data.history.map(h=>`<article><h4>Revision ${h.revision}</h4><p>${esc(h.document.recommendation.catalogVersion || 'No catalog selected')} - ${esc(h.document.recommendation.knowledgeVersion)}</p>
                    <p>${esc(h.document.recommendation.suggestions.map(item=>item.equipmentName || item.equipmentId || 'Unqualified equipment').join('; '))}</p><p>${esc(h.document.recommendation.priceExplanation)}</p></article>`).join('')}</details>`:''}`;
            reference(root.querySelector('[data-offer-search]').value);
            if(s.data.closed) {
                target.querySelectorAll('[data-offer-discovery] :is(input,select,textarea),[data-offer-next],[data-offer-back],[data-offer-save],[data-offer-update],[data-offer-quote]').forEach(control=>control.disabled=true);
                status('Closed opportunity. Saved discovery is read-only; use the existing additional-service workflow.');
            }
        }
        function entryHtml(entry) {
            return `<article class="field-offers__reference-entry"><h4>${esc(entry.title)}</h4><p>${esc(entry.text)}</p>
                ${['power','solar','wifi','storage','recording'].filter(key=>entry[key]).map(key=>`<p><strong>${esc(key.charAt(0).toUpperCase()+key.slice(1))}</strong> ${esc(entry[key])}</p>`).join('')}
                ${entry.compatibility?`<p>TV range ${esc(entry.compatibility.minInches)}-${esc(entry.compatibility.maxInches)} inches; maximum ${esc(entry.compatibility.maxWeightLb)} lb. Exact VESA/manual verification is still required.</p>
                    ${entry.compatibility.vesaMm?`<p>Recorded VESA bounds: ${esc(entry.compatibility.vesaMm.minimumWidth)} x ${esc(entry.compatibility.vesaMm.minimumHeight)} through ${esc(entry.compatibility.vesaMm.maximumWidth)} x ${esc(entry.compatibility.vesaMm.maximumHeight)} mm. Bounds do not prove support for every pattern.</p>`:''}`:''}
                ${entry.configuredBaseCents!==undefined?`<p><strong>Configured catalog base amount:</strong> ${esc(money(entry.configuredBaseCents))} (${esc(entry.basis)}). This is not a fully qualified or approved quote.</p>`:''}
                ${entry.inclusions?`<p><strong>Box contents in controlled reference</strong> ${esc(entry.inclusions.join('; '))}</p>`:''}
                ${entry.qualifications?`<ul>${entry.qualifications.map(text=>`<li>${esc(text)}</li>`).join('')}</ul>`:''}
                ${entry.sourceUrl?`<p><a href="${esc(entry.sourceUrl)}" target="_blank" rel="noopener noreferrer">Supplier reference</a> - checked ${esc(entry.checkedDate)}; not a live verification</p>`:''}</article>`;
        }
        function reference(query) {
            if (!s.data) return;
            const words=query.toLowerCase().trim().split(/\s+/).filter(Boolean);
            const selected=s.data.catalogs.find(catalog=>catalog.catalog_id===s.answers.catalogId);
            const catalogEntries=selected?selected.definition.services.flatMap(service=>service.offers.filter(offer=>offer.enabled).map(offer=>({
                title:offer.label,text:`${selected.version} - ${selected.status.replace(/_/g,' ')}. Quantity ${offer.minimum}-${offer.maximum}. Included scope: ${offer.scope.join('; ')}. Excluded: ${offer.exclusions.join('; ')}.`,
                configuredBaseCents:offer.unitCents,basis:offer.basis,inclusions:offer.equipment}))):[];
            const matches=[...s.data.knowledge.entries,...catalogEntries].filter(entry=>words.every(word=>JSON.stringify(entry).toLowerCase().includes(word)));
            root.querySelector('[data-offer-reference-results]').innerHTML=matches.slice(0,8).map(entry=>`<details><summary>${esc(entry.title)}</summary>${entryHtml(entry)}</details>`).join('')+
                (matches.length>8?'<p>Refine your search to see more specific results.</p>':matches.length?'':'<p>No controlled reference matches. Ask management; no specification is assumed.</p>');
        }
        function review() {
            const r=s.data.discovery?.document.recommendation;
            if (!r) return '<p>Save and update the recommendation to see qualified equipment and catalog pricing.</p>';
            const entries=s.data.knowledge.entries;
            const price=r.verifiedPriceCents ?? r.stagingEstimateCents;
            return `<div class="field-offers__recommendation">${r.suggestions.map(item=>`<article><h4>${esc(item.title)}</h4><p><strong>${esc(item.equipmentName || entries.find(e=>e.id===item.equipmentId)?.title || (item.kind==='tv'?'Customer-owned or unqualified mount':'No fully qualified camera'))}</strong></p>
                ${item.reasons.length?`<ul>${item.reasons.map(reason=>`<li>${esc(reason)}</li>`).join('')}</ul>`:''}
                ${item.missing.length?`<p><strong>Still needs qualification</strong></p><ul>${item.missing.map(reason=>`<li>${esc(reason)}</li>`).join('')}</ul>`:''}
                ${item.alternativeId?`<p>Compatible alternative for discussion: ${esc(entries.find(e=>e.id===item.alternativeId)?.title || item.alternativeId)}. This does not change the selected quote equipment.</p>`:''}</article>`).join('')}
                <p><strong>${r.stagingEstimateCents!==null?'Staging-only catalog estimate':'Verified complete catalog price'}: ${esc(money(price))}</strong></p><p>${esc(r.priceExplanation)}</p>
                ${r.calculatedQuote?`<details><summary>Exact catalog inclusions and exclusions</summary>${r.calculatedQuote.lines.map(line=>`<article><h4>${esc(line.description)}</h4><p>Equipment: ${esc(line.equipment.join('; '))}</p><p>Included scope: ${esc(line.scope.join('; '))}</p><p>Excluded: ${esc(line.exclusions.join('; '))}</p>${line.discountCents!==undefined?`<p>Configured marginal base-price discount: ${esc(money(line.discountCents))}. Upgrades unchanged.</p>`:''}</article>`).join('')}</details>`:''}
                ${r.missing.length?`<h4>Missing facts / management review</h4><ul>${r.missing.map(reason=>`<li>${esc(reason)}</li>`).join('')}</ul>`:''}</div>
                ${r.questions.map(group=>`<fieldset><legend>${esc(group.title)} - catalog qualifications</legend>${group.questions.map(q=>{
                    const value=s.answers.quoteAnswers[group.key]?.[q.id] ?? '';
                    if (q.type==='select') return `<label>${esc(q.label)}${q.required?' (required)':''}<select data-offer-answer="${esc(q.id)}" data-offer-answer-key="${esc(group.key)}"><option value="">Not yet known</option>${q.options.map(option=>`<option${value===option?' selected':''}>${esc(option)}</option>`).join('')}</select></label>`;
                    return `<label>${esc(q.label)}${q.required?' (required)':''}<input data-offer-answer="${esc(q.id)}" data-offer-answer-key="${esc(group.key)}" type="${q.type==='number'?'number':'text'}" value="${esc(value)}"${q.type==='number'?` min="${esc(q.min??0)}" max="${esc(q.max??100000)}"`:' maxlength="2000"'}></label>`;
                }).join('')}</fieldset>`).join('')}
                <div class="field-sales__toolbar"><button type="button" data-offer-quote class="field-sales__primary"${r.canCreateQuote && !s.dirty && !s.saving && !s.data.changed && !s.data.quoteLocked && !s.data.closed?'':' disabled'}>Calculate &amp; save quote draft</button>
                <button type="button" data-offer-open-quotes>Open existing quote workflow</button><button type="button" data-offer-review-assessment>Review full service assessment</button></div>
                <p>Discovery does not submit, approve or pay a quote. Unsupported scope needs the existing management review; no automatic custom price is created.</p>`;
        }
        async function load(discard=false) {
            if (discard && isDirty() && !global.confirm('Discard unsaved discovery edits and reload the exact saved copy?')) return;
            if (s.saving || s.quoteAttempt) {status('Finish or retry the current write before reloading; an uncertain quote is not discarded.');return;}
            clearTimeout(s.timer);s.attempt=null;s.dirty=false;
            try {
                const data=await api();
                if (!current()) return;
                if (!Array.isArray(data.catalogs) || !data.knowledge?.entries || !Array.isArray(data.history)
                    || (data.discovery && (!Number.isSafeInteger(data.discovery.revision) || !data.discovery.document?.answers))) throw Error('Saved discovery response incomplete. No successful restoration is assumed.');
                s.data=data;s.answers=data.discovery?JSON.parse(JSON.stringify(data.discovery.document.answers)):empty();
                s.revision=data.discovery?.revision || 0;s.started=!!data.discovery;s.error=null;s.edits=0;
                shell();render();status(data.discovery?'Saved discovery restored. Review catalog and knowledge changes before quoting.':'Choose Start guided discovery; product reference is also available.');
            } catch(error) {if(current()) {console.error('Field offer discovery read failed.',error.message);shell();status(error.message,true);root.querySelector('[data-offer-wizard]').innerHTML='<button type="button" data-offer-reload>Retry loading discovery</button>';}}
        }
        async function save(stage='progress') {
            if (s.saving) {s.pendingStage=stage;return false;}
            if (s.quoteAttempt) {status('Retry the identical interrupted quote creation before editing discovery.',true);return false;}
            const form=root.querySelector('[data-offer-discovery]');
            if (form && !form.reportValidity()) {status('Review the highlighted input before saving.',true);return false;}
            clearTimeout(s.timer);s.saving=true;
            const edit=s.attempt?.edit ?? s.edits;
            const body=s.attempt?.body ?? {action:'save',leadId:options.leadId,operationId:global.crypto.randomUUID(),revision:s.revision,
                answers:JSON.parse(JSON.stringify(s.answers)),stage,knowledgeHash:s.data.knowledge.hash,
                catalogHash:s.data.catalogs.find(c=>c.catalog_id===s.answers.catalogId)?.digest ?? null};
            s.attempt={body,edit};status('Saving structured discovery...');
            try {
                const result=await api(body);
                if (!current()) return false;
                if (!result.discovery?.document?.recommendation || !Number.isSafeInteger(result.discovery.revision) || !Array.isArray(result.history)) throw Error('Save confirmation incomplete. Retry the identical operation; no success is assumed.');
                s.data.discovery=result.discovery;s.data.history=result.history;s.revision=result.discovery.revision;s.attempt=null;s.error=null;
                s.dirty=s.edits!==edit;s.data.changed=false;status(s.dirty?'Saved prior input; saving your newer edits next...':'Discovery saved. Quote approval and payment remain separate.');
                return true;
            } catch(error) {
                if(current()) {console.error('Field offer discovery save failed.',error.message);s.error=error;status(error.message,true);
                    if (error.status>=400 && error.status<500) s.attempt=null;
                    root.querySelector('[data-offer-retry]')?.toggleAttribute('hidden',!s.attempt);
                }return false;
            } finally {
                s.saving=false;
                if(current() && !s.dirty && !s.error && body.stage==='recommendation') render();
                if(current() && s.dirty && !s.error) {const next=s.pendingStage || 'progress';s.pendingStage=null;s.timer=setTimeout(()=>save(next),800);}
            }
        }
        function changed() {
            s.edits++;s.dirty=true;s.error=null;clearTimeout(s.timer);
            const button=root.querySelector('[data-offer-quote]');if(button)button.disabled=true;
            status('Answers changed. Saving progress; update the recommendation before quoting.');
            if (!s.attempt) s.timer=setTimeout(()=>save('progress'),800);
        }
        function control(event) {
            const el=event.target;
            if (el.hasAttribute('data-offer-path')) {
                const parts=el.dataset.offerPath.split('.'),key=parts.pop();let target=s.answers;
                for(const part of parts) target=target[part];
                let value=el.dataset.offerKind==='flag'?(el.value===''?null:el.value==='yes')
                    :el.dataset.offerKind==='number'?(el.value===''?null:Number(el.value)):el.value || null;
                if (el.dataset.offerPath==='tvs.'+parts[1]+'.location') value=el.value;
                if (target[key]===value) return;
                target[key]=value;
                if (key==='recording') {
                    target.requiredFeatures=target.requiredFeatures.filter(feature=>feature!=='continuous_recording');
                    if (value==='continuous') target.requiredFeatures.push('continuous_recording');
                }
                if (key==='tvQuantity' || key==='cameraQuantity') {
                    const list=key==='tvQuantity'?'tvs':'cameras',count=value!==null && Number.isInteger(value) && value>=1 && value<=16 ? value : 0;
                    s.answers[list]=Array.from({length:count},(_,index)=>s.answers[list][index] || (list==='tvs'?tv():camera(index)));
                }
                if (el.dataset.offerPath==='existingHub.type' && value==='none') {s.answers.existingHub.compatibilityVerified=null;s.answers.existingHub.availableCameraSlots=null;s.answers.hubRouterConnectionConfirmed=null;}
                changed();
                if (event.type==='change' && ['tvQuantity','cameraQuantity','type','preferredEquipmentId'].includes(key)) render();
            } else if (el.hasAttribute('data-offer-service')) {
                s.answers.services=[...root.querySelectorAll('[data-offer-service]:checked')].map(input=>input.dataset.offerService);
                if (!s.answers.services.includes('tv')) {s.answers.tvs=[];s.answers.tvQuantity=null;}
                if (!s.answers.services.includes('cameras')) {s.answers.cameras=[];s.answers.cameraQuantity=null;}
                changed();render();
            } else if (el.hasAttribute('data-offer-coverage') || el.hasAttribute('data-offer-feature')) {
                const index=Number(el.dataset.offerIndex),feature=el.hasAttribute('data-offer-feature'),attribute=feature?'feature':'coverage';
                s.answers.cameras[index][feature?'requiredFeatures':'coverage']=[...root.querySelectorAll(`[data-offer-${attribute}][data-offer-index="${index}"]:checked`)].map(input=>input.dataset[feature?'offerFeature':'offerCoverage']);
                if (feature && s.answers.cameras[index].recording==='continuous') s.answers.cameras[index].requiredFeatures.push('continuous_recording');
                changed();
            } else if (el.hasAttribute('data-offer-answer')) {
                const group=s.answers.quoteAnswers[el.dataset.offerAnswerKey] ||= {};
                if (el.value==='') delete group[el.dataset.offerAnswer];
                else group[el.dataset.offerAnswer]=el.type==='number'?Number(el.value):el.value;
                changed();
            }
        }
        root.addEventListener('input',event=>{if(event.target.matches('[data-offer-search]'))reference(event.target.value);else if(!['checkbox','SELECT'].includes(event.target.type) && event.target.tagName!=='SELECT')control(event);});
        root.addEventListener('change',event=>control(event));
        root.addEventListener('click',async event=>{
            const button=event.target.closest('button');if(!button || !current())return;
            if(button.hasAttribute('data-offer-start')) {s.started=true;changed();render();await save();}
            if(button.hasAttribute('data-offer-reload')) await load(true);
            if(button.hasAttribute('data-offer-save') || button.hasAttribute('data-offer-retry')) await save();
            if(button.hasAttribute('data-offer-update')) await save('recommendation');
            if(button.hasAttribute('data-offer-next') || button.hasAttribute('data-offer-back')) {
                const form=root.querySelector('[data-offer-discovery]');if(form&&!form.reportValidity())return;
                s.answers.step=Math.max(0,Math.min(steps().length-1,s.answers.step+(button.hasAttribute('data-offer-next')?1:-1)));changed();render();
                root.querySelector('[data-offer-step-title]').focus();await save(steps()[s.answers.step].kind==='review'?'recommendation':'progress');
            }
            if(button.hasAttribute('data-offer-open-quotes') || button.hasAttribute('data-offer-review-assessment')) {
                if (!canLeave()) return;
                if(button.hasAttribute('data-offer-open-quotes'))options.openQuotes();
                else options.reviewAssessment();
            }
            if(button.hasAttribute('data-offer-quote') || button.hasAttribute('data-offer-retry-quote')) {
                if(s.saving || (s.dirty && !s.quoteAttempt)) {status('Save and update the current recommendation first.',true);return;}
                s.saving=true;button.disabled=true;
                s.quoteAttempt ||= {action:'quote',leadId:options.leadId,operationId:global.crypto.randomUUID(),revision:s.revision,knowledgeHash:s.data.knowledge.hash};
                try {const result=await api(s.quoteAttempt);
                    if(!current())return;if(typeof result.id!=='string')throw Error('Quote creation confirmation incomplete. Check existing quote revisions before retrying.');
                    s.saving=false;s.quoteAttempt=null;options.openQuotes(result.id);
                } catch(error) {if(current()){console.error('Field offer quote handoff failed.',error.message);
                    if(error.status>=400 && error.status<500)s.quoteAttempt=null;
                    status(error.message+' Check existing quote revisions before trying a new quote.',true);
                    root.querySelector('[data-offer-retry-quote]')?.toggleAttribute('hidden',!s.quoteAttempt);
                }}
                finally{s.saving=false;button.disabled=false;}
            }
        });
        root.addEventListener('submit',async event=>{
            if(!event.target.matches('[data-offer-ask]'))return;event.preventDefault();
            if(s.asking)return;s.asking=true;const form=event.target,button=form.querySelector('button'),target=root.querySelector('[data-offer-ask-status]');button.disabled=true;
            try {const result=await api({action:'ask',leadId:options.leadId,operationId:global.crypto.randomUUID(),question:form.elements.question.value});
                if(!current())return;if(!Array.isArray(result.entries))throw Error('Product-reference answer is incomplete.');
                target.textContent=result.notice;root.querySelector('[data-offer-ask-results]').innerHTML=result.entries.map(entryHtml).join('') || '<p>No grounded answer is available. Use product reference or request management review.</p>';
            } catch(error){if(current()){console.error('Field offer reference request failed.',error.message);target.textContent=error.message;target.setAttribute('role','alert');}}
            finally{s.asking=false;button.disabled=false;}
        });
        root.addEventListener('toggle',async event=>{
            if(!event.target.matches('[data-offer-reference]') || !event.target.open || s.referenceRecorded || !s.data)return;
            s.referenceRecorded=true;
            try {await api({action:'knowledge',leadId:options.leadId,operationId:global.crypto.randomUUID(),entryIds:[]});}
            catch(error){if(current()){console.error('Field offer reference activity could not be recorded.',error.message);status('Product reference is available, but its activity could not be recorded: '+error.message,true);}}
        },true);
        render();load();
    }
    function isDirty() {return !!active && (active.dirty || active.saving || !!active.attempt || !!active.quoteAttempt);}
    function canLeave() {
        if (!isDirty()) return true;
        const target=active.root.querySelector('[data-offer-status]');if(target)target.textContent='Save discovery or retry the identical interrupted save before leaving. Reload saved copy explicitly discards unsaved edits.';
        return false;
    }
    function reset() {if(active){clearTimeout(active.timer);active.readController.abort();active=null;}}
    global.H2SFieldOffers={mount,isDirty,canLeave,reset};
})(window);

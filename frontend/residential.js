(function () {
  'use strict';
  const form = document.getElementById('residential-form'), status = document.getElementById('residential-status');
  const submit = document.getElementById('residential-submit'), add = document.getElementById('residential-add-day');
  const separate = document.getElementById('residential-separate'), note = form.elements.notes;
  const receiptKey = 'h2s:residential:submission:v1';
  let sequence = 0, sending = false, completed = false, pending = null, enabled = false, formIdentity = null, pendingDigest = null, separateProject = false;
  const serviceError = document.getElementById('residential-service-error');
  const preferenceStatus = document.getElementById('residential-preferences-status');
  function sizeNote() { note.style.height='auto';note.style.height=(note.scrollHeight+2)+'px'; }
  note.addEventListener('input',sizeNote);
  sizeNote();
  function readReceipt() {
    const raw = sessionStorage.getItem(receiptKey);
    if (!raw) return null;
    const receipt = JSON.parse(raw), token = /^[A-Za-z0-9_-]{20,120}$/;
    if (!receipt || !/^[a-f0-9]{64}$/.test(receipt.digest) || !token.test(receipt.publicToken)
      || !token.test(receipt.submissionKey) || !(receipt.reference===null || typeof receipt.reference==='string' && receipt.reference.length<=80)) {
      throw new Error('The previous submission receipt could not be read. Contact Home2Smart before sending again.');
    }
    return receipt;
  }
  function remember(reference = null) {
    sessionStorage.setItem(receiptKey,JSON.stringify({digest:pendingDigest,publicToken:pending.publicToken,
      submissionKey:pending.submissionKey,reference}));
  }
  function finish(message) {
    completed=true;submit.textContent='Request received';
    document.getElementById('residential-submit-hint').hidden=true;
    status.textContent=message;separate.hidden=false;separate.disabled=false;
  }
  separate.onclick = () => {
    completed=false;pending=null;pendingDigest=null;formIdentity=null;separateProject=true;
    Array.from(form.elements).forEach(control=>{control.disabled=false;});
    document.querySelectorAll('[data-remove]').forEach(button=>button.click());
    form.reset();sizeNote();separate.hidden=true;submit.disabled=!enabled;
    submit.textContent='Request a follow-up';document.getElementById('residential-submit-hint').hidden=false;
    status.textContent='Enter the details for the separate project.';form.querySelector('[name=service]').focus();
  };
  function fieldError(name, message) {
    const field = form.elements.namedItem(name), error = document.getElementById(field.getAttribute('aria-describedby'));
    field.setAttribute('aria-invalid', String(!!message));
    error.textContent = message;
  }
  function validate() {
    const services = form.querySelectorAll('[name=service]:checked');
    serviceError.textContent = services.length ? '' : 'Choose one or both services.';
    let first = services.length ? null : form.querySelector('[name=service]');
    for (const [name, message] of [['fullName','Enter your name.'],['phone','Enter your phone number.'],['city','Enter your city.']]) {
      const field = form.elements.namedItem(name);
      let error = field.value.trim() ? '' : message;
      if (!error && name === 'phone') {
        const digits = field.value.replace(/\D/g, '');
        if (!/^[+\d\s().-]+$/.test(field.value.trim()) || digits.length < 10 || digits.length > 15) error = 'Enter a valid area code and number.';
      }
      fieldError(name, error);
      if (error && !first) first = field;
    }
    if (first) { status.textContent = 'Check the highlighted details.'; first.focus(); return false; }
    return form.checkValidity();
  }
  form.addEventListener('input', event => {
    if (['fullName','phone','city'].includes(event.target.name)) fieldError(event.target.name, '');
    if (event.target.name === 'service') serviceError.textContent = '';
    if (!form.querySelector('[aria-invalid="true"]') && !serviceError.textContent && status.textContent === 'Check the highlighted details.') status.textContent = '';
  });
  const mediaStatus = document.getElementById('residential-proof-status'), mediaRoot = document.getElementById('residential-proof-media');
  if (mediaRoot) {
    const controller = new AbortController(), timer = setTimeout(()=>controller.abort(),15000);
    Promise.resolve().then(()=>window.H2SResidentialMedia.read(async url => {
      const response = await fetch(url,{cache:'no-store',signal:controller.signal});
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Installation photos are unavailable.');
      return result;
    })).then(selected=>window.H2SResidentialMedia.render(mediaRoot,selected,mediaStatus))
      .catch(error=>{mediaStatus.textContent='Installation photos could not load. You can still send your request.';console.warn('[Residential media]',error);})
      .finally(()=>{clearTimeout(timer);mediaRoot.setAttribute('aria-busy','false');});
  }
  function identity() { return {publicToken:crypto.randomUUID(),submissionKey:crypto.randomUUID()}; }
  async function request(method, body) {
    const controller = new AbortController(), timer = setTimeout(()=>controller.abort(),20000);
    try {
      const response = await fetch('/api/residential-intake',{method,cache:'no-store',signal:controller.signal,
        ...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
      const data = await response.json();
      if (!response.ok || !data.ok) throw Object.assign(new Error(data.error || 'The request service is unavailable.'),{status:response.status});
      return data;
    } finally { clearTimeout(timer); }
  }
  function preference(row) { return {date:row.querySelector('[data-date]').value,period:row.querySelector('input:checked').value}; }
  add.onclick = () => {
    const holder = document.getElementById('residential-availability');
    if (holder.children.length>=3) return;
    if (typeof window.flatpickr!=='function') { preferenceStatus.textContent='The calendar could not load. You can send your request without preferred days.'; return; }
    preferenceStatus.textContent='';
    document.getElementById('residential-preferences-hint').hidden=false;
    const id = ++sequence, row = document.createElement('div');
    row.className = 'residential-availability-row';
    row.innerHTML = `<label class="residential-field">Preferred day<input data-date type="text" placeholder="Choose a day (optional)" aria-label="Preferred day ${id}"></label>
      <fieldset class="residential-periods"><legend>Broad availability</legend>${['morning','afternoon','evening','flexible'].map(value=>
        `<label><input type="radio" name="period-${id}" value="${value}" ${value==='flexible'?'checked':''}>${value[0].toUpperCase()+value.slice(1)}</label>`).join('')}</fieldset>
      <button type="button" class="residential-secondary" data-remove>Remove day</button>`;
    holder.append(row);
    const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    const picker = window.flatpickr(row.querySelector('[data-date]'),{...window.h2sDatePopupOptions,
      dateFormat:'Y-m-d',altInput:true,altFormat:'M j, Y',minDate:today,disableMobile:true,monthSelectorType:'static'});
    row.querySelector('[data-remove]').onclick = () => {
      picker.destroy();row.remove();add.disabled=holder.children.length>=3;
      document.getElementById('residential-preferences-hint').hidden=!holder.children.length;
      add.focus({preventScroll:true});
    };
    add.disabled=holder.children.length>=3;
    picker.open();
  };
  form.onsubmit = async event => {
    event.preventDefault();
    if (sending || completed || !enabled) return;
    if (!pending && !validate()) return;
    sending=true;submit.disabled=true;
    const controls=Array.from(form.elements), disabled=controls.map(node=>node.disabled);
    controls.forEach(node=>{node.disabled=true;});
    let posted=false;
    try {
      if (!pending) {
        const digits=form.elements.phone.value.replace(/\D/g,'');
        const input={fullName:form.elements.fullName.value.trim(),phone:'+'+(digits.length===10?'1':'')+digits,
          city:form.elements.city.value.trim(),serviceNeeds:Array.from(form.querySelectorAll('[name=service]:checked'),node=>node.value),
          notes:note.value.trim(),smsOptIn:form.elements.smsOptIn.checked,
          availabilityPreferences:Array.from(document.querySelectorAll('.residential-availability-row')).filter(row=>row.querySelector('[data-date]').value).map(preference)};
        const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(input)));
        pendingDigest=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
        const receipt=readReceipt(), matching=receipt?.digest===pendingDigest;
        if (!separateProject && matching && receipt.reference) {
          finish(`These details match request ${receipt.reference}, already sent from this tab. It was not sent again. Start a separate project only for different work.`);
          return;
        }
        if (!separateProject && receipt && !receipt.reference && !matching) {
          separate.hidden=false;
          throw new Error('A previous request may have been received. Re-enter the same details to retry, or start a separate project only for different work.');
        }
        formIdentity ||= !separateProject && matching
          ? {publicToken:receipt.publicToken,submissionKey:receipt.submissionKey} : identity();
        pending={...formIdentity,...input};
      }
      try { remember(); }
      catch (error) { console.error('[Residential receipt]',error);throw new Error('This browser could not retain a safe retry receipt. Allow site storage and try again.'); }
      status.textContent='Sending your inquiry...';posted=true;
      const result=await request('POST',pending);
      const delivery=result.notifications;
      const issue=delivery?.enabled && [delivery.staff,delivery.customer].some(value=>value?.needsReview);
      finish(`Request received: ${result.reference}. No installation is booked. We will contact you to discuss the work and agree on timing.${issue?' Your inquiry is saved, but text delivery needs staff review. Please do not submit again.':''}`);
      try { remember(result.reference); }
      catch (error) { console.error('[Residential receipt]',error);status.textContent+=' This browser could not retain the confirmation. Keep your reference; do not send a new request for the same work.'; }
    } catch (error) {
      const editable=!posted || error.status===400 || error.status===413;
      if(editable) {
        pending=null;pendingDigest=null;controls.forEach((node,index)=>{node.disabled=disabled[index];});
        if(posted)try {sessionStorage.removeItem(receiptKey);}
        catch(storageError){console.error('[Residential receipt]',storageError);error.message+=' The rejected submission receipt could not be cleared; contact Home2Smart before sending changed details.';}
      }
      status.textContent=`${!posted?'Your request was not sent: ':''}${error.name==='AbortError'?'The connection timed out.':error.message} ${editable?'Review your details before sending.':'Your details are retained and locked to avoid duplicates. Retry sends this same request.'}`;
      submit.disabled=false;submit.textContent=editable?'Review and send request':'Retry this same request';
    } finally {sending=false;}
  };
  request('GET').then(result=>{
    enabled=result.enabled===true;submit.disabled=!enabled;
    status.textContent=enabled?'':'This new homeowner request form is not live yet. No request can be submitted.';
  }).catch(error=>{status.textContent=`The request service could not load. No request was submitted. ${error.message}`;});
})();

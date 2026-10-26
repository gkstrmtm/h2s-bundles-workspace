(function () {
  'use strict';
  const form = document.getElementById('residential-form'), status = document.getElementById('residential-status');
  const submit = document.getElementById('residential-submit'), add = document.getElementById('residential-add-day');
  let sequence = 0, sending = false, completed = false, pending = null, enabled = false, formIdentity = null;
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
    if (typeof window.flatpickr!=='function') { status.textContent='The date calendar could not load. Leave preferred days blank; we can discuss availability by phone.'; return; }
    const id = ++sequence, row = document.createElement('div');
    row.className = 'residential-availability-row';
    row.innerHTML = `<label class="residential-field">Preferred day<input data-date type="text" placeholder="Choose a day" required aria-label="Preferred day ${id}"></label>
      <fieldset class="residential-periods"><legend>Broad availability</legend>${['morning','afternoon','evening','flexible'].map(value=>
        `<label><input type="radio" name="period-${id}" value="${value}" ${value==='flexible'?'checked':''}>${value[0].toUpperCase()+value.slice(1)}</label>`).join('')}</fieldset>
      <button type="button" class="residential-secondary" data-remove>Remove day</button>`;
    holder.append(row);
    const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    const picker = window.flatpickr(row.querySelector('[data-date]'),{...window.h2sDatePopupOptions,
      dateFormat:'Y-m-d',altInput:true,altFormat:'M j, Y',minDate:today,disableMobile:true,monthSelectorType:'static'});
    row.querySelector('[data-remove]').onclick = () => {picker.destroy();row.remove();add.disabled=holder.children.length>=3;};
    add.disabled=holder.children.length>=3;
    picker.open();
  };
  form.onsubmit = async event => {
    event.preventDefault();
    if (sending || completed || !enabled) return;
    if (!pending) {
      if (!form.reportValidity()) return;
      const serviceNeeds = Array.from(form.querySelectorAll('[name=service]:checked'),input=>input.value);
      if (!serviceNeeds.length) {status.textContent='Choose TV mounting, security cameras, or both.';form.querySelector('[name=service]').focus();return;}
      try { pending = {...(formIdentity || (formIdentity=identity())),fullName:form.elements.fullName.value,phone:form.elements.phone.value,city:form.elements.city.value,
        serviceNeeds,notes:form.elements.notes.value,smsOptIn:form.elements.smsOptIn.checked,
        availabilityPreferences:Array.from(document.querySelectorAll('.residential-availability-row'),preference)}; }
      catch (error) {status.textContent=`Your request was not sent: ${error.message}`;return;}
    }
    sending=true;submit.disabled=true;
    const controls=Array.from(form.elements), disabled=controls.map(node=>node.disabled);
    controls.forEach(node=>{node.disabled=true;});
    status.textContent='Sending your inquiry...';
    try {
      const result=await request('POST',pending);
      completed=true;
      const delivery=result.notifications;
      const issue=delivery?.enabled && [delivery.staff,delivery.customer].some(value=>value?.needsReview);
      status.textContent=`Request received: ${result.reference}. No installation is booked. We will contact you to discuss the work and agree on timing.${issue?' Your inquiry is saved, but text delivery needs staff review. Please do not submit again.':''}`;
      submit.textContent='Request received';
    } catch (error) {
      const editable=error.status===400 || error.status===413;
      if(editable) {pending=null;controls.forEach((node,index)=>{node.disabled=disabled[index];});}
      status.textContent=`${error.name==='AbortError'?'The connection timed out.':error.message} ${editable?'Review your details and send again.':'Your details are retained and locked to avoid duplicates. Retry sends this same request.'}`;
      submit.disabled=false;submit.textContent=editable?'Review and send request':'Retry this same request';
    } finally {sending=false;}
  };
  request('GET').then(result=>{
    enabled=result.enabled===true;submit.disabled=!enabled;
    status.textContent=enabled?'No appointment is booked until we agree on a time with you.':'This new homeowner request form is not live yet. No request can be submitted.';
  }).catch(error=>{status.textContent=`The request service could not load. No request was submitted. ${error.message}`;});
})();

(function () {
  'use strict';
  const token=new URLSearchParams(location.search).get('token') || '', form=document.getElementById('residential-review-form');
  const status=document.getElementById('residential-review-status'), details=document.getElementById('residential-review-details');
  let sending=false;
  async function request(body) {
    const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),20000);
    try {
      const response=await fetch(`/api/residential-review${body?'':`?token=${encodeURIComponent(token)}`}`,{
        method:body?'POST':'GET',cache:'no-store',referrerPolicy:'no-referrer',signal:controller.signal,
        ...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
      const result=await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || 'Review is unavailable.');
      return result;
    } finally {clearTimeout(timer);}
  }
  function decision(value) {
    return value==='approved'?'Follow-up accepted.':
      value==='declined'?'Recorded: another reviewer is needed.':`Request state: ${value}.`;
  }
  request().then(result=>{
    const inquiry=result.inquiry;
    document.getElementById('residential-customer-name').textContent=inquiry.name;
    document.getElementById('residential-customer-context').textContent=[inquiry.services.join(', '),inquiry.city].filter(Boolean).join(' · ');
    document.title=`${inquiry.name} | Home2Smart`;
    const call=document.getElementById('residential-call'), phone=String(inquiry.phone || '').trim();
    if(call && /^\+?[0-9 ()-]+$/.test(phone) && /^\+?\d{7,15}$/.test(phone.replace(/[ ()-]/g,''))) {
      call.href=`tel:${phone.replace(/[ ()-]/g,'')}`;call.textContent=phone;call.hidden=false;
      document.getElementById('residential-phone-row').hidden=false;
    }
    for (const [label,value] of Object.entries({'Reference':inquiry.reference,...(call.hidden?{'Phone':inquiry.phone}:{}),
      'Availability':inquiry.availability,Notes:inquiry.notes || 'No extra notes'})) {
      const row=document.createElement('div');
      const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value;
      row.append(dt,dd);details.append(row);
    }
    form.hidden=inquiry.status!=='pending';
    document.getElementById('residential-review-options').hidden=form.hidden;
    document.getElementById('residential-review-trigger').hidden=form.hidden;
    document.getElementById('residential-review-boundary').hidden=form.hidden;
    window.H2SResidentialWorkspace?.setInquiry(inquiry);
  }).catch(error=>{status.textContent=`Unable to load this inquiry: ${error.message}`;});
  form.onsubmit=async event=>{
    event.preventDefault();if(sending)return;
    const action=event.submitter?.value;if(!['approve','decline'].includes(action))return;
    sending=true;window.H2SResidentialWorkspace?.setReviewBusy(true);
    const buttons=Array.from(form.querySelectorAll('button'));buttons.forEach(button=>{button.disabled=true;});
    status.textContent='Recording your decision...';
    try {
      const result=await request({token,action,note:form.elements.note.value});
      status.textContent=decision(result.status)+(result.customer && (!result.customer.ok || result.customer.persistenceError)?' Customer text needs delivery or message-history review. Do not resend automatically.':'');
      form.hidden=true;
      document.getElementById('residential-review-options').hidden=true;
      document.getElementById('residential-review-trigger').hidden=true;
      document.getElementById('residential-review-boundary').hidden=true;
      window.H2SResidentialWorkspace?.setReviewStatus(result.status);
    } catch(error) {
      status.textContent=`${error.message} Review decisions do not change installation reservations. Reload the latest state before changing your decision.`;
      buttons.forEach(button=>{button.disabled=false;});
    } finally {sending=false;window.H2SResidentialWorkspace?.setReviewBusy(false);}
  };
})();

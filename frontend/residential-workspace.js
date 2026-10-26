(function () {
  'use strict';
  const byId=id=>document.getElementById(id), login=byId('workspace-login'), panel=byId('workspace-authenticated');
  if (!login || !panel) return;
  const callback=byId('workspace-callback'), status=byId('workspace-status');
  const reviewToken=new URLSearchParams(location.search).get('token') || '';
  const sessionKey='h2s_dashboard_session_token_v1';
  let session='', workspace=null, inquiry=null, dirty=false, reservationDirty=false, pending=null, conflict=false, busy=false, mountedLead='';
  let generation=0, loading=false, accessDenied=false;
  let reviewBusy=false, installationIntent='', scheduleError=false, reloadQueued=false;
  const taskDialog=byId('workspace-task-dialog');
  let activeTask='', exitTarget=null, overviewScroll=0, returnFocus=null, reviewDirty=false, afterLogin='';
  const escape=value=>String(value || '').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  function storageWarning() {
    byId('workspace-storage').textContent='Device storage is unavailable. Sign-in works in memory only; keep this page open to retain callback drafts and unchanged retries.';
  }
  function stored(storage,key,value) {
    try {
      const store=window[storage];
      if (value===undefined) return store.getItem(key);
      if (value===null) store.removeItem(key); else store.setItem(key,value);
    } catch (_) { storageWarning(); }
    return null;
  }
  session=stored('localStorage',sessionKey) || '';
  function retryKey() { return `h2s_residential_callback_retry_v1:${workspace.leadId}`; }
  function persistPending() {
    if (workspace) stored('sessionStorage',retryKey(),pending?JSON.stringify(pending):null);
  }
  function signedOut(message,clearSession=true) {
    taskDialog.querySelectorAll('input').forEach(input=>input._flatpickr?.close());
    generation++;accessDenied=!clearSession;
    if(clearSession){session='';stored('localStorage',sessionKey,null);}
    panel.hidden=true;login.hidden=!clearSession;mountedLead='';
    byId('workspace-login-explanation').hidden=!clearSession;
    byId('workspace-account-switch').hidden=clearSession;
    byId('commercialCalendar').replaceChildren();byId('workspace-reservation').replaceChildren();
    byId('workspace-calendar-history').replaceChildren();
    byId('workspace-saved').textContent='Sign in to view saved callback.';
    byId('workspace-signout').hidden=clearSession;
    byId('workspace-context').textContent=clearSession?'Use your existing dashboard account.':'Your account does not have scheduling access.';
    const installation=byId('residential-installation-time');
    if(installation)installation.textContent=clearSession?'Sign in to check the saved installation time.':'Your dashboard account does not have scheduling access.';
    status.textContent=message || 'Signed out. Sign in to view saved times.';
    renderOverview();
    if(activeTask)showTask('account');
  }
  function authError(code) {
    if(code===403) {
      signedOut('Your account lacks scheduling access (ADMIN role required). Use another account or ask the dashboard owner.',false);
    } else signedOut('Your session expired. Sign in to view saved times.');
  }
  async function request(url,body,authenticated=true) {
    const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),20000);
    try {
      const response=await fetch(url,{method:body?'POST':'GET',cache:'no-store',credentials:'same-origin',
        referrerPolicy:'no-referrer',signal:controller.signal,
        headers:{...(authenticated?{Authorization:`Bearer ${session}`} : {}),...(body?{'Content-Type':'application/json'}:{})},
        ...(body?{body:JSON.stringify(body)}:{})});
      if (authenticated && [401,403].includes(response.status)) {
        authError(response.status);
        const error=new Error('Staff scheduling access required.');error.auth=true;throw error;
      }
      const result=await response.json();
      if (!response.ok || !result.ok) {
        const error=new Error(result.error || 'Request failed.');error.status=response.status;throw error;
      }
      return result;
    } finally { clearTimeout(timer); }
  }
  function localDate(instant) {
    if (!instant) return '';
    const date=new Date(instant);
    if (!Number.isFinite(date.getTime())) return '';
    return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')} ${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;
  }
  function instantValue(form,name) {
    const input=form.elements.namedItem(name), value=input.value.trim().replace(' ','T');
    if (!value) return '';
    if (value===input.dataset.localValue && input.dataset.instant) return input.dataset.instant;
    const instant=new Date(value);
    if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(value) || !Number.isFinite(instant.getTime())
        || localDate(instant).replace(' ','T')!==value) {
      throw new Error('Choose a valid local time. This time may not exist during a timezone clock change.');
    }
    for(let delta=-180;delta<=180;delta+=15) {
      if(delta && localDate(new Date(instant.getTime()+delta*60000)).replace(' ','T')===value) {
        throw new Error('This time occurs twice during a timezone clock change. Choose an unambiguous time; unchanged saved times retain their original instant.');
      }
    }
    return instant.toISOString();
  }
  function hasWorkspace() { return !!session && !!workspace && !panel.hidden && !accessDenied; }
  function bookingState(booking) {
    return !booking?'none':booking.state==='tentative' && Date.parse(booking.expires_at)<=Date.now()?'expired':booking.effective_state || booking.state;
  }
  function callbackTime(value) {
    return Number.isFinite(Date.parse(value))?new Date(value).toLocaleString(undefined,{
      weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}):'';
  }
  function reveal(id,open=false) {
    const element=byId(id);
    if(open)element.open=true;
    element.scrollIntoView?.({block:'start',behavior:window.matchMedia?.('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
  }
  function calendarState() {
    return window.H2SCommercialCalendar?.leadState?.(reservationRoot) ||
      {ready:!!reservationRoot.querySelector('[data-calendar-form]'),saving:false,retry:false};
  }
  function taskDirty(task) {
    return task==='callback'?(dirty || !!pending || conflict):task==='installation'?(reservationDirty || calendarState().retry):task==='review'?reviewDirty:false;
  }
  function syncTask() {
    const state=calendarState(), saving=busy || reviewBusy || state.saving;
    byId('workspace-account-trigger').textContent=session?'Account':'Sign in';
    byId('workspace-signout').hidden=!session;
    const savingTask=activeTask==='callback' || activeTask==='installation';
    byId('workspace-task-save').hidden=!savingTask;
    byId('workspace-task-save').disabled=saving || (activeTask==='callback' && (!!pending || conflict || workspace?.reviewStatus!=='approved'))
      || (activeTask==='installation' && (!state.ready || !reservationRoot.querySelector('[data-calendar-form]')));
    byId('workspace-task-cancel').disabled=saving;
    byId('workspace-task-cancel').textContent=savingTask || activeTask==='review'?'Cancel':'Done';
    byId('workspace-task-nav').hidden=!hasWorkspace() || activeTask==='account' || activeTask==='review';
    byId('workspace-task-nav').querySelectorAll('[data-workspace-task]').forEach(button=>{
      button.disabled=saving || !!exitTarget || (['callback','installation'].includes(button.dataset.workspaceTask) && workspace?.reviewStatus!=='approved');
      button.setAttribute('aria-pressed',String(button.dataset.workspaceTask===activeTask));
    });
    byId('workspace-task-status').textContent=activeTask==='review'?byId('residential-review-status').textContent:status.textContent;
  }
  function showTask(task,intent='') {
    if(!['account','review'].includes(task) && !hasWorkspace()){afterLogin=task;task='account';}
    if(['callback','installation'].includes(task) && workspace?.reviewStatus!=='approved')task='review';
    if(!taskDialog.open) {
      overviewScroll=window.scrollY;returnFocus=document.activeElement;
      document.body.classList.add('residential-task-open');
      taskDialog.showModal();
    }
    taskDialog.querySelectorAll('input').forEach(input=>input._flatpickr?.close());
    activeTask=task;
    taskDialog.querySelectorAll('[data-workspace-task-panel]').forEach(element=>{element.hidden=element.dataset.workspaceTaskPanel!==task;});
    const titles={callback:workspace?.callback?.status==='scheduled'?'Edit callback':'Set callback',installation:byId('workspace-installation-label').textContent,
      calendar:'Shared calendar',history:'Customer history',account:'Account',review:'Review follow-up'};
    byId('workspace-task-title').textContent=titles[task];
    byId('workspace-task-customer').textContent=inquiry?[inquiry.name,inquiry.services.join(', '),inquiry.city].filter(Boolean).join(' · '):'Loading customer...';
    if(task==='installation' && !reservationDirty) {
      installationIntent=intent || (bookingState(workspace?.booking)==='confirmed'?'reschedule':'confirm');
      applyInstallationIntent();
    }
    byId('workspace-task-body').scrollTop=0;
    syncTask();
    byId('workspace-task-title').focus({preventScroll:true});
  }
  function finishTask() {
    taskDialog.querySelectorAll('input').forEach(input=>input._flatpickr?.close());
    activeTask='';exitTarget=null;
    byId('workspace-task-exit').hidden=true;byId('workspace-task-body').hidden=false;
    taskDialog.querySelector('footer').hidden=false;
    login.elements.pin.value='';
    if(taskDialog.open)taskDialog.close();
    document.body.classList.remove('residential-task-open');
    returnFocus?.focus({preventScroll:true});
    window.scrollTo({top:overviewScroll,behavior:'instant'});
  }
  function requestTask(task='',intent='') {
    if(task===activeTask && taskDialog.open)return;
    if(busy || reviewBusy || calendarState().saving)return;
    if(taskDialog.open && taskDirty(activeTask)) {
      taskDialog.querySelectorAll('input').forEach(input=>input._flatpickr?.close());
      exitTarget={task,intent};
      const uncertain=activeTask==='callback' && !!pending || activeTask==='installation' && calendarState().retry;
      byId('workspace-task-exit-message').textContent=uncertain
        ?'A save may already have reached the server. Discarding clears only this device\'s request and reloads the saved state; it does not undo a saved change.'
        :'Discard unsaved changes? Saved customer details will not change.';
      byId('workspace-task-discard').textContent=uncertain?'Discard local request':'Discard changes';
      byId('workspace-task-body').hidden=true;taskDialog.querySelector('footer').hidden=true;
      byId('workspace-task-exit').hidden=false;syncTask();byId('workspace-task-keep').focus();
      return;
    }
    if(task)showTask(task,intent);else finishTask();
  }
  function applyInstallationIntent() {
    const select=reservationRoot.querySelector('[name=calendarAction]');
    if(!installationIntent || !select || select.disabled)return;
    const action=installationIntent;installationIntent='';
    if([...select.options].some(option=>option.value===action) && select.value!==action) {
      select.value=action;select.dispatchEvent(new Event('change',{bubbles:true}));
    }
  }
  function renderOverview() {
    if(!inquiry)return;
    const authenticated=hasWorkspace(), booking=authenticated?installationSummary():null;
    const saved=authenticated?workspace.callback:null, scheduled=saved?.status==='scheduled', callTime=scheduled?callbackTime(saved.dueAt):'';
    let state='',next='',action='',label='',when=authenticated
      ?byId('residential-installation-time').textContent
      :session && !accessDenied?'Checking saved times...':'Sign in to view saved times.';
    if((authenticated?workspace.reviewStatus:inquiry.status)==='pending') {
      state='Needs follow-up acceptance';next='Accept this customer for follow-up.';action='review';label='Accept follow-up';
    } else if(accessDenied) {
      state='Scheduling access required';next='Use an account with scheduling access.';action='switch';label='Use another account';
    } else if(!authenticated) {
      state=scheduleError?'Saved times unavailable':session?'Checking schedule':'Sign-in required for saved times';
      next=scheduleError?'Check the connection before changing saved times.':session?'Loading the saved schedule.':'Sign in to see the saved schedule.';
      if(scheduleError){when='Saved times unavailable.';action='details';label='Customer details';}
      else if(!session){action='login';label='Sign in';}
    } else if(scheduleError) {
      state='Schedule could not refresh';when=`Last loaded: ${when}`;next='Check the connection before changing saved times.';action='details';label='Customer details';
    } else if(pending || conflict) {
      state='Callback result needs review';next='Review the retained callback request before another change.';action='callback';label='Review callback';
    } else if(booking.state==='invalid' || scheduled && !callTime) {
      state='Saved time needs review';next='Check the saved details before scheduling.';action=booking.state==='invalid'?'installation':'callback';label='Review saved time';
      if(booking.state==='invalid')when='Saved installation time unavailable.';
      if(scheduled && !callTime){console.error('Saved residential callback summary is invalid');when='Saved callback time unavailable.';}
    } else if(scheduled && Date.parse(saved.dueAt)<=Date.now()) {
      state=booking.state==='confirmed'?'Installation confirmed · Callback due':'Callback due';
      next='Call the homeowner.';action='call';label='Call customer';
    } else if(booking.state==='confirmed') {
      state='Installation confirmed';next='Use the confirmed installation window.';action='reschedule';label='Reschedule';
    } else if(booking.state==='tentative') {
      state='Installation on hold';when=`Hold: ${booking.window}`;next='Confirm the held time with the homeowner.';action='confirm';label='Confirm installation';
    } else if(booking.state==='completed') {
      state='Installation completed';when=`Completed: ${booking.window}`;next='No installation action is required.';action='installation-summary';label='View installation';
    } else if(booking.state==='cancelled' || booking.state==='expired') {
      state=booking.state==='cancelled'?'Installation cancelled':'Installation hold expired';
      next='Speak with the customer before booking a new time.';action='confirm';label='Book installation';
    } else if(scheduled) {
      state='Callback scheduled';next='Call at the saved callback time.';action='callback';label='Edit callback';
    } else if(workspace.reviewStatus==='approved') {
      state='Needs follow-up';next='Call to discuss the installation.';action='call';label='Call customer';
    } else {
      state='Another reviewer needed';next='Review the customer details.';action='details';label='Customer details';
    }
    if(authenticated && reservationDirty && !pending && !conflict) {
      next='Finish or discard the installation draft.';action='installation';label='Continue installation edit';
    } else if(authenticated && dirty && !pending && !conflict) {
      next='Finish or discard the callback draft.';action='callback';label='Continue callback edit';
    }
    byId('residential-operational-status').textContent=state;
    byId('residential-installation-time').textContent=when;
    byId('residential-next-action').textContent=next;
    const button=byId('residential-primary-action'),call=byId('residential-call'),primaryCall=byId('residential-primary-call');
    if(action==='call' && !call.hasAttribute('href')){action='details';label='Review phone number';}
    primaryCall.hidden=action!=='call';
    if(action==='call'){primaryCall.href=call.getAttribute('href');primaryCall.setAttribute('aria-label',`Call ${inquiry.name}`);}
    button.hidden=!action || action==='call';button.textContent=label;button.dataset.workspaceAction=action;
    button.disabled=reviewBusy || busy;
    byId('workspace-followup-section').hidden=!authenticated || workspace.reviewStatus!=='approved' || action==='callback';
    byId('workspace-reservation-section').hidden=!authenticated || workspace.reviewStatus!=='approved' || ['installation','reschedule','confirm'].includes(action);
    syncTask();
  }
  function initDates(root) {
    root.querySelectorAll('[data-workspace-date],input[data-workspace-instant],input[type="datetime-local"],input[type="date"]').forEach(input=>{
      if (input._flatpickr) return;
      if (!window.flatpickr) { status.textContent='Date picker unavailable. Reload before scheduling.';return; }
      const dayOnly=input.type==='date';
      const picker=window.flatpickr(input,{...window.h2sDatePopupOptions,enableTime:!dayOnly,dateFormat:dayOnly?'Y-m-d':'Y-m-d\\TH:i',
        altInput:true,altFormat:dayOnly?'M j, Y':'M j, Y, h:i K',enableSeconds:false,
        appendTo:taskDialog,disableMobile:true,allowInput:true,time_24hr:false,monthSelectorType:'static'});
      if(picker.altInput)picker.altInput.placeholder=dayOnly?'Choose a day':'Choose date and time';
    });
  }
  window.h2sInitDateInputs=initDates;
  const reservationRoot=byId('workspace-reservation');
  const dateObserver=new MutationObserver(records=>{
    records.forEach(record=>record.removedNodes.forEach(node=>{
      if(node.nodeType!==1)return;
      const inputs=[...(node.matches('input')?[node]:[]),...node.querySelectorAll('input')];
      inputs.forEach(input=>input._flatpickr?.destroy());
    }));
    if(reservationRoot.isConnected)initDates(reservationRoot);
    applyInstallationIntent();
    syncTask();
  });
  dateObserver.observe(reservationRoot,{childList:true,subtree:true});
  window.addEventListener('pagehide',()=>dateObserver.disconnect());
  function fillDraft() {
    const saved=pending || workspace.callback;
    callback.elements.callbackAction.value=pending?.action || 'schedule_callback';
    callback.elements.dueAt.value=localDate(saved.dueAt);
    callback.elements.dueAt.dataset.localValue=localDate(saved.dueAt).replace(' ','T');
    callback.elements.dueAt.dataset.instant=saved.dueAt || '';
    callback.elements.dueAt._flatpickr?.setDate(callback.elements.dueAt.value,false,'Y-m-d H:i');
    callback.elements.note.value=saved.note || '';
  }
  function controls() {
    const approved=workspace?.reviewStatus==='approved';
    callback.hidden=!approved;
    callback.querySelectorAll('input,textarea,select,button').forEach(element=>{element.disabled=busy || !!pending || conflict;});
    byId('workspace-callback-time-field').hidden=callback.elements.callbackAction.value!=='schedule_callback';
    byId('workspace-retry').hidden=!pending || conflict;
    byId('workspace-retry').disabled=busy;
    byId('workspace-discard').hidden=!dirty && !pending && !conflict;
    byId('workspace-discard').disabled=busy;
    byId('workspace-callback-recovery').hidden=!pending && !conflict;
    byId('workspace-approval').textContent=approved?'Follow-up accepted. Save a call time if needed, or set the agreed installation time below.':'Accept follow-up above before saving a call or installation time.';
    byId('workspace-approval').hidden=approved;
    byId('workspace-followup-section').hidden=!approved;
    byId('workspace-reservation-section').hidden=!approved;
    byId('workspace-callback-label').textContent=dirty?'Continue callback edit':workspace?.callback?.status==='scheduled'?'Edit callback':'Set callback';
    const state=bookingState(workspace?.booking);
    byId('workspace-installation-label').textContent=reservationDirty?'Continue installation edit':
      state==='confirmed'?'Reschedule':state==='tentative'?'Confirm or change hold':state==='completed'?'Book another installation':'Book installation';
    byId('workspace-installation-help').textContent=state==='completed'?'Use these options only when arranging another visit.':'';
    renderOverview();
  }
  function installationSummary() {
    const target=byId('residential-installation-time');
    const booking=workspace.booking;
    if(!booking){target.textContent='Installation not scheduled.';return {state:'none',window:''};}
    const state=bookingState(booking);
    const labels={confirmed:'Confirmed',tentative:'On hold - not confirmed',cancelled:'Cancelled',completed:'Completed',expired:'Hold expired - not booked'};
    if(!labels[state] || !Number.isFinite(Date.parse(booking.starts_at)) || !Number.isFinite(Date.parse(booking.ends_at)) || !booking.timezone) {
      console.error('Saved residential installation summary is invalid');
      target.textContent='Saved installation time is unavailable. Check the calendar before scheduling.';return {state:'invalid',window:''};
    }
    let format;
    try {format=new Intl.DateTimeFormat('en-US',{timeZone:booking.timezone,month:'short',day:'numeric',
      hour:'numeric',minute:'2-digit',timeZoneName:'short'});}
    catch(error) {
      console.error('Saved residential installation time zone is invalid',error);
      target.textContent='Saved installation time is unavailable. Check the calendar before scheduling.';return {state:'invalid',window:''};
    }
    const window=format.formatRange(new Date(booking.starts_at),new Date(booking.ends_at));
    target.textContent=`${labels[state]}: ${window}.`;
    return {state,window};
  }
  function renderNotices() {
    const names={owner_callback:'Staff call reminder',owner_installation:'Staff installation reminder',
      customer_confirmation:'Customer confirmation',customer_installation:'Customer installation reminder',customer_cancellation:'Customer cancellation'};
    const states={pending:'Scheduled',accepted:'Accepted by text provider; delivery not confirmed',review_required:'Needs staff review - do not resend automatically',
      superseded:'Replaced - will not send',expired:'Not sent - the time passed',skipped:'Not sent - customer texting permission unavailable'};
    const notices=workspace.notices || [],list=byId('workspace-notices');
    list.replaceChildren();
    for(const notice of notices) {
      const item=document.createElement('li');
      item.textContent=`${names[notice.kind] || notice.kind}: ${states[notice.state] || notice.state}${notice.state==='pending' && notice.due_at?` · ${callbackTime(notice.due_at) || 'Reminder time unavailable'}`:''}`;
      list.append(item);
    }
    if(!notices.length){const item=document.createElement('li');item.textContent='No text updates yet.';list.append(item);}
    const needsReview=notices.some(notice=>notice.state==='review_required' || notice.details?.persistenceError);
    byId('workspace-notice-warning').textContent=needsReview?'A text needs staff review before another send. Open View history.':'';
    const latest=notices.find(notice=>notice.kind.startsWith('customer_') && notice.state!=='superseded')
      || notices.find(notice=>notice.state!=='superseded');
    const scheduled=notices.filter(notice=>notice.state==='pending').length;
    byId('workspace-text-summary').hidden=needsReview;
    byId('workspace-text-summary').textContent=latest
      ?`${names[latest.kind] || latest.kind}: ${states[latest.state] || latest.state}.${scheduled?` ${scheduled} reminder${scheduled===1?'':'s'} scheduled.`:''}`
      :'No text updates yet.';
  }
  function render() {
    login.hidden=true;panel.hidden=false;byId('workspace-account-switch').hidden=true;
    byId('workspace-login-explanation').hidden=true;scheduleError=false;
    byId('workspace-context').textContent='Signed in to the dashboard on this device.';
    const saved=workspace.callback;
    const calls={none:'No follow-up call scheduled',scheduled:'Call scheduled',completed:'Call completed',cancelled:'Planned call cancelled'};
    byId('workspace-saved').textContent=`${calls[saved.status] || saved.status}${saved.dueAt?` · ${callbackTime(saved.dueAt) || 'Saved time unavailable'}`:''}${saved.note?` · ${saved.note}`:''}`;
    renderNotices();
    if (!dirty && !pending && !conflict) fillDraft();
    controls();initDates(callback);
    const calendar=window.H2SCommercialCalendar;
    if (!calendar) { status.textContent='Saved workspace loaded. Shared calendar unavailable; reload before reserving time.';return; }
    const options={apiBase:'',getToken:()=>accessDenied?'':session,onAuthError:authError,focused:true};
    if (!byId('commercialCalendar').childNodes.length) {
      calendar.mountDashboard(byId('commercialCalendar'),{...options,openLabel:'Check reservation',onOpenLead:leadId=>{
        byId('workspace-calendar-context').textContent=leadId===workspace.leadId?
          "This is the current customer's reservation. Choose Installation to review it.":
          'That time is reserved for another customer. This customer remains selected.';
      }});
    }
    if (workspace.reviewStatus==='approved' && mountedLead!==workspace.leadId) {
      mountedLead=workspace.leadId;
      calendar.mountLead(byId('workspace-reservation'),workspace.leadId,{...options,
        historyRoot:byId('workspace-calendar-history'),onStateChange:syncTask,defaultAction:'confirm',
        dateInput:(name,label,instant,attrs='')=>`<label class="residential-field">${escape(label)}<input type="datetime-local" data-workspace-instant name="${escape(name)}" value="${escape(localDate(instant).replace(' ','T'))}" data-local-value="${escape(localDate(instant).replace(' ','T'))}" data-instant="${escape(instant)}" ${attrs}></label>`,
        instantValue,
        onDirty:value=>{reservationDirty=value;byId('workspace-reservation-dirty').textContent=value?'Installation changes are not saved yet.':'';controls();},
        onActivity:result=>{
          generation++;
          if(result?.booking){workspace.booking={...result.booking,effective_state:result.booking.state};renderOverview();}
          if(result) {
            byId('workspace-calendar-message').textContent=result.message+(result.historyLoaded?'':' Latest history could not be reloaded.');
            byId('workspace-calendar-result').textContent=!result.historyLoaded || result.notifications?.needsReview
              ?'Installation saved. Notification or history status needs review; open View history.'
              :result.notifications?.enabled===false?'Installation saved. Automatic text updates are disabled.':'Installation saved.';
          }
          load(true);calendar.refreshDashboard?.();
          if(activeTask==='installation')finishTask();
        }});
    }
  }
  async function load(afterMutation=false) {
    if (!session || !reviewToken || accessDenied) return;
    if(loading){if(afterMutation)reloadQueued=true;return;}
    const version=generation;loading=true;
    status.textContent='Loading saved call and installation times...';
    try {
      const result=await request(`/api/residential-workspace?token=${encodeURIComponent(reviewToken)}`);
      if (version!==generation) return;
      workspace=result.workspace;
      if (!workspace || !workspace.leadId || !workspace.callback) throw new Error('Saved workspace is unavailable.');
      if (!pending) {
        const raw=stored('sessionStorage',retryKey());
        if (raw) {
          try {
            const value=JSON.parse(raw);
            if (typeof value.operationId==='string' && ['schedule_callback','complete_callback','cancel_callback'].includes(value.action)
                && Number.isInteger(value.revision) && typeof value.note==='string') {
              pending={operationId:value.operationId,action:value.action,revision:value.revision,note:value.note,
                ...(value.action==='schedule_callback'?{dueAt:value.dueAt}:{})};
              dirty=true;fillDraft();
            }
          } catch (_) { /* An invalid local retry is not submitted. */ }
        }
      }
      render();
      status.textContent=conflict?'The saved callback changed elsewhere. Your draft is still here; discard it to use the latest saved details.':
        pending?'Unconfirmed callback request retained. Retry unchanged or explicitly discard and reload latest.':
        dirty || reservationDirty?'Latest saved details checked. Unsaved drafts are retained.':'';
    } catch(error) {
      if(!error.auth && version===generation) {
        scheduleError=true;status.textContent=`Unable to load saved times: ${error.message}`;renderOverview();
      }
    } finally {
      loading=false;
      if(reloadQueued){reloadQueued=false;load();}
    }
  }
  async function sendPending() {
    if (!pending || busy || !session) return;
    busy=true;controls();status.textContent='Recording callback...';
    const version=generation;
    try {
      const result=await request('/api/residential-workspace',{...pending,token:reviewToken});
      if(version!==generation)return;
      generation++;workspace=result.workspace;pending=null;dirty=false;conflict=false;persistPending();render();
      status.textContent='Callback saved.';
      if(activeTask==='callback')finishTask();
    } catch(error) {
      if(error.auth)return;
      if (error.status===409) {
        conflict=true;status.textContent='Saved callback changed elsewhere. Your draft is retained. Discard it to use the latest saved details.';
        await load();
      } else if (error.status>=400 && error.status<500) {
        pending=null;persistPending();status.textContent=`Callback not saved: ${error.message} Your draft is retained.`;
      } else status.textContent='Callback result is uncertain. Keep this page open. Retry the unchanged request, or explicitly discard and reload latest before another action.';
    } finally { busy=false;controls(); }
  }
  callback.oninput=callback.onchange=()=>{dirty=true;controls();};
  callback.onsubmit=event=>{
    event.preventDefault();if (busy || pending || conflict || workspace?.reviewStatus!=='approved')return;
    const action=event.submitter?.value, note=callback.elements.note.value.trim();
    if (!['schedule_callback','complete_callback','cancel_callback'].includes(action) || !note || note.length>1000) {
      status.textContent='Enter a callback note (1–1000 characters).';return;
    }
    let dueAt;
    if (action==='schedule_callback') {
      try { dueAt=instantValue(callback,'dueAt'); }
      catch(error) {status.textContent=error.message;return;}
      if (!dueAt || new Date(dueAt).getTime()<=Date.now()) {
        status.textContent='Choose a valid future callback time in your local time zone.';return;
      }
    }
    pending={revision:workspace.callback.revision,operationId:crypto.randomUUID(),action,note,...(dueAt?{dueAt}:{})};
    persistPending();sendPending();
  };
  login.onsubmit=async event=>{
    event.preventDefault();
    const button=login.querySelector('button');if(button.disabled)return;
    button.disabled=true;status.textContent='Signing in...';
    const pin=login.elements.pin.value;login.elements.pin.value='';
    try {
      const result=await request('/api/v1?action=dashboardLogin',{username:login.elements.username.value.trim(),pin,device:'residential-review'},false);
      if(typeof result.dashboardLogin?.token!=='string' || !result.dashboardLogin.token) {
        throw new Error('Dashboard sign-in returned no session. Scheduling was not opened.');
      }
      session=result.dashboardLogin.token;stored('localStorage',sessionKey,session);generation++;accessDenied=false;
      await load();
      if(hasWorkspace() && activeTask==='account'){const next=afterLogin;afterLogin='';if(next)showTask(next);else finishTask();}
    } catch(error) { status.textContent=`Unable to sign in: ${error.message}`; }
    finally { button.disabled=false; }
  };
  window.addEventListener('focus',()=>{if(!busy)load();});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible' && !busy)load();});
  byId('workspace-account-switch').onclick=()=>{login.hidden=false;byId('workspace-login-explanation').hidden=false;byId('workspace-account-switch').hidden=true;requestTask('account');};
  byId('workspace-retry').onclick=()=>sendPending();
  byId('workspace-discard').onclick=()=>{
    pending=null;dirty=false;conflict=false;persistPending();load();
  };
  byId('workspace-signout').onclick=()=>signedOut();
  byId('residential-primary-action').onclick=event=>{
    const action=event.currentTarget.dataset.workspaceAction;
    if(action==='review') {
      const form=byId('residential-review-form');form.requestSubmit(form.querySelector('[value=approve]'));
    } else if(action==='login')requestTask('account');
    else if(action==='switch')byId('workspace-account-switch').click();
    else if(action==='details')reveal('residential-customer-details');
    else if(action==='callback')requestTask('callback');
    else if(action==='installation-summary')requestTask('history');
    else if(['installation','reschedule','confirm'].includes(action)) {
      requestTask('installation',action==='reschedule'?'reschedule':action==='confirm'?'confirm':'');
    }
  };
  document.querySelectorAll('[data-workspace-task]').forEach(button=>{button.onclick=()=>requestTask(button.dataset.workspaceTask);});
  byId('workspace-task-cancel').onclick=()=>requestTask();
  taskDialog.addEventListener('cancel',event=>{event.preventDefault();requestTask();});
  byId('workspace-task-keep').onclick=()=>{
    exitTarget=null;byId('workspace-task-exit').hidden=true;byId('workspace-task-body').hidden=false;
    taskDialog.querySelector('footer').hidden=false;syncTask();byId('workspace-task-title').focus();
  };
  byId('workspace-task-discard').onclick=async()=>{
    const target=exitTarget;if(!target)return;
    if(activeTask==='callback') {
      pending=null;dirty=false;conflict=false;persistPending();callback.elements.callbackAction.value='schedule_callback';fillDraft();
    } else if(activeTask==='installation') {
      if(!window.H2SCommercialCalendar?.discardLead?.(reservationRoot)){status.textContent='Installation changes could not be discarded. Check the saved state before continuing.';return;}
    } else if(activeTask==='review') {byId('residential-review-form').reset();reviewDirty=false;}
    exitTarget=null;byId('workspace-task-exit').hidden=true;byId('workspace-task-body').hidden=false;taskDialog.querySelector('footer').hidden=false;
    controls();
    if(target.task)showTask(target.task,target.intent);else finishTask();
    if(activeTask!=='review')load(true);
  };
  byId('workspace-task-save').onclick=()=>{
    if(activeTask==='callback')callback.requestSubmit(callback.querySelector(`button[value="${callback.elements.callbackAction.value}"]`));
    else if(activeTask==='installation')reservationRoot.querySelector('[data-calendar-form]')?.requestSubmit();
  };
  byId('residential-review-form').addEventListener('input',()=>{reviewDirty=true;});
  const statusObserver=new MutationObserver(syncTask);
  [status,byId('residential-review-status')].forEach(element=>statusObserver.observe(element,{childList:true,subtree:true,characterData:true}));
  window.addEventListener('pagehide',()=>statusObserver.disconnect());
  setInterval(()=>{if(!document.hidden && hasWorkspace())renderOverview();},60000);
  window.addEventListener('beforeunload',event=>{
    if(dirty || pending || reservationDirty || reviewDirty || calendarState().saving || busy || reviewBusy) {event.preventDefault();event.returnValue='';}
  });
  window.H2SResidentialWorkspace={
    setInquiry(value){
      inquiry=value;login.hidden=!!session;byId('workspace-login-explanation').hidden=!!session;renderOverview();if(session)load();
    },
    setReviewStatus(value){reviewDirty=false;if(inquiry)inquiry.status=value;if(workspace)workspace.reviewStatus=value;renderOverview();if(activeTask==='review')finishTask();if(session)load(true);},
    setReviewBusy(value){reviewBusy=value;renderOverview();}
  };
})();

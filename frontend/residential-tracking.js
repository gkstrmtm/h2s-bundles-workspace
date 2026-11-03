(function (root) {
  'use strict';
  const key = 'h2s:residential:tracking:v1', timeout = 30 * 60 * 1000;
  const fields = ['utm_source','utm_medium','utm_campaign','utm_content','utm_term'];
  const token = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/;
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
  function create(win) {
    const warn = error => win.console.warn('[Residential tracking]', error);
    const tags = {};
    for (const field of fields) {
      const value = new win.URL(win.location.href).searchParams.get(field);
      if (value !== null) {
        if (token.test(value)) tags[field] = value;
        else warn(`Ignored invalid ${field}; use 1-100 letters, digits, underscores, dots or hyphens.`);
      }
    }
    let state;
    try {
      const raw = win.sessionStorage.getItem(key);
      if (raw) {
        const saved = JSON.parse(raw);
        if (!saved || !uuid.test(saved.visitor_id) || !uuid.test(saved.session_id)
          || !Number.isFinite(saved.expiresAt) || !saved.tags || !saved.events
          || typeof saved.tags !== 'object' || typeof saved.events !== 'object'
          || Array.isArray(saved.tags) || Array.isArray(saved.events)
          || Object.entries(saved.tags).some(([field,value]) => !fields.includes(field) || typeof value !== 'string' || !token.test(value))
          || Object.values(saved.events).some(event => !event || !uuid.test(event.id) || typeof event.sent !== 'boolean')) {
          throw new Error('Stored campaign session is invalid; starting a new tracking session.');
        }
        if (saved.expiresAt > Date.now()) state = saved;
      }
    } catch (error) { warn(error); }
    if (!state) {
      let visitor;
      try {
        visitor = win.localStorage.getItem('h2s_visitor_id');
        if (!uuid.test(visitor || '')) {
          visitor = win.crypto.randomUUID();
          win.localStorage.setItem('h2s_visitor_id', visitor);
        }
      } catch (error) { warn(error); visitor = win.crypto.randomUUID(); }
      state = {visitor_id:visitor,session_id:win.crypto.randomUUID(),expiresAt:0,tags:{},events:{}};
    }
    if (Object.keys(tags).length) state.tags = tags;
    function save() {
      state.expiresAt = Date.now() + timeout;
      try { win.sessionStorage.setItem(key, JSON.stringify(state)); }
      catch (error) { warn(error); }
    }
    save();
    const attribution = () => ({...state.tags,visitor_id:state.visitor_id,session_id:state.session_id});
    async function send(type, logicalId) {
      const eventKey = `${type}:${logicalId}`;
      const event = state.events[eventKey] ||= {id:win.crypto.randomUUID(),sent:false};
      if (event.sent) return;
      save();
      const controller = new win.AbortController(), timer = win.setTimeout(() => controller.abort(), 5000);
      try {
        const response = await win.fetch('/api/track', {method:'POST',cache:'no-store',keepalive:true,signal:controller.signal,
          headers:{'Content-Type':'application/json'},body:JSON.stringify({
            ...attribution(),event_id:event.id,event_type:type,page_path:'/residential',
            occurred_at:new Date().toISOString(),metadata:{page_type:'residential_intake',form_name:'residential_inquiry'},
          })});
        const result = await response.json();
        if (!response.ok || !result.ok || result.ignored) throw new Error(`Tracking was not recorded: ${result.reason || result.code || response.status}`);
        event.sent = true; save();
      } catch (error) { warn(error); }
      finally { win.clearTimeout(timer); }
    }
    return {
      attribution,
      pageView: () => send('page_view', JSON.stringify(state.tags)),
      lead: id => send('lead', id),
    };
  }
  root.H2SResidentialTracking = {create};
  if (typeof module !== 'undefined' && module.exports) module.exports = {create};
})(typeof window !== 'undefined' ? window : globalThis);

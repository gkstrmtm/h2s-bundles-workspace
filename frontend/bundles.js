console.log("[BUILD_ID]", "SHA-VERIFY-002", "2026-01-13 17:34:00", location.href);
console.log('SHOP VERSION: 2026-01-18-222559');
// PS PATCH: Signal bundles.js execution -- start
if(window.__H2S_BUNDLES_START) window.__H2S_BUNDLES_START();
// PS PATCH: Signal bundles.js execution -- end

performance.mark('ss_bundles_first_line');
performance.mark('ss_entry');
// PERFORMANCE: defer attribute allows HTML parsing to continue
// Script executes after DOM is ready but doesn't block initial paint
'use strict';

// BUILD FINGERPRINT - Always logs to prove which version is running
window.__H2S_BUNDLES_BUILD = "BUILD-VERIFY-001";
console.log('[BUILD]', window.__H2S_BUNDLES_BUILD);
document.documentElement.setAttribute('data-build', window.__H2S_BUNDLES_BUILD); // Hidden attribute for verification

// Production-safe logger - only logs in development
const isDev = window.location.hostname === 'localhost' || window.location.hostname.includes('127.0.0.1') || window.location.hostname.includes('vercel.app');
const logger = {
  log: isDev ? console.log.bind(console) : () => {},
  warn: isDev ? console.warn.bind(console) : () => {},
  error: console.error.bind(console) // Always log errors
};

logger.log('[BundlesJS] Script loaded and executing');
performance.mark('ss_init_start');

// === SUCCESS PAGE DETECTION ===
// Detect success view early to trigger immediate routing (no early render attempt)
if (typeof URLSearchParams !== 'undefined' && (new URLSearchParams(window.location.search).has('shopsuccess') || window.location.search.includes('view=shopsuccess'))) {
    console.log('[FastRoute] Success page detected - will route immediately after init');
    window.__IS_SUCCESS_PAGE = true;
}
// === END DETECTION ===

function byId(id){ return document.getElementById(id); }

// === UTILITY FUNCTIONS ===
function money(cents) {
  if(typeof cents === 'number') {
    return '$' + cents.toFixed(2);
  }
  return '$0.00';
}

function escapeHtml(text) {
  if(!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// === API CONFIG ===
// NEW: Single aggregated endpoint (eliminates waterfall loading)
const BUNDLES_DATA_API = 'https://h2s-backend.vercel.app/api/bundles-data';
const API = 'https://h2s-backend.vercel.app/api/shop';
// MIGRATED: Booking now goes to Vercel (native scheduling)
const APIV1 = 'https://h2s-backend.vercel.app/api/schedule-appointment';
// MIGRATED: Analytics now goes to Vercel (was GAS DASH_URL)
const DASH_URL = 'https://h2s-backend.vercel.app/api/track';
const CAL_FORM_URL = 'https://api.leadconnectorhq.com/widget/booking/RjwOQacM3FAjRNCfm6uU';
const PIXEL_ID = '2384221445259822';
// Removed Meta Test Events verification code for production
const TEST_EVENT_CODE = null;

// Local dev detection (VS Code Live Preview / localhost)
const IS_LOCAL = (location.hostname === '127.0.0.1' || location.hostname === 'localhost');

// Expose endpoints globally for consistency with shared snippets
window.H2S_TRACKING_ENDPOINT = DASH_URL;
window.H2S_META_ENDPOINT = DASH_URL;

// === PERFORMANCE: Start Data Fetch Immediately ===
// RE-ENABLED: bundles-data endpoint now live on h2s-backend.vercel.app
const bundlesFetchPromise = IS_LOCAL
  ? Promise.resolve(null)
  : fetch(BUNDLES_DATA_API, { 
      cache: 'default',
      headers: { 'Accept': 'application/json' },
      priority: 'high',
      credentials: 'omit'
    }).then(res => {
      if (!res.ok) {
        logger.warn('[Bundles] API returned', res.status, '- using fallback');
        return null;
      }
      return res.json();
    }).catch(err => {
      logger.warn('[Bundles] Aggregated fetch failed, will fallback:', err);
      return null;
    });

// Session ID for tracking (uses localStorage from h2sSendBackend for consistency)
// This variable is for local reference only - actual tracking uses localStorage IDs
let SESSION_ID = localStorage.getItem('h2s_session_id');
if(!SESSION_ID){
  // Use same uuidv4Fallback function defined above for consistency
  SESSION_ID = (crypto && crypto.randomUUID) ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
  localStorage.setItem('h2s_session_id', SESSION_ID);
}

// Tracking verification - add ?debug=tracking to URL to see real-time tracking status
function showTrackingDebugPanel(){
  const panel = document.createElement('div');
  panel.id = 'trackingDebugPanel';
  panel.style.cssText = 'position:fixed;bottom:16px;right:16px;background:#0a2a5a;color:#fff;padding:16px;border-radius:12px;font-family:monospace;font-size:12px;max-width:400px;max-height:500px;overflow:auto;z-index:99999;box-shadow:0 8px 24px rgba(0,0,0,0.3);';
  panel.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
      <strong style="font-size:14px;">📊 Tracking Monitor</strong>
      <button onclick="this.parentElement.parentElement.remove()" style="background:rgba(255,255,255,0.2);border:none;color:#fff;padding:4px 8px;border-radius:4px;cursor:pointer;font-size:11px;">Close</button>
    </div>
    <div style="margin-bottom:8px;"><strong>Session:</strong><br/><span style="font-size:10px;opacity:0.8;word-break:break-all;">${SESSION_ID}</span></div>
    <div style="margin-bottom:8px;"><strong>Meta Pixel:</strong> <span id="pixelStatus">Checking...</span></div>
    <div style="margin-bottom:8px;"><strong>Backend API:</strong> <span id="backendStatus">Checking...</span></div>
    <div style="margin-bottom:8px;"><strong>Events Sent:</strong> <span id="eventCount">0</span></div>
    <div style="margin-top:12px;padding-top:12px;border-top:1px solid rgba(255,255,255,0.2);">
      <button onclick="testH2STracking()" style="width:100%;background:#1493ff;border:none;color:#fff;padding:8px;border-radius:6px;cursor:pointer;font-weight:600;font-size:12px;margin-bottom:8px;">🧪 Test Tracking</button>
      <a href="https://business.facebook.com/events_manager2/list/pixel/" target="_blank" style="display:block;text-align:center;padding:6px;background:rgba(255,255,255,0.1);border-radius:6px;color:#fff;text-decoration:none;font-size:11px;">View Meta Events Manager ↗</a>
    </div>
    <div id="recentEvents" style="margin-top:12px;padding-top:12px;border-top:1px solid rgba(255,255,255,0.2);font-size:10px;max-height:200px;overflow:auto;"></div>
  `;
  document.body.appendChild(panel);
  
  // Check Meta Pixel
  const pixelStatus = document.getElementById('pixelStatus');
  if(typeof fbq !== 'undefined'){
    pixelStatus.innerHTML = '<span style="color:#10b981;">✅ Active</span>';
  } else {
    pixelStatus.innerHTML = '<span style="color:#ef4444;">❌ Not Loaded</span>';
  }
  
  // Test backend
  const backendStatus = document.getElementById('backendStatus');
  fetch('https://h2s-backend.vercel.app/api/stats', {credentials: 'omit', cache: 'no-store'})
    .then(res => {
      backendStatus.innerHTML = res.ok ? '<span style="color:#10b981;">✅ Online</span>' : '<span style="color:#f59e0b;">⚠️ HTTP ' + res.status + '</span>';
    })
    .catch(() => {
      backendStatus.innerHTML = '<span style="color:#ef4444;">❌ Offline</span>';
    });
  
  // Monitor tracking calls
  window._trackingDebugCount = 0;
  const originalH2STrack = window.h2sTrack || h2sTrack;
  window.h2sTrack = function(...args){
    window._trackingDebugCount++;
    document.getElementById('eventCount').textContent = window._trackingDebugCount;
    const recentEvents = document.getElementById('recentEvents');
    const eventDiv = document.createElement('div');
    eventDiv.style.cssText = 'padding:6px 8px;margin-bottom:4px;opacity:0.9;background:rgba(255,255,255,0.05);border-radius:4px;border-left:3px solid #10b981;';
    eventDiv.innerHTML = '<div style="font-weight:600;margin-bottom:2px;">' + args[0] + '</div><div style="opacity:0.7;font-size:9px;">' + new Date().toLocaleTimeString() + '</div>';
    recentEvents.insertBefore(eventDiv, recentEvents.firstChild);
    if(recentEvents.children.length > 8) recentEvents.lastChild.remove();
    return originalH2STrack.apply(this, args);
  };
}

function testH2STracking(){
  // Silent test - logs removed for production performance
  
  h2sTrack('DebugTest', { 
    source: 'debug_panel', 
    test: true,
    timestamp: new Date().toISOString(),
    page: 'bundles'
  });
  
  setTimeout(() => {
    alert('✅ Test event fired!\n\n1. Open browser console (F12) to see detailed logs\n2. Look for "📊 [H2S Track]" and "✅ Backend response"\n3. Check your database/sheet for the event\n\nIf you see "❌ Backend unavailable" in console, there\'s a timing issue.');
  }, 500);
}

// === STATE ===
let catalog = { services:[], serviceOptions:[], priceTiers:[], bundles:[], bundleItems:[], recommendations:[], memberships:[], membershipPrices:[] };
let allReviews = []; // Global reviews store
let heroReviews = []; // Global hero reviews store
let reviewsLoadedFromAPI = false;
let reviewIndex = 0; // Track current carousel page for review section
let cart = loadCart();
let user = loadUser();
let lastSearch = '';
let lastCat = '';

// === BUNDLES DEFERRED LOADER (Checkout, Success, Auth) ===
let _bundlesDeferredPromise = null;
function loadBundlesDeferred(){
  if(_bundlesDeferredPromise) return _bundlesDeferredPromise;
  _bundlesDeferredPromise = new Promise((resolve, reject)=>{
    const s = document.createElement('script');
    // Versioned to prevent stale 404s
    s.src = '/bundles-deferred.js?v=' + (window.__H2S_BUNDLES_BUILD || Date.now()); 
    s.onload = resolve;
    s.onerror = reject;
    document.body.appendChild(s);
  });
  return _bundlesDeferredPromise;
}
function queueRenderRecsPanel(){
  if(window._queuedRecs) return; // collapse bursts
  window._queuedRecs = true;
  const invoke = ()=> loadBundlesDeferred().then(()=>{
    if(window.renderRecsPanel) window.renderRecsPanel();
    window._queuedRecs = false;
  }).catch(err => {
    console.warn('[Recommendations] Failed to load, skipping');
    window._queuedRecs = false;
  });
  if('requestIdleCallback' in window){
    requestIdleCallback(invoke, {timeout:3000});
  } else {
    setTimeout(invoke, 1500);
  }
}

// === LOADER ===
function buildLoader(){
  const slices = byId('h2sLoaderSlices');
  if(!slices) return;
  const c1 = '#1493ff', c2 = '#0a2a5a', c3 = '#6b778c';
  const colors = [c1, c2, c3, c1, c2, c3, c1, c2];
  slices.innerHTML = colors.map((col, i)=>`<div class="h2s-loader-slice" style="background:${col};animation-delay:${i*0.05}s"></div>`).join('');
}
function showLoader(){ 
  const el=byId('h2s-loader'); 
  if(el){ 
    el.classList.remove('hidden');
    el.style.display=''; 
  } 
}
function hideLoader(){ 
  const el=byId('h2s-loader'); 
  if(el){ 
    el.classList.add('hidden');
    // Remove from DOM after transition
    setTimeout(() => { if(el.classList.contains('hidden')) el.style.display='none'; }, 400);
  } 
}

// Show skeleton loading state while content loads
function showSkeleton(){
  byId('outlet').innerHTML = `
    <div class="skeleton skeleton-hero"></div>
    <div class="skeleton skeleton-trust"></div>
    <div class="skeleton-grid">
      <div class="skeleton skeleton-card"></div>
      <div class="skeleton skeleton-card"></div>
      <div class="skeleton skeleton-card"></div>
      <div class="skeleton skeleton-card"></div>
      <div class="skeleton skeleton-card"></div>
      <div class="skeleton skeleton-card"></div>
    </div>
  `;
}

// === META PIXEL + TRACKING ===
// Use the global h2sSendBackend helper (defined at top of page) for backend tracking
// This ensures proper visitor_id and session_id are always included
function h2sTrack(event, data={}){
  
  // Send to Meta Pixel with readiness guard to avoid early warnings
  (function sendPixel(){
    if (typeof fbq === 'function' && window.__H2S_FB_INIT__) {
      try {
        const params = buildAdvancedParams();
        const eventData = { ...data };
        fbq('track', event, eventData, params);
      } catch (e) {
        console.warn('⚠️ [Meta Pixel] send failed:', e);
      }
    } else {
      // Retry briefly until fbq is ready, then send
      let tries = 0;
      const maxTries = 20; // ~3s at 150ms
      const timer = setInterval(()=>{
        if (typeof fbq === 'function' && window.__H2S_FB_INIT__) {
          clearInterval(timer);
          try {
            const params = buildAdvancedParams();
            const eventData = { ...data };
            fbq('track', event, eventData, params);
          } catch(e){ console.warn('⚠️ [Meta Pixel] delayed send failed:', e); }
        } else if (++tries >= maxTries) {
          clearInterval(timer);
          console.warn('⚠️ [Meta Pixel] fbq not loaded; skipping send:', event);
        }
      }, 150);
    }
  })();
  
  // Send to backend with retry logic for timing issues
  function sendToBackend(attempt = 1) {
    if (window.h2sSendBackend && typeof window.h2sSendBackend === 'function') {
      // Backend is available, send immediately
      const event_type = event.toLowerCase().replace(/([A-Z])/g, '_$1').replace(/^_/, '');
      const trackingData = {
        ...data,
        user_email: user?.email || '',
        timestamp: new Date().toISOString()
      };
      try {
        const result = window.h2sSendBackend(event_type, trackingData);
        // Only await if it returns a promise
        if (result && typeof result.catch === 'function') {
          result.catch(() => {});
        }
      } catch(err) {
        // Silent fail
      }
    } else if (attempt <= 5) {
      // Backend not ready yet, retry after delay
      setTimeout(() => sendToBackend(attempt + 1), attempt * 100);
    }
  }
  
  // Start sending
  sendToBackend();
}

// NOTE: Dispatch job creation happens server-side:
// - A `pending_assign` dispatch job is created when the order row is written.
// - Scheduling updates the existing job to `scheduled`.

async function sha256(text){
  if(!crypto || !crypto.subtle) return '';
  try{
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }catch(_){ return ''; }
}

function buildAdvancedParams(){
  const params = {};
  if(user && user.email){
    sha256(user.email.trim().toLowerCase()).then(h => { if(h) params.em = h; });
    if(user.phone){
      const digits = user.phone.replace(/\D/g,'');
      sha256(digits).then(h => { if(h) params.ph = h; });
    }
    if(user.name){
      const parts = user.name.trim().toLowerCase().split(' ');
      if(parts[0]) sha256(parts[0]).then(h => { if(h) params.fn = h; });
      if(parts[parts.length-1]) sha256(parts[parts.length-1]).then(h => { if(h) params.ln = h; });
    }
  }
  return params;
}

// === HOISTED RENDERER FUNCTIONS (NEVER IN TDZ) ===
// These function declarations are hoisted, so they exist before any code runs

function renderFatal(message) {
  const outlet = byId('outlet');
  if(!outlet) return;
  
  outlet.innerHTML = `
    <div style="padding:60px 20px;text-align:center;max-width:600px;margin:0 auto;font-family:sans-serif;">
      <div style="width:64px;height:64px;background:#dc2626;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 24px;">
        <span style="color:white;font-size:32px;font-weight:bold;">!</span>
      </div>
      <h2 style="margin:0 0 16px 0;font-weight:900;font-size:24px;color:#dc2626;">Something Went Wrong</h2>
      <p style="margin:0 0 24px 0;color:#64748b;font-size:16px;">${escapeHtml(message)}</p>
      <a href="/bundles" style="display:inline-block;padding:12px 24px;background:#2563eb;color:white;border-radius:8px;text-decoration:none;font-weight:700;">Return to Shop</a>
      <p style="margin-top:24px;font-size:14px;color:#94a3b8;">Need help? Call <a href="tel:864-528-1475" style="color:#2563eb;">(864) 528-1475</a></p>
    </div>
  `;
  outlet.style.opacity = '1';
  outlet.style.visibility = 'visible';
}

function renderShopView() {
  const outlet = byId('outlet');
  if(!outlet) return;
  
  // FIX: Do not wipe static content (Hero, etc) while waiting for catalog
  // Only show loading if the outlet is drastically empty
  if(!catalog || !catalog.bundles || catalog.bundles.length === 0) {
    if(!outlet.children.length && outlet.innerHTML.trim().length < 50) {
        outlet.innerHTML = '<div style="padding:40px;text-align:center;">Loading shop...</div>';
    }
    return;
  }
  
  logger.log('[ROUTE] Shop view active');
}






async function renderShopSuccessView() {
  /* NEW APPROACH: Static HTML already exists in DOM, just hydrate data */
  if(window.__H2S_BOOT) window.__H2S_BOOT.events.push({
    t: performance.now(), 
    msg: 'SUCCESS_HYDRATION_START'
  });
  
  console.log('[SUCCESS] Hydrating static success page');
  
  const params = new URLSearchParams(window.location.search);
  const sessionId = params.get('session_id') || params.get('stripe_session_id') || '';
  
  // Hydrate immediately - no delays, no animation frames
  if (sessionId) {
    loadCalendarInteractive(params, sessionId);
    
    // Fetch order data for hydration
    const cacheKey = `h2s_order_${sessionId}`;
    const cached = sessionStorage.getItem(cacheKey);

    const useOrder = (order) => {
      const orderIdEl = byId('orderId');
      if(orderIdEl) orderIdEl.innerHTML = `<span style="font-family:monospace;font-size:17px;">${order.order_id ? order.order_id.slice(0,18) : sessionId.slice(0,18).toUpperCase()}</span>`;
      const totalEl = byId('orderTotal');
      if(totalEl) totalEl.innerHTML = `<span style="color:#059669;">${order.order_total?.includes('PAID') ? 'PAID' : (money(order.amount_total||order.order_total||0))}</span>`;
      const itemsEl = byId('orderItems');
      if(itemsEl) itemsEl.textContent = order.order_summary || order.service_name || 'Home2Smart Bundle Service';
      window.__currentOrderData = order;
    };

    if (cached) {
      try {
        const cachedData = JSON.parse(cached);
        if (cachedData && cachedData._timestamp && (Date.now() - cachedData._timestamp < 300000)) {
          useOrder(cachedData);
          return;
        }
      } catch(_e) {}
    }

    (async () => {
      try {
        const c = new AbortController();
        setTimeout(()=>c.abort(), 6000);
        const res = await fetch(`https://h2s-backend.vercel.app/api/get-order-details?session_id=${sessionId}`, { signal: c.signal });
        if(!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const order = data.order || data;
        order._timestamp = Date.now();
        sessionStorage.setItem(cacheKey, JSON.stringify(order));
        useOrder(order);
      } catch(_err) {
        useOrder({ fallback: true, order_id: sessionId, order_total: 'PAID', order_summary: 'Home2Smart Service' });
      }
    })();
  }
}

function loadCalendarInteractive(params, sessionId) {
  const widget = byId('calendarWidget');
  if(!widget) return;
  
  // Reset Global State for Fresh Selection
  window.selectedDate = null;
  window.selectedWindow = null;
  window.__sessionId = sessionId;

  const mockAvail = [];
  const today = new Date();
  // Generate 60 days of availability
  for(let i=0; i<60; i++){
      const d = new Date(today); d.setDate(today.getDate()+i);
      mockAvail.push({date:d.toISOString().split('T')[0]}); 
  }

  const render = (offset=0) => {
    const now = new Date();
    const target = new Date(now.getFullYear(), now.getMonth()+offset, 1);
    const monthName = target.toLocaleString('default',{month:'long'});
    const daysInMonth = new Date(target.getFullYear(), target.getMonth()+1, 0).getDate();
    const startDay = target.getDay(); 
    
    let html = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
         <button id="prevCal" style="border:none; background:none; font-size:20px; padding:4px 12px; cursor:pointer; color:#1e40af;" ${offset<=0?'disabled style="opacity:0.3"':''}>←</button>
         <div style="font-weight:700; color:#0f172a; font-size:16px;">${monthName} ${target.getFullYear()}</div>
         <button id="nextCal" style="border:none; background:none; font-size:20px; padding:4px 12px; cursor:pointer; color:#1e40af;" ${offset>=2?'disabled style="opacity:0.3"':''}>→</button>
      </div>
      <div style="display:grid; grid-template-columns:repeat(7,1fr); gap:6px; text-align:center; margin-bottom:8px;">
        ${['Su','Mo','Tu','We','Th','Fr','Sa'].map(d=>`<div style="color:#94a3b8; font-size:12px; font-weight:600;">${d}</div>`).join('')}
      </div>
      <div class="cal-grid" style="display:grid; grid-template-columns:repeat(7,1fr); gap:6px; text-align:center;">
    `;
    
    for(let i=0; i<startDay; i++) html+='<div></div>';
    for(let d=1; d<=daysInMonth; d++){
       const iso = new Date(target.getFullYear(), target.getMonth(), d).toISOString().split('T')[0];
       const isPast = new Date(iso) < new Date(now.toISOString().split('T')[0]);
       const isAvail = mockAvail.find(x=>x.date===iso) && !isPast;
       
       if(!isAvail) {
           html+=`<div class="cal-day-cell disabled">${d}</div>`;
       } else {
           const isSel = window.selectedDate === iso;
           html+=`<div class="cal-day-cell ${isSel ? 'selected' : ''}" data-date="${iso}">${d}</div>`;
       }
    }
    html+='</div>';
    widget.innerHTML = html;
    
    // Bind Calendar Controls
    if(byId('prevCal')) byId('prevCal').onclick = () => render(offset-1);
    if(byId('nextCal')) byId('nextCal').onclick = () => render(offset+1);
    
    // Bind Date Cells
    widget.querySelectorAll('.cal-day-cell:not(.disabled)').forEach(el => {
      el.onclick = () => {
         // Update State
         window.selectedDate = el.dataset.date;
         console.log('[CAL-CLICK] Date selected:', window.selectedDate);
         
         // Update UI immediately (re-render to show selection)
         render(offset);
         
         // PROOF: Log actual DOM state after render
         setTimeout(() => {
           const selected = widget.querySelector('.cal-day-cell.selected');
           if(selected) {
             const computed = window.getComputedStyle(selected);
             console.log('[CAL-DOM] Selected cell:', {
               className: selected.className,
               background: computed.backgroundColor,
               color: computed.color,
               borderColor: computed.borderColor
             });
           }
         }, 10);
         
         // Show Time Slots
         byId('timeWindowSection').style.display = 'block';
         
         // Scroll slightly to show slots if tight
         byId('timeWindowSection').scrollIntoView({behavior:'smooth', block:'center'});
         
         updateSummary();
         checkSubmit();
      };
    });
  };

  // Initial Render
  render(0);
  
  // Bind Time Slots
  const slotContainer = byId('timeSlotsGrid');
  if(slotContainer) {
      slotContainer.querySelectorAll('.time-btn').forEach(btn => {
          btn.onclick = () => {
              console.log('[TIME-CLICK] Window selected:', btn.dataset.window);
              // Clear previous
              slotContainer.querySelectorAll('.time-btn').forEach(b => b.classList.remove('selected'));
              // Select new
              btn.classList.add('selected');
              window.selectedWindow = btn.dataset.window;
              
              // PROOF: Log actual DOM state
              setTimeout(() => {
                const selected = slotContainer.querySelector('.time-btn.selected');
                if(selected) {
                  const computed = window.getComputedStyle(selected);
                  console.log('[TIME-DOM] Selected button:', {
                    className: selected.className,
                    background: computed.backgroundColor,
                    color: computed.color,
                    borderColor: computed.borderColor
                  });
                }
              }, 10);
              
              updateSummary();
              checkSubmit();
          };
      });
  }
}

function updateSummary() {
    const el = byId('selectionSummary');
    if(!el) return;
    
    if(window.selectedDate && window.selectedWindow) {
        const d = new Date(window.selectedDate + 'T12:00:00');
        const niceDate = d.toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric' });
        el.innerHTML = `<span style="color:#2563eb; font-weight:700;">Selected:</span> ${niceDate} @ ${window.selectedWindow}`;
    } else if(window.selectedDate) {
        const d = new Date(window.selectedDate + 'T12:00:00');
        const niceDate = d.toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric' });
        el.innerText = `Pick a time for ${niceDate}`;
    } else {
        el.innerText = 'Pick a date & time for your pro.';
    }
}

function checkSubmit() {
    const btn = byId('confirmApptBtn');
    if(!btn) return;
    
    if(window.selectedDate && window.selectedWindow) {
        btn.classList.add('active');
        btn.disabled = false;
        
        // PROOF: Log confirm button enabled state
        setTimeout(() => {
          const computed = window.getComputedStyle(btn);
          console.log('[CONFIRM-DOM] Button enabled:', {
            disabled: btn.disabled,
            className: btn.className,
            background: computed.backgroundColor,
            opacity: computed.opacity,
            pointerEvents: computed.pointerEvents
          });
        }, 10);
        
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);
        newBtn.onclick = async () => {
            newBtn.innerText = 'Saving...';
            newBtn.disabled = true;
            newBtn.classList.remove('active');
            
            try {
                const orderData = window.__currentOrderData || {};
                const payload = {
                    session_id: window.__sessionId,
                    order_id: orderData.order_id,
                    delivery_date: window.selectedDate,
                    delivery_time: window.selectedWindow,
                    customer_name: orderData.customer_name,
                    customer_email: orderData.customer_email,
                    customer_phone: orderData.customer_phone,
                    service_address: orderData.service_address,
                    service_city: orderData.service_city,
                    service_state: orderData.service_state,
                    service_zip: orderData.service_zip,
                    service_name: orderData.service_name,
                    order_total: orderData.order_total,
                    order_subtotal: orderData.order_subtotal,
                    items_json: orderData.items_json,
                    metadata: orderData.metadata
                };
                
                console.log('[Schedule] Sending payload:', payload);
                
                const response = await fetch('https://h2s-backend.vercel.app/api/schedule-appointment', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                
                const result = await response.json();
                
                if (response.ok && result.ok) {
                    newBtn.innerText = 'Confirmed ✓';
                    newBtn.style.background = '#059669';
                    if(byId('schedMsg')) byId('schedMsg').innerHTML = '<span style="color:#059669; font-weight:700;">✓ Scheduled! Check your email.</span>';
                    
                    if(typeof h2sTrack === 'function') {
                        h2sTrack('ScheduleAppointment', { 
                            date: window.selectedDate, 
                            time: window.selectedWindow,
                            job_id: result.job_id,
                            order_id: orderData.order_id
                        });
                    }
                    
                    if (window.__sessionId) {
                        sessionStorage.removeItem(`h2s_order_${window.__sessionId}`);
                    }
                } else {
                    throw new Error(result.error || 'Failed to schedule');
                }
            } catch(err) {
                console.error('[Schedule] Error:', err);
                newBtn.innerText = 'Try Again';
                newBtn.style.background = '#ef4444';
                newBtn.disabled = false;
                newBtn.classList.add('active');
                if(byId('schedMsg')) byId('schedMsg').innerHTML = '<span style="color:#ef4444;">⚠ Failed. Call (864) 528-1475</span>';
            }
        };
    } else {
        btn.classList.remove('active');
        btn.disabled = true;
        
        // PROOF: Log confirm button disabled state
        setTimeout(() => {
          const computed = window.getComputedStyle(btn);
          console.log('[CONFIRM-DOM] Button disabled:', {
            disabled: btn.disabled,
            className: btn.className,
            background: computed.backgroundColor,
            opacity: computed.opacity,
            pointerEvents: computed.pointerEvents
          });
        }, 10);
    }
}


// 5. HOIST FIX
window.renderShopSuccess = renderShopSuccessView; 

function loadCalendarRobust3() {
  const widget = byId('calendarWidget');
  if(!widget) return;
  
  const mockAvail = [];
  const today = new Date();
  for(let i=0; i<60; i++){
      const d = new Date(today); d.setDate(today.getDate()+i);
      mockAvail.push({date:d.toISOString().split('T')[0]}); // Weekends allowed per user request
  }

  const render = (offset=0) => {
    const now = new Date();
    const target = new Date(now.getFullYear(), now.getMonth()+offset, 1);
    const monthName = target.toLocaleString('default',{month:'long'});
    const daysInMonth = new Date(target.getFullYear(), target.getMonth()+1, 0).getDate();
    const startDay = target.getDay(); 
    
    let html = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
         <button id="prevCal" style="border:none; background:none; font-size:20px; padding:4px 12px; cursor:pointer; color:#1e40af;" ${offset<=0?'disabled style="opacity:0.3"':''}>←</button>
         <div style="font-weight:700; color:#0f172a; font-size:16px;">${monthName} ${target.getFullYear()}</div>
         <button id="nextCal" style="border:none; background:none; font-size:20px; padding:4px 12px; cursor:pointer; color:#1e40af;" ${offset>=2?'disabled style="opacity:0.3"':''}>→</button>
      </div>
      <div style="display:grid; grid-template-columns:repeat(7,1fr); gap:6px; text-align:center; margin-bottom:8px;">
        ${['Su','Mo','Tu','We','Th','Fr','Sa'].map(d=>`<div style="color:#94a3b8; font-size:12px; font-weight:600;">${d}</div>`).join('')}
      </div>
      <div class="calendar-grid" style="display:grid; grid-template-columns:repeat(7,1fr); gap:6px; text-align:center;">
    `;
    
    for(let i=0; i<startDay; i++) html+='<div></div>';
    for(let d=1; d<=daysInMonth; d++){
       const iso = new Date(target.getFullYear(), target.getMonth(), d).toISOString().split('T')[0];
       const isPast = new Date(iso) < new Date(now.toISOString().split('T')[0]);
       const isAvail = mockAvail.find(x=>x.date===iso) && !isPast;
       if(!isAvail) html+=`<div class="cal-day-cell disabled">${d}</div>`;
       else {
         const sel = window.selectedDate === iso ? 'selected' : '';
         html+=`<div class="cal-day-cell ${sel}" data-date="${iso}">${d}</div>`;
       }
    }
    html+='</div>';
    widget.innerHTML = html;
    
    if(byId('prevCal')) byId('prevCal').onclick = () => render(offset-1);
    if(byId('nextCal')) byId('nextCal').onclick = () => render(offset+1);
    
    widget.querySelectorAll('.cal-day-cell:not(.disabled)').forEach(el => {
      el.onclick = () => {
         window.selectedDate = el.dataset.date;
         render(offset);
         byId('timeWindowSection').style.display = 'block';
         updateConfirmButton();
      };
    });
  };
  render(0);
}

function updateConfirmButton() {
    const btn = byId('confirmApptBtn');
    document.querySelectorAll('.time-slot-btn').forEach(b => {
        b.onclick = () => {
            document.querySelectorAll('.time-slot-btn').forEach(x=>x.classList.remove('selected'));
            b.classList.add('selected');
            window.selectedWindow = b.dataset.window;
            if(btn && window.selectedDate) {
                btn.disabled = false;
                btn.style.cursor = 'pointer';
                btn.style.background = '#2563eb';
                btn.innerText = 'Confirm Appointment';
                
                // Remove old listeners
                const newBtn = btn.cloneNode(true);
                btn.parentNode.replaceChild(newBtn, btn);
                
                newBtn.onclick = async () => {
                    newBtn.innerText = 'Confirmed ✓';
                    newBtn.style.background = '#059669';
                    newBtn.disabled = true;
                    if(byId('schedMsg')) byId('schedMsg').innerHTML = '<span style="color:#059669; font-weight:700;">Success! You are all set.</span>';
                    try { h2sTrack('ScheduleAppointment', { date: window.selectedDate, time: window.selectedWindow }); } catch(e){}
                };
            }
        };
    });
}


function renderSignInView() {
  if(typeof renderSignIn === 'function') renderSignIn();
  else renderFatal('Sign in page not available');
}

function renderSignUpView() {
  if(typeof renderSignUp === 'function') renderSignUp();
  else renderFatal('Sign up page not available');
}

function renderAccountView() {
  if(typeof renderAccount === 'function') renderAccount();
  else renderFatal('Account page not available');
}

function renderForgotView() {
  if(typeof renderForgot === 'function') renderForgot();
  else renderFatal('Password reset page not available');
}

function renderResetView() {
  const token = getParam('token');
  if(typeof renderReset === 'function') renderReset(token);
  else renderFatal('Password reset page not available');
}

function renderCalReturnView() {
  if(typeof handleCalReturn === 'function') handleCalReturn();
  else renderFatal('Calendar return page not available');
}

function renderApptReturnView() {
  if(typeof handleCalReturn === 'function') handleCalReturn();
  else renderFatal('Appointment return page not available');
}

// === RENDERER MAP FACTORY ===
// Returns the map at call time, ensuring all functions are hoisted and available
function getViewRenderers() {
  return {
    shop: renderShopView,
    shopsuccess: renderShopSuccessView,
    signin: renderSignInView,
    signup: renderSignUpView,
    account: renderAccountView,
    forgot: renderForgotView,
    reset: renderResetView,
    calreturn: renderCalReturnView,
    apptreturn: renderApptReturnView
  };
}

// === ROUTING ===
async function route(){
  // IDEMPOTENT GUARD: Prevent double routing for same view
  const view = getParam('view') || 'shop';
  if(window.__LAST_ROUTED_VIEW === view) {
    // console.log('⚠️ [ROUTE] Already routed to', view, '- skipping duplicate call');
    return;
  }
  window.__LAST_ROUTED_VIEW = view;
  
  // console.log('🔴 [ROUTE] FUNCTION CALLED - view:', view);
  logger.log('[ROUTE] View parameter:', view);

  // Safety: ensure we never carry a scroll lock across views
  H2S_forceUnlockScroll();
  
  // Get the renderer for this view
  const renderers = getViewRenderers();
  const renderer = renderers[view];
  
  if(!renderer) {
    console.error('[ROUTE] Unknown view:', view);
    renderFatal(`Unknown page view: "${view}". The page you're looking for doesn't exist.`);
    return;
  }
  
  // Call the renderer safely
  try {
    // console.log('🔴 [ROUTE] Calling renderer for view:', view);
    await renderer();
    // console.log('🔴 [ROUTE] Renderer completed');
  } catch(err) {
    console.error('[ROUTE] Fatal render error:', err);
    console.error('[ROUTE] Error stack:', err.stack);
    renderFatal('Something broke loading this page. Please refresh or contact support.');
  }
  
  // Close any open modals/drawers after rendering
  closeAll();
}

// === INIT ===
async function init(){
  // console.log('🟢 [INIT] Function called');
  
  // CRITICAL: Early exit for success pages - skip ALL shop-only logic
  const view = getParam('view');
  if(view === 'shopsuccess') {
    // console.log('⚡ [INIT] Success page detected - skipping shop init, calling route() once');
    route();
    return;
  }
  
  // Keep init minimal and fast
  
  // CRITICAL: Attach checkout button event listener with safeguards
  // Using addEventListener (not onclick) to maintain proper event control for tracking
  const checkoutBtn = byId('checkoutBtn');
  if(checkoutBtn) {
    // Remove any existing listeners to prevent double-firing
    const newCheckoutBtn = checkoutBtn.cloneNode(true);
    checkoutBtn.parentNode.replaceChild(newCheckoutBtn, checkoutBtn);
    
    newCheckoutBtn.addEventListener('click', function(e) {
      logger.log('[Checkout] Button clicked');
      e.preventDefault();
      e.stopPropagation();
      
      // Debounce: Prevent rapid double-clicks
      if(newCheckoutBtn.disabled) {
        logger.log('[Checkout] Button click ignored (already processing)');
        return;
      }
      
      newCheckoutBtn.disabled = true;
      setTimeout(() => { newCheckoutBtn.disabled = false; }, 1000);
      
      // Call checkout function
      try {
        if(typeof window.checkout === 'function') {
          window.checkout();
        } else {
          logger.error('[Checkout] window.checkout not defined, calling showCheckoutModal directly');
          showCheckoutModal();
        }
      } catch(err) {
        logger.error('[Checkout] Critical error:', err);
        // Fallback: Show modal anyway
        try {
          showCheckoutModal();
        } catch(err2) {
          logger.error('[Checkout] Fallback failed:', err2);
          alert('Unable to open checkout. Please refresh the page or call (864) 528-1475 to complete your order.');
        }
      }
    }, { passive: false });
    
    logger.log('[Init] Checkout button event listener attached (clean)');
  } else {
    logger.error('[Init] Checkout button not found!');
  }
  
  // ADDED: Phone click tracking for all tel: links
  (function initPhoneTracking() {
    function trackPhoneClick(link) {
      const phone = link.href.replace('tel:', '').trim();
      const location = link.closest('nav') ? 'menu' : 
                       link.closest('#cartDrawer') ? 'cart' :
                       link.closest('#quoteModal') ? 'quote' :
                       link.closest('header') ? 'header' :
                       link.closest('footer') ? 'footer' : 'unknown';
      
      h2sTrack('PhoneClick', {
        phone: phone,
        click_location: location,
        page_url: window.location.href,
        page_path: window.location.pathname
      });
    }
    
    // Track existing phone links
    document.querySelectorAll('a[href^="tel:"]').forEach(link => {
      link.addEventListener('click', function(e) {
        trackPhoneClick(link);
      }, { once: false });
    });
    
    // Track dynamically added phone links (MutationObserver)
    if (window.MutationObserver) {
      const observer = new MutationObserver(function(mutations) {
        mutations.forEach(function(mutation) {
          mutation.addedNodes.forEach(function(node) {
            if (node.nodeType === 1) { // Element node
              // Check if added node is a phone link
              if (node.tagName === 'A' && node.href && node.href.startsWith('tel:')) {
                node.addEventListener('click', function(e) {
                  trackPhoneClick(node);
                });
              }
              // Check for phone links within added node
              node.querySelectorAll && node.querySelectorAll('a[href^="tel:"]').forEach(function(link) {
                link.addEventListener('click', function(e) {
                  trackPhoneClick(link);
                });
              });
            }
          });
        });
      });
      
      observer.observe(document.body, {
        childList: true,
        subtree: true
      });
    }
  })();

  try {
    // PHASE 1: INSTANT - Minimal critical setup (< 50ms target)
    performance.mark('phase1-start');
    
    // Mark page as ready immediately for static content
    document.body.classList.add('app-ready');
    
    // OPTIMIZATION: Capture static shop HTML to avoid duplication in JS
    const outlet = byId('outlet');
    if(outlet && outlet.querySelector('.hero')) {
      window.shopHTML = outlet.innerHTML;
    }
    
    performance.mark('phase1-end');
    performance.measure('Phase 1: Critical Setup', 'phase1-start', 'phase1-end');
    
    // PHASE 2: Essential UI setup (defer to next frame for faster initial paint)
    requestAnimationFrame(() => {
      wireCart();
      // Defer badge update - not visible above fold
      if('requestIdleCallback' in window){
        requestIdleCallback(() => updateCartBadge(), {timeout: 1000});
      } else {
        setTimeout(() => updateCartBadge(), 250);
      }
    });
    
    // PHASE 3: DETERMINE VIEW - Quick routing decision
    const view = getParam('view');
    // console.log('🟢 [INIT] View parameter:', view);
    const isSpecialView = view && view !== 'shop';
    
    // PHASE 4: RENDER IMMEDIATELY - Don't wait for anything
    // console.log('🟢 [INIT] Calling route()...');
    route(); // Shows static content instantly for shop view
    // console.log('🟢 [INIT] route() returned');
    
    
    // PHASE 5: BACKGROUND LOADS - Use pre-started fetch
    // We use the promise started at the top of the script
    
    // Process immediately after route (no setTimeout) to minimize delays
    bundlesFetchPromise.then(data => {        if (data) {
          // === SUCCESS PATH ===
          if(data.catalog){
            catalog = data.catalog;
            // Re-render only if needed (not on shop view with static content)
            if (isSpecialView) route();
          }
          
          if(data.reviews){
            allReviews = data.reviews;
            reviewsLoadedFromAPI = true;
            
            // Populate heroReviews from allReviews
            heroReviews = allReviews.slice(0, 5).map(r => ({
              text: r.text && r.text.trim() ? r.text.trim() : '',
              author: r.name || 'Customer',
              stars: r.rating || 5
            })).filter(r => r.text.length > 0);

            // Initialize hero reviews immediately for real names/words
            if(!isSpecialView){
              try { initHeroReviews(); } catch(e) { logger.warn('initHeroReviews error', e); }
              // Defer renderReviews to idle to avoid blocking main thread
              if('requestIdleCallback' in window){
                requestIdleCallback(() => { try { renderReviews(); } catch(e) { logger.warn('renderReviews error', e); } }, {timeout: 2000});
              } else {
                setTimeout(() => { try { renderReviews(); } catch(e) { logger.warn('renderReviews error', e); } }, 1500);
              }
            }
          }
        } else {
          // === FALLBACK PATH ===
          logger.warn('[Bundles] Aggregated data missing, using fallback');
          if (IS_LOCAL) {
            // Local dev: avoid cross-origin fetch; keep defaults and init reviews UI only
            try { initHeroReviews(); } catch(e) { logger.warn('initHeroReviews error', e); }
          } else {
            fetch(API + '?action=catalog').then(r => r.json()).then(d => {
              if(d.ok) catalog = d.catalog || catalog;
            });
            // Also try to load reviews separately since aggregation failed
            try { initHeroReviews(); } catch(e) { logger.warn('initHeroReviews error', e); }
          }
        }
      });
    
    // Handle cart from URL
    const urlCart = getParam('cart');
    if(urlCart){
      const decoded = decodeCartFromUrl(urlCart);
      if(decoded.length){
        cart = decoded;
        saveCart();
        updateCartBadge();
        paintCart();
      }
    }
    
    // Clean URL - remove cart parameter
    const url = new URL(location.href);
    if(url.searchParams.has('cart')){
      url.searchParams.delete('cart');
      history.replaceState({}, '', url.toString());
    }
    
    // Show tracking debug panel if ?debug=tracking
    if(url.searchParams.get('debug') === 'tracking'){
      setTimeout(() => showTrackingDebugPanel(), 1000);
    }
    
    // PHASE 6: DEFERRED FEATURES - Load after page is interactive
    // AI recommendations (only if signed in)
    if(user && user.email){
      requestIdleCallback(() => loadAIRecommendations(), { timeout: 3000 });
    }
    
    // Meta Pixel (deferred, low priority)
    if('requestIdleCallback' in window){
      requestIdleCallback(() => {
        try {
          // Only load pixel if user interacts or after 5s
          /*
          const loadPixel = () => {
            if(window.fbq) return;
            const script = document.createElement('script');
            script.innerHTML = `
              !function(f,b,e,v,n,t,s)
              {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
              n.callMethod.apply(n,arguments):n.queue.push(arguments)};
              if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
              n.queue=[];t=b.createElement(e);t.async=!0;
              t.src=v;s=b.getElementsByTagName(e)[0];
              s.parentNode.insertBefore(t,s)}(window, document,'script',
              'https://connect.facebook.net/en_US/fbevents.js');
              fbq('init', '${PIXEL_ID}');
              fbq('track', 'PageView');
            `;
            document.head.appendChild(script);
            
            const noscript = document.createElement('noscript');
            noscript.innerHTML = `<img height="1" width="1" style="display:none" src="https://www.facebook.com/tr?id=${PIXEL_ID}&ev=PageView&noscript=1"/>`;
            document.body.appendChild(noscript);
          };
          
          // Delay pixel load to ensure LCP is done
          setTimeout(loadPixel, 6000);
          */
        } catch(e) { logger.warn('Pixel init failed', e); }
      }, { timeout: 8000 });
    }
    
    // Diagnostic: surface duplicate Meta Pixel loaders to console
    (function(){
      const run = () => {
        try {
          const srcs = Array.from(document.scripts)
            .filter(s => typeof s.src === 'string' && s.src.indexOf('connect.facebook.net') !== -1 && s.src.indexOf('fbevents.js') !== -1)
            .map(s => s.src);
          if (srcs.length > 1) {
            console.warn('[Meta Pixel] Multiple fbevents.js scripts detected:', srcs);
          }
        } catch(_) {/* noop */}
      };
      if ('requestIdleCallback' in window) requestIdleCallback(run, { timeout: 4000 }); else setTimeout(run, 4000);
    })();
    
    // PHASE 7: ANALYTICS - Track page view (lowest priority)
    if('requestIdleCallback' in window){
      requestIdleCallback(() => h2sTrack('PageView'), {timeout: 4000});
    } else {
      setTimeout(() => h2sTrack('PageView'), 2500);
    }
    
    performance.mark('init-end');
    performance.measure('Total Init Time', 'init-start', 'init-end');
  } catch (err) {
    // Fallback: show content anyway
    document.body.classList.add('app-ready');
  }
  
  // MOBILE: Setup input focus handling to prevent unwanted zoom
  if(window.innerWidth <= 768) {
    setupMobileInputHandling();
  }
}

// Mobile input handling - prevent zoom issues and ensure smooth scrolling
function setupMobileInputHandling() {
  // Ensure all inputs have minimum 16px font size (already in CSS, but enforce)
  // NOTE: Avoid touching <select> here.
  // On iOS, forcing scroll on select focus while body is scroll-locked (position:fixed) can
  // jump the window scroll to 0 while body.top remains negative -> appears as a white screen.
  const inputs = document.querySelectorAll('input, textarea');
  inputs.forEach(input => {
    // On focus, scroll input into view smoothly
    input.addEventListener('focus', function(e) {
      setTimeout(() => {
        // If any overlay is open, body scroll is locked (position:fixed + top offset).
        // Scrolling the window here can desync scroll position vs body.top.
        if (document.body.classList.contains('modal-open') || document.documentElement.classList.contains('modal-open')) {
          return;
        }
        // Smooth scroll to bring input into view
        e.target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 300); // Delay to let keyboard appear
    }, { passive: true });
  });
  
  // Prevent zoom on double-tap for specific elements
  let lastTouchEnd = 0;
  document.addEventListener('touchend', function(e) {
    const now = Date.now();
    if (now - lastTouchEnd <= 300) {
      // Double tap detected - prevent default zoom on non-input elements
      if(!['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) {
        e.preventDefault();
      }
    }
    lastTouchEnd = now;
  }, { passive: false });
  
  logger.log('[Mobile] Input handling initialized');
}

// Ensure init runs after DOM is ready
console.log('🟢 [INIT] Setting up DOMContentLoaded listener...');
if(document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', () => { 
    console.log('🟢 [INIT] DOMContentLoaded fired');
    console.log('🟢 [INIT] Calling init()');
    performance.mark('before_init_call');
    try{ init(); }catch(e){ logger.error('[Init] Failed:', e); }
  });
} else {
  console.log('🟢 [INIT] DOM already loaded');
  console.log('🟢 [INIT] Calling init() immediately');
  performance.mark('before_init_call');
  try{ init(); }catch(e){ logger.error('[Init] Failed:', e); }
}

// Fire Meta Pixel ViewContent quickly after DOM is ready
document.addEventListener('DOMContentLoaded', function(){
  setTimeout(function(){
    try {
      if (window.h2sFbTrack) {
        window.h2sFbTrack('ViewContent', {
          content_name: 'Bundles Page',
          content_category: 'product_catalog'
        });
      }
    } catch(err) { logger.warn('[Pixel] ViewContent failed', err); }
  }, 800);
});

// Fetch latest catalog from backend. If cacheBust is true, append a timestamp to force bypass.
async function fetchCatalogFromAPI(cacheBust = false){
  try{
    const url = API + '?action=catalog' + (cacheBust ? '&cb=' + Date.now() : '');
    const res = await fetch(url, { cache: 'no-store' });
    if(!res.ok){
      logger.warn('[Catalog] HTTP', res.status);
      return false;
    }
    const data = await res.json();
    if(data && data.ok && data.catalog){
      catalog = data.catalog;
      return true;
    }
    logger.warn('[Catalog] Unexpected response while fetching catalog', data);
    return false;
  }catch(err){
    logger.warn('[Catalog] Fetch failed:', err);
    return false;
  }
}

function renderShop(){
  // OPTIMIZATION: If static content exists, do not re-render
  const outlet = byId('outlet');
  if(!outlet) return;
  if(outlet.querySelector('.hero')) return;

  const isFirstRender = !window.__shopRenderedOnce;
  
  // OPTIMIZATION: Use captured static HTML instead of huge string
  let html = window.shopHTML || '';
  
  if(!html){
    logger.warn('[Shop] Static HTML missing, reloading...');
    location.reload();
    return;
  }

  if (isFirstRender) {
    // Render immediately without transition
    outlet.style.opacity = '';
    outlet.style.transition = '';
    outlet.innerHTML = html;
    document.body.classList.add('app-ready');
    
    // Initialize reviews immediately after DOM update
    try { initHeroReviews(); } catch(e) { logger.warn('initHeroReviews error', e); }
    
    // Scroll to top
    window.scrollTo(0, 0);
    window.__shopRenderedOnce = true;
    
    // Update signin state
    renderSigninState();
  } else {
    // Transition out, then render, then transition in
    outlet.style.opacity = '0';
    outlet.style.transition = 'opacity 0.3s ease';
    
    setTimeout(() => {
      outlet.innerHTML = html;
      
      // Fade back in
      requestAnimationFrame(() => {
        outlet.style.opacity = '1';
        document.body.classList.add('app-ready');
      });
      
      // Initialize reviews
      try { initHeroReviews(); } catch(e) { logger.warn('initHeroReviews error', e); }
      
      // Update signin state
      renderSigninState();
      
      // Scroll to top
      window.scrollTo(0, 0);
      window.__shopRenderedOnce = true;
    }, 300); // Wait for fade out
  }
}

function navSet(params){
  const u = new URL(location.href);
  Object.entries(params||{}).forEach(([k,v])=>{
    if(v==null) u.searchParams.delete(k); else u.searchParams.set(k,v);
  });
  history.pushState({}, '', u.toString());
  route();
}

function getParam(k){
  const u = new URL(location.href);
  return u.searchParams.get(k);
}

function wireCart(){
  const acctBtn = byId('accountBtn');
  if(acctBtn){
    acctBtn.onclick = ()=> {
      closeAll();
      if(user && user.email){
        navSet({view:'account'});
      } else {
        navSet({view:'signin'});
      }
    };
  }
  
  const bsi = byId('bannerSignIn');
  if(bsi){
    bsi.onclick = ()=> {
      closeAll();
      navSet({view: user?.email ? 'account' : 'signin'});
    };
  }
}

function renderSigninState(){
  const btn = byId('accountBtn');
  if(!btn) return;
  
  if(user && user.email){
    btn.textContent = 'Account';
  } else {
    btn.textContent = 'Sign in';
  }
}

function scrollToSection(id){
  const el = document.getElementById(id);
  if(el){
    // Scroll with offset to account for fixed header (56px)
    const headerHeight = 56;
    const elementPosition = el.getBoundingClientRect().top;
    const offsetPosition = elementPosition + window.pageYOffset - headerHeight - 16; // 16px extra padding
    
    window.scrollTo({
      top: offsetPosition,
      behavior: 'smooth'
    });
  }
}

// Expose to window for onclick handlers
window.scrollToSection = scrollToSection;

// === MENU / CART / MODAL TOGGLES ===
function toggleMenu(){
  const menu = document.getElementById('menuDrawer');
  const backdrop = document.getElementById('backdrop');
  if(!menu || !backdrop) return;
  
  // OPTIMIZATION: content-visibility
  if(!menu.classList.contains('open')) menu.style.contentVisibility = 'visible';
  
  const isOpen = menu.classList.contains('open');
  
  if(isOpen){
    menu.classList.remove('open');
    backdrop.classList.remove('show');
    document.documentElement.classList.remove('modal-open');
    document.body.classList.remove('modal-open');
    H2S_unlockScroll();
    setTimeout(()=>{ if(!menu.classList.contains('open')) menu.style.contentVisibility = 'hidden'; }, 300);
  }else{
    closeAll();
    menu.classList.add('open');
    backdrop.classList.add('show');
    document.documentElement.classList.add('modal-open');
    document.body.classList.add('modal-open');
  }
}

function toggleCart(){
  logger.log('[Cart] toggleCart() called');
  const drawer = document.getElementById('cartDrawer');
  const backdrop = document.getElementById('backdrop');
  
  // OPTIMIZATION: content-visibility
  if(!drawer.classList.contains('open')) drawer.style.contentVisibility = 'visible';

  const isOpen = drawer.classList.contains('open');
  
  if(isOpen){
    drawer.classList.remove('open');
    backdrop.classList.remove('show');
    document.documentElement.classList.remove('modal-open');
    document.body.classList.remove('modal-open');
    H2S_unlockScroll();
    setTimeout(()=>{ if(!drawer.classList.contains('open')) drawer.style.contentVisibility = 'hidden'; }, 300);
  }else{
    closeAll();
    drawer.classList.add('open');
    backdrop.classList.add('show');
    document.documentElement.classList.add('modal-open');
    document.body.classList.add('modal-open');
    H2S_lockScroll();
    paintCart();
    
    // MOBILE: Ensure cart body scrolls properly
    requestAnimationFrame(() => {
      const cartBody = drawer.querySelector('.cart-body');
      if(cartBody) {
        // Reset scroll position to top
        cartBody.scrollTop = 0;
        // Force repaint for iOS webkit scrolling
        cartBody.style.webkitOverflowScrolling = 'touch';
        cartBody.style.overflowY = 'auto';
      }
    });
  }
}

// Expose to window for onclick handlers
window.toggleMenu = toggleMenu;
window.__toggleCart = toggleCart; // Use internal name to avoid conflict with HTML wrapper
window.toggleCart = toggleCart; // Keep for backward compatibility

function H2S_forceUnlockScroll(){
  try { if(typeof H2S_unlockScroll === 'function') H2S_unlockScroll(); } catch(_) {}
  try { document.documentElement.classList.remove('modal-open'); } catch(_) {}
  try { document.body.classList.remove('modal-open'); } catch(_) {}
  try { document.body.style.top = ''; } catch(_) {}

  // Best-effort cleanup for iOS scroll pin handlers
  try {
    const tvModal = document.getElementById('tvSizeModal');
    if(tvModal && tvModal._scrollLockHandler){
      try { window.removeEventListener('scroll', tvModal._scrollLockHandler); } catch(_) {}
      tvModal._scrollLockHandler = null;
    }
  } catch(_) {}
}

function closeAll(){
  const menu = document.getElementById('menuDrawer');
  const cart = document.getElementById('cartDrawer');
  const backdrop = document.getElementById('backdrop');
  
  try { menu && menu.classList.remove('open'); } catch(_) {}
  try { cart && cart.classList.remove('open'); } catch(_) {}
  try { backdrop && backdrop.classList.remove('show'); } catch(_) {}
  H2S_forceUnlockScroll();
  
  setTimeout(()=>{ 
    try { if(menu && !menu.classList.contains('open')) menu.style.contentVisibility = 'hidden'; } catch(_) {}
    try { if(cart && !cart.classList.contains('open')) cart.style.contentVisibility = 'hidden'; } catch(_) {}
  }, 300);

  closeModal();
  safeCloseQuoteModal();
  if(typeof closeTVSizeModal === 'function') closeTVSizeModal();
  
  H2S_forceUnlockScroll();
}

function showModal(){
  closeAll();
  const m = byId('modal');
  m.classList.add('show');
  document.documentElement.classList.add('modal-open');
  document.body.classList.add('modal-open');
}

function closeModal(){
  const m = byId('modal');
  const backdrop = byId('backdrop');
  
  m.classList.remove('show');
  if(backdrop) backdrop.classList.remove('show');

  if(!byId('menuDrawer')?.classList.contains('open') && !byId('cartDrawer')?.classList.contains('open')){
    document.documentElement.classList.remove('modal-open');
    document.body.classList.remove('modal-open');
    H2S_unlockScroll(); // CRITICAL: Unlock scroll when closing modal
  }
}

// === SAFE WRAPPERS FOR DEFERRED FUNCTIONS ===
function safeRequestQuote(p){
  if(typeof window.requestQuote === 'function') window.requestQuote(p);
}

function safeCloseQuoteModal(){
  if(typeof window.closeQuoteModal === 'function') window.closeQuoteModal();
}

// === PACKAGE SELECTION ===
let currentPackage = null;

window.selectPackage = function(id, name, price){
  // Check if this is a TV mounting package - if so, show TV size modal
  if (id.includes('tv_') || name.toLowerCase().includes('tv')) {
    showTVSizeModal(id, name, price);
    return;
  }
  
  // For non-TV packages, add directly to cart
  addPackageDirectToCart(id, name, price);
};

// Expose to window for onclick handlers
window.selectPackage = selectPackage;

function addPackageDirectToCart(id, name, price, metadata = {}){
  // OPTIMIZATION: Direct Add-to-Cart (Fast Path)
  // Ensure price is a number
  const numPrice = Number(price);
  
  const existing = cart.find(item => item.type === 'package' && item.id === id);
  if(existing){
    existing.qty++;
    // Merge metadata if provided
    if (Object.keys(metadata).length > 0) {
      existing.metadata = { ...existing.metadata, ...metadata };
    }
  }else{
    const newItem = { 
      type:'package', 
      id, 
      name, 
      price: numPrice, 
      qty:1,
      metadata: metadata // Store TV size, team requirements, etc.
    };
    cart.push(newItem);
  }
  
  // Track add to cart
  h2sTrack('AddToCart', {
    product_id: id,
    product_name: name,
    quantity: 1,
    price: numPrice,
    currency: 'USD',
    ...metadata
  });
  
  saveCart();
  
  // Force open cart to show success
  const drawer = byId('cartDrawer');
  logger.log('[Cart] Opening cart drawer. Currently open:', drawer?.classList.contains('open'));
  if(drawer && !drawer.classList.contains('open')) {
    toggleCart();
    logger.log('[Cart] Cart drawer toggled open');
  } else {
    logger.log('[Cart] Cart drawer already open');
  }
}

function showTVSizeModal(packageId, packageName, packagePrice) {
  // Determine TV count options based on package type
  let tvCountOptions = [];
  let autoSelectCount = null;
  let quantityLabel = 'How many TVs are you mounting?';
  
  if (packageId === 'tv_single') {
    autoSelectCount = 1; // Single TV Package: auto-configure 1 TV
  } else if (packageId === 'tv_2pack') {
    autoSelectCount = 2; // 2-TV Package: auto-configure 2 TVs
  } else if (packageId === 'tv_multi') {
    tvCountOptions = [3, 4]; // Multi-room package: choose 3 or 4 TVs
    quantityLabel = 'How many TVs? (Multi-room: 3-4 TVs)';
  } else {
    tvCountOptions = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]; // Custom package: any quantity
    quantityLabel = 'How many TVs are you mounting?';
  }
  
  // Remove existing modal to rebuild with correct options
  let modal = byId('tvSizeModal');
  if (modal) {
    modal.remove();
  }
  
  // Create fresh modal with package-specific options
  modal = document.createElement('div');
  modal.id = 'tvSizeModal';
  modal.className = 'modal';
  
  const quantitySelectorHTML = autoSelectCount ? '' : `
    <!-- Number of TVs -->
    <div id="tvQuantitySelector" style="margin-bottom:24px;">
      <label style="display:block;font-weight:700;margin-bottom:12px;color:var(--cobalt);font-size:15px;">
        ${quantityLabel}
      </label>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        ${tvCountOptions.map(num => `
          <button type="button" class="tv-count-btn" data-count="${num}" onclick="setTVCount(${num})" style="
            flex:${tvCountOptions.length <= 4 ? '1' : '0 0 calc(25% - 6px)'};
            min-width:60px;
            padding:12px;
            border:2px solid #e5e7eb;
            border-radius:8px;
            background:#f9fafb;
            font-weight:700;
            font-size:16px;
            cursor:pointer;
            transition:all 0.2s;
          ">${num} TV${num > 1 ? 's' : ''}</button>
        `).join('')}
      </div>
    </div>
  `;
  
  modal.innerHTML = `
    <div class="modal-content" style="max-width: 600px;">
      <div class="modal-header">
        <h3 style="margin:0;font-size:20px;font-weight:800;">Configure Your TV Installation</h3>
        <button class="close-btn" onclick="closeTVSizeModal()" aria-label="Close">&times;</button>
      </div>
      <div class="modal-body" style="padding: 32px 24px;">
        
        <!-- STEP 1: Mount Provider Selection -->
        <div id="mountProviderSection" style="margin-bottom:24px;">
          <label style="display:block;font-weight:700;margin-bottom:12px;color:var(--cobalt);font-size:15px;">
            Do you already have TV mounts?
          </label>
          <div style="display:flex;gap:12px;margin-bottom:12px;">
            <button type="button" class="mount-provider-btn" data-provider="h2s" onclick="selectMountProvider('h2s')" style="
              flex:1;
              padding:16px;
              border:2px solid #e5e7eb;
              border-radius:8px;
              background:#f9fafb;
              font-weight:600;
              font-size:15px;
              cursor:pointer;
              transition:all 0.2s;
              text-align:left;
            ">
              <div style="font-weight:700;margin-bottom:4px;">We'll Provide Mounts</div>
              <div style="font-size:12px;color:#6b7280;">Professional-grade mounts included</div>
            </button>
            <button type="button" class="mount-provider-btn" data-provider="customer" onclick="selectMountProvider('customer')" style="
              flex:1;
              padding:16px;
              border:2px solid #e5e7eb;
              border-radius:8px;
              background:#f9fafb;
              font-weight:600;
              font-size:15px;
              cursor:pointer;
              transition:all 0.2s;
              text-align:left;
            ">
              <div style="font-weight:700;margin-bottom:4px;">I Have Mounts</div>
              <div style="font-size:12px;color:#6b7280;">Save on mount costs</div>
            </button>
          </div>
          <div style="padding:10px;background:#fef3c7;border-left:3px solid #f59e0b;border-radius:4px;font-size:12px;color:#92400e;">
            <strong>Important:</strong> Customer-provided mounts must be compatible with your TV size and wall type. We recommend professional-grade mounts for safety.
          </div>
        </div>
        
        <!-- Mount Type Guide (shown only if H2S provides) -->
        <div id="mountGuideSection" style="display:none;margin:0 0 16px 0;">
          <button type="button" onclick="toggleMountGuide()" style="
            width:100%;
            padding:12px;
            background:#f0f9ff;
            border:1px solid #bfdbfe;
            border-radius:8px;
            font-size:13px;
            font-weight:600;
            color:#1e40af;
            cursor:pointer;
            text-align:left;
            display:flex;
            align-items:center;
            justify-content:space-between;
            transition:all 0.2s;
          ">
            <span>Mount Selection Guide</span>
            <span id="guideToggleIcon" style="transition:transform 0.2s;">▼</span>
          </button>
          <div id="mountGuideContent" style="display:none;padding:12px 0 0 0;color:#4b5563;font-size:13px;line-height:1.6;">
            <ul style="margin:0;padding-left:20px;">
              <li style="margin-bottom:6px;"><strong>Fixed/Flat:</strong> Bedrooms, kids' rooms - sleek, low-profile</li>
              <li style="margin-bottom:6px;"><strong>Tilt:</strong> Above eye level - reduces glare, neck strain</li>
              <li style="margin-bottom:6px;"><strong>Full Motion:</strong> Living rooms, open spaces - adjust viewing angle from anywhere</li>
            </ul>
          </div>
        </div>
        
        ${quantitySelectorHTML}
        
        <!-- TV Configurations Container -->
        <div id="tvConfigsContainer" style="display:none;">
          <!-- Dynamically populated -->
        </div>
      </div>
      
      <div class="modal-footer">
        <button class="btn btn-primary" id="confirmTVSizeBtn" onclick="confirmTVSize()" disabled style="
          width:100%;
          font-size:16px;
          padding:16px;
          font-weight:700;
          background:linear-gradient(135deg, var(--cobalt) 0%, #1e40af 100%);
          border:none;
          border-radius:12px;
          box-shadow:0 4px 12px rgba(37, 99, 235, 0.25);
          transition:all 0.2s ease;
        ">
          <span id="confirmBtnText">Add to Cart</span>
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  
  // Add modal styles (only once globally)
  if (!document.getElementById('tvModalStyles')) {
    const style = document.createElement('style');
    style.id = 'tvModalStyles';
    style.textContent = `
      .tv-count-btn.active {
        background: var(--cobalt) !important;
        color: white !important;
        border-color: var(--cobalt) !important;
      }
      .tv-count-btn:hover {
        border-color: var(--cobalt);
        background: #f3f4f6;
      }
      .mount-provider-btn.active {
        background: var(--cobalt) !important;
        color: white !important;
        border-color: var(--cobalt) !important;
      }
      .mount-provider-btn:hover {
        border-color: var(--cobalt);
        background: #f3f4f6;
      }
      .tv-config-card {
        background: #f9fafb;
        border: 2px solid #e5e7eb;
        border-radius: 12px;
        padding: 20px;
        margin-bottom: 16px;
      }
      .tv-config-card select {
        width: 100%;
        font-size: 14px;
        padding: 12px 14px;
        border: 2px solid #e5e7eb;
        border-radius: 8px;
        background: white;
        cursor: pointer;
        transition: all 0.2s ease;
        appearance: none;
        background-image: url('data:image/svg+xml;charset=UTF-8,%3csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%234b5563%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3e%3cpolyline points=%226 9 12 15 18 9%22%3e%3c/polyline%3e%3c/svg%3e');
        background-repeat: no-repeat;
        background-position: right 12px center;
        background-size: 18px;
        padding-right: 40px;
      }
      .tv-config-card select:hover {
        border-color: var(--cobalt);
      }
      .tv-config-card select:focus {
        outline: none;
        border-color: var(--cobalt);
        box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
      }
      .mount-price-badge {
        display: inline-block;
        background: #22c96f;
        color: white;
        padding: 4px 12px;
        border-radius: 6px;
        font-size: 12px;
        font-weight: 700;
        margin-left: 8px;
      }
      #confirmTVSizeBtn:hover:not(:disabled) {
        transform: translateY(-2px);
        box-shadow: 0 6px 16px rgba(37, 99, 235, 0.35);
      }
      #confirmTVSizeBtn:active:not(:disabled) {
        transform: translateY(0);
      }
      #confirmTVSizeBtn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
    `;
    document.head.appendChild(style);
  }

  // Store package info in modal dataset
  modal.dataset.packageId = packageId;
  modal.dataset.packageName = packageName;
  modal.dataset.packagePrice = packagePrice;
  modal.dataset.autoSelectCount = autoSelectCount || '';

  // Reset state
  modal.tvConfigs = [];
  modal.tvCount = 0;
  modal.mountProvider = null; // Will be set when customer selects

  // Show modal
  modal.classList.add('show');
  
  // Lock body scroll and save scroll position
  const scrollY = window.scrollY;
  document.documentElement.classList.add('modal-open');
  document.body.classList.add('modal-open');
  document.body.style.top = `-${scrollY}px`;
  modal._savedScrollY = scrollY;

  // Keep window scroll pinned while body is fixed.
  // Prevents iOS/select-focus from changing window.scrollY and desyncing body.top (white screen).
  try {
    window.scrollTo(0, 0);
    modal._scrollLockHandler = () => {
      if (window.scrollY !== 0) window.scrollTo(0, 0);
    };
    window.addEventListener('scroll', modal._scrollLockHandler, { passive: true });
  } catch(_) { /* noop */ }
  
  // Hide quantity selector and config container initially (show after mount provider selection)
  const quantitySelector = byId('tvQuantitySelector');
  const configContainer = byId('tvConfigsContainer');
  if (quantitySelector && !autoSelectCount) {
    quantitySelector.style.display = 'none';
  }
  if (configContainer) {
    configContainer.style.display = 'none';
  }
  
  // Check if modal body needs scroll indicator
  setTimeout(() => checkModalScroll(), 100);
  
  // Keyboard-aware modal positioning for mobile
  if ('visualViewport' in window) {
    const adjustModalForKeyboard = () => {
      const modalContent = modal.querySelector('.modal-content');
      if (modalContent) {
        const viewportHeight = window.visualViewport.height;
        modalContent.style.maxHeight = `${viewportHeight * 0.85}px`;
      }
    };
    window.visualViewport.addEventListener('resize', adjustModalForKeyboard);
    modal._keyboardHandler = adjustModalForKeyboard;
  }
  
  // Allow closing with Escape key
  const escHandler = (e) => {
    if (e.key === 'Escape') {
      closeTVSizeModal();
      document.removeEventListener('keydown', escHandler);
    }
  };
  document.addEventListener('keydown', escHandler);
  
  // Allow closing by clicking backdrop
  const backdropClickHandler = (e) => {
    if (e.target.id === 'backdrop') {
      closeTVSizeModal();
      byId('backdrop').removeEventListener('click', backdropClickHandler);
    }
  };
  byId('backdrop').addEventListener('click', backdropClickHandler);
}

// Mount type pricing
const MOUNT_PRICING = {
  fixed: 0,
  tilt: 25,
  full_motion: 75
};

window.selectMountProvider = function(provider) {
  const modal = byId('tvSizeModal');
  modal.mountProvider = provider;
  
  // Update UI
  document.querySelectorAll('.mount-provider-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.provider === provider);
  });
  
  // Show/hide mount guide and enable next steps
  const mountGuide = byId('mountGuideSection');
  const quantitySelector = byId('tvQuantitySelector');
  
  if (provider === 'h2s') {
    if (mountGuide) mountGuide.style.display = 'block';
  } else {
    if (mountGuide) mountGuide.style.display = 'none';
  }
  
  // Auto-trigger TV count selection if predefined
  const autoSelectCount = modal.dataset.autoSelectCount;
  if (autoSelectCount) {
    setTimeout(() => setTVCount(parseInt(autoSelectCount)), 100);
  } else if (quantitySelector) {
    quantitySelector.style.display = 'block';
  }
};

window.setTVCount = function(count) {
  const modal = byId('tvSizeModal');
  modal.tvCount = count;
  
  // Initialize config with mount provider (STRICT: no defaults)
  const mountProvider = modal.mountProvider;
  if (!mountProvider) {
    logger.error('[TV Modal] setTVCount called before mount provider selected');
    return;
  }
  
  modal.tvConfigs = Array(count).fill(null).map(() => ({
    size: '',
    mountType: mountProvider === 'h2s' ? '' : 'customer_provided'
  }));
  
  // Update UI
  document.querySelectorAll('.tv-count-btn').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.count) === count);
  });
  
  // Show config container
  const container = byId('tvConfigsContainer');
  container.style.display = 'block';
  
  // Build TV config forms (using mountProvider from above)
  
  const tvCards = [];
  for (let idx = 0; idx < count; idx++) {
    const mountSection = mountProvider === 'h2s' ? 
      `<div>
        <label style="display:block; font-weight:600; margin-bottom:8px; font-size:13px; color:#374151;">
          Mount Type <span style="font-weight:400; color:#6b7280;">(Choose based on room usage)</span>
        </label>
        <select id="tvMount_${idx}" onchange="updateTVConfig(${idx}, 'mountType', this.value)">
          <option value="">Select mount type...</option>
          <option value="fixed">Fixed/Flat - Flush against wall (Bedrooms, kids' rooms)</option>
          <option value="tilt">Tilt +$25 - Angle down to reduce glare (Above eye level)</option>
          <option value="full_motion">Full Motion +$75 - Swivel & extend (Living room, open concept)</option>
        </select>
        <div style="margin-top:8px; padding:10px; background:#f0f9ff; border-left:3px solid var(--azure); border-radius:4px; font-size:12px; color:#1e40af;">
          <strong>Tip:</strong> Full motion mounts are perfect when you need to adjust viewing angles from different seating areas. Fixed/flat mounts work great for bedrooms where the TV faces one direction.
        </div>
      </div>` :
      `<div style="padding:12px; background:#d1fae5; border-left:3px solid #10b981; border-radius:4px; font-size:13px; color:#065f46;">
        <strong>Customer Providing Mount</strong> - Please ensure your mount is compatible with this TV size and rated for your wall type.
      </div>`;
    
    tvCards.push(`
      <div class="tv-config-card">
        <div style="font-weight:700; font-size:15px; color:var(--cobalt); margin-bottom:16px; display:flex; align-items:center; gap:8px;">
          <span>TV #${idx + 1}</span>
          <span style="font-weight:400; color:#6b7280; font-size:13px;">(Which room is this TV in?)</span>
        </div>
        
        <div style="margin-bottom:${mountProvider === 'h2s' ? '12px' : '0'};">
          <label style="display:block; font-weight:600; margin-bottom:8px; font-size:13px; color:#374151;">
            Screen Size
          </label>
          <select id="tvSize_${idx}" onchange="updateTVConfig(${idx}, 'size', this.value)">
            <option value="">Select size...</option>
            <option value="32-43">32" - 43"</option>
            <option value="44-54">44" - 54"</option>
            <option value="55-64">55" - 64"</option>
            <option value="65-74">65" - 74"</option>
            <option value="75-85">75" - 85"</option>
            <option value="86+">86" and larger</option>
          </select>
        </div>
        
        ${mountSection}
      </div>
    `);
  }
  
  container.innerHTML = `
    <div style="margin-top:24px; margin-bottom:24px;">
      ${tvCards.join('')}
    </div>
  `;
  
  validateTVConfigs();
  
  // Check scroll indicator after adding TV configs
  setTimeout(() => checkModalScroll(), 50);
};

window.updateTVConfig = function(index, field, value) {
  const modal = byId('tvSizeModal');
  modal.tvConfigs[index][field] = value;
  validateTVConfigs();
};

function validateTVConfigs() {
  const modal = byId('tvSizeModal');
  const confirmBtn = byId('confirmTVSizeBtn');
  const btnText = byId('confirmBtnText');
  
  if (!modal.tvConfigs || modal.tvConfigs.length === 0) {
    confirmBtn.disabled = true;
    btnText.textContent = 'Add to Cart';
    return;
  }
  
  // Check if mount provider is selected
  const mountProvider = modal.mountProvider;
  if (!mountProvider) {
    confirmBtn.disabled = true;
    btnText.textContent = 'Select Mount Provider First';
    return;
  }
  
  // Check if all TVs are configured (size required, mountType required only if H2S providing)
  const allConfigured = modal.tvConfigs.every(config => {
    const sizeValid = config.size && config.size !== '';
    const mountValid = mountProvider === 'customer' ? true : (config.mountType && config.mountType !== '');
    return sizeValid && mountValid;
  });
  
  confirmBtn.disabled = !allConfigured;
  
  if (allConfigured) {
    // Get base price and apply tier pricing for Multi-Room
    const packageId = modal.dataset.packageId;
    let basePrice = parseFloat(modal.dataset.packagePrice);
    
    if (packageId === 'tv_multi') {
      if (modal.tvConfigs.length === 3) {
        basePrice = 699; // 3 TVs = $699
      } else if (modal.tvConfigs.length === 4) {
        basePrice = 899; // 4 TVs = $899
      }
    }
    
    // Calculate total price with mount upcharges (only if H2S providing)
    const mountUpcharges = mountProvider === 'h2s' 
      ? modal.tvConfigs.reduce((sum, config) => sum + (MOUNT_PRICING[config.mountType] || 0), 0)
      : 0;
    
    const totalPrice = basePrice + mountUpcharges;
    
    btnText.textContent = `Add to Cart - $${totalPrice}`;
  } else {
    btnText.textContent = 'Add to Cart';
  }
}

function closeTVSizeModal() {
  const modal = byId('tvSizeModal');
  if (modal) {
    modal.classList.remove('show');
    
    // Clean up keyboard listener
    if (modal._keyboardHandler && 'visualViewport' in window) {
      window.visualViewport.removeEventListener('resize', modal._keyboardHandler);
    }
    
    // Unlock body scroll and restore position
    const scrollY = modal._savedScrollY || 0;
    if (modal._scrollLockHandler) {
      try { window.removeEventListener('scroll', modal._scrollLockHandler); } catch(_) {}
      modal._scrollLockHandler = null;
    }
    document.documentElement.classList.remove('modal-open');
    document.body.classList.remove('modal-open');
    document.body.style.top = '';
    window.scrollTo(0, scrollY);
  }
}

// Toggle mount guide visibility
window.toggleMountGuide = function() {
  const content = byId('mountGuideContent');
  const icon = byId('guideToggleIcon');
  if (content && icon) {
    const isHidden = content.style.display === 'none';
    content.style.display = isHidden ? 'block' : 'none';
    icon.style.transform = isHidden ? 'rotate(180deg)' : 'rotate(0deg)';
  }
};

// Detect modal body scroll for indicator
window.checkModalScroll = function() {
  const modalBody = document.querySelector('#tvSizeModal .modal-body');
  if (modalBody) {
    const hasScroll = modalBody.scrollHeight > modalBody.clientHeight;
    modalBody.classList.toggle('has-scroll', hasScroll);
  }
};

function confirmTVSize() {
  const modal = byId('tvSizeModal');
  
  const packageId = modal.dataset.packageId;
  const packageName = modal.dataset.packageName;
  let basePrice = parseFloat(modal.dataset.packagePrice);
  const tvConfigs = modal.tvConfigs;
  const mountProvider = modal.mountProvider;
  
  // Validate mount provider is selected
  if (!mountProvider) {
    alert('Please select whether you have mounts or need us to provide them');
    return;
  }
  
  if (!tvConfigs || tvConfigs.length === 0) {
    alert('Please select number of TVs');
    return;
  }
  
  // Validate all configs
  const allValid = tvConfigs.every(c => {
    const sizeValid = c.size && c.size !== '';
    const mountValid = mountProvider === 'customer' ? true : (c.mountType && c.mountType !== '');
    return sizeValid && mountValid;
  });
  
  if (!allValid) {
    alert('Please configure all TVs (size' + (mountProvider === 'h2s' ? ' and mount type' : '') + ')');
    return;
  }
  
  // Apply tier pricing for Multi-Room package
  if (packageId === 'tv_multi') {
    if (tvConfigs.length === 3) {
      basePrice = 699; // 3 TVs = $699
    } else if (tvConfigs.length === 4) {
      basePrice = 899; // 4 TVs = $899
    }
  }
  
  // Calculate total price with mount upcharges (only if H2S providing)
  const mountUpcharges = mountProvider === 'h2s'
    ? tvConfigs.reduce((sum, config) => sum + (MOUNT_PRICING[config.mountType] || 0), 0)
    : 0;
  
  const totalPrice = basePrice + mountUpcharges;
  
  // Build items_json for backend (one item per TV)
  const items = tvConfigs.map((config, idx) => {
    // Determine team requirements
    let requiresTeam = false;
    let teamRecommended = false;
    let teamReason = '';
    
    if (config.size === '75-85' || config.size === '86+') {
      requiresTeam = true;
      teamReason = `Large TV (${config.size}) - safety requirement`;
    } else if (config.size === '65-74') {
      teamRecommended = true;
      teamReason = `Heavy TV (${config.size}) - team recommended`;
    }
    
    // Price per TV (base price divided by count + mount upcharge if H2S providing)
    const perTVBase = basePrice / tvConfigs.length;
    const mountUpcharge = mountProvider === 'h2s' ? (MOUNT_PRICING[config.mountType] || 0) : 0;
    const itemPrice = perTVBase + mountUpcharge;
    
    return {
      bundle_id: packageId,
      service_name: packageName,
      qty: 1,
      unit_price: itemPrice,
      line_total: itemPrice,
      metadata: {
        tv_size: config.size,
        mount_type: config.mountType || 'customer_provided',
        mount_provider: mountProvider,
        mount_upcharge: mountUpcharge,
        mounts_needed: mountProvider === 'h2s' ? 1 : 0,
        requires_team: requiresTeam,
        team_recommended: teamRecommended,
        team_reason: teamReason,
        min_team_size: requiresTeam ? 2 : 1,
        tv_number: idx + 1,
        total_tvs: tvConfigs.length
      }
    };
  });
  
  // Build consolidated metadata
  const metadata = {
    tv_count: tvConfigs.length,
    mount_provider: mountProvider,
    items_json: items,
    total_mount_upcharges: mountUpcharges,
    original_price: basePrice,
    final_price: totalPrice
  };
  
  logger.log('[TV Modal] Confirming', tvConfigs.length, 'TVs with mount provider:', mountProvider);
  logger.log('[TV Modal] Configs:', tvConfigs);
  logger.log('[TV Modal] Metadata:', metadata);
  logger.log('[TV Modal] Items:', items);
  
  // Close modal
  closeTVSizeModal();
  
  // Add to cart with updated price and metadata
  setTimeout(() => {
    addPackageDirectToCart(packageId, packageName, totalPrice, metadata);
  }, 100);
}

function addPackageToCart(){
  if(!currentPackage) return;
  
  const curKey = currentPackage.id || currentPackage.bundle_id;
  const existing = cart.find(item => {
    const itemKey = item.id || item.bundle_id;
    return item.type === 'package' && itemKey === curKey;
  });
  if(existing){
    existing.qty++;
  }else{
    const normalized = { ...currentPackage };
    if(!normalized.id && normalized.bundle_id) normalized.id = normalized.bundle_id;
    // CRITICAL: Ensure stripe_price_id is included for checkout
    if (!normalized.stripe_price_id && currentPackage.stripe_price_id) {
      normalized.stripe_price_id = currentPackage.stripe_price_id;
    }
    cart.push({ type:'package', ...normalized, qty:1 });
  }
  
  // Track add to cart
  h2sTrack('AddToCart', {
    product_id: currentPackage.id,
    product_name: currentPackage.name,
    quantity: 1,
    price: currentPackage.price,
    currency: 'USD'
  });
  
  saveCart();
  closeModal();
  toggleCart();
}

// === CART MODEL ===
function saveCart(){
  logger.log('[Cart] Saving cart with', cart.length, 'items:', cart);
  try {
    localStorage.setItem('h2s_cart', JSON.stringify(cart));
    logger.log('[Cart] Successfully saved to localStorage');
  } catch(err) {
    logger.warn('Failed to save cart to localStorage (may be in private mode):', err);
    // Cart still works in memory, just won't persist across page reloads
  }
  updateCartBadge();
  paintCart();
  syncCartToUrl();
}

function loadCart(){
  try{ 
    const raw = localStorage.getItem('h2s_cart');
    logger.log('[Cart] Raw localStorage data:', raw);
    if(!raw) return [];
    
    const loaded = JSON.parse(raw);
    logger.log('[Cart] Parsed cart data:', loaded);
    if(!Array.isArray(loaded)) {
      logger.warn('[Cart] Cart data is not an array, returning empty');
      return [];
    }
    
    // Clean up any stale/invalid items on load
    // NOTE: Be tolerant of missing price values &mdash; price is authoritative from server catalog.
    const cleaned = loaded.filter(item => {
      const hasValidQty = Number(item.qty || 0) > 0;
      const hasId = !!(item.id || item.service_id || item.bundle_id);
      if(!hasValidQty || !hasId){
        logger.warn('[Cart] Removing invalid item on load (bad qty or missing id):', item);
        return false;
      }
      return true;
    });
    
    // If we cleaned anything, save the cleaned cart
    if(cleaned.length !== loaded.length){
      localStorage.setItem('h2s_cart', JSON.stringify(cleaned));
    }
    
    return cleaned;
  }catch(_){ 
    return []; 
  }
}

function updateQuantity(idx, delta){
  if(!cart[idx]) return;
  
  const newQty = (Number(cart[idx].qty)||1) + delta;
  
  if(newQty <= 0){
    cart.splice(idx, 1);
  }else{
    cart[idx].qty = newQty;
  }
  
  saveCart();
}

// === HERO REVIEW CAROUSEL ===
let heroReviewInterval;
let currentHeroReviewIndex = 0;
// Initialize with fallback data IMMEDIATELY so LCP is fast
heroReviews = [
    {
      text: "Professional, on-time, and clean installation.",
      author: "Recent Customer",
      stars: 5
    },
    {
      text: "Had 4 cameras installed. The app setup was seamless and now I have total peace of mind.",
      author: "Mike T.",
      stars: 5
    },
    {
      text: "Quick, clean, professional. They hid all the wires perfectly. Looks like it came with the house!",
      author: "Jennifer L.",
      stars: 5
    },
    {
      text: "Same-day service saved me! TV mounted and streaming setup done in under an hour.",
      author: "David R.",
      stars: 5
    },
    {
      text: "The whole-home security package was a game changer. Professional install, great support.",
      author: "Amanda K.",
      stars: 5
    }
];

// Fetch real reviews from Vercel endpoint (Background)
async function loadHeroReviews() {
  try {
    const reviewsUrl = API.replace('/shop', '/reviews') + '?limit=5&onlyVerified=true';
    // logger.log('[Hero Reviews] Fetching from:', reviewsUrl);
    
    const res = await fetch(reviewsUrl, {
      cache: 'default' // Use CDN cache
    });
    const data = await res.json();
    
    if (data.ok && data.reviews && data.reviews.length > 0) {
      const newReviews = data.reviews.slice(0, 5).map(r => ({
        text: r.text && r.text.trim() ? r.text.trim() : '',
        author: r.name || 'Customer',
        stars: r.rating || 5
      })).filter(r => r.text.length > 0);
      
      if(newReviews.length > 0){
          heroReviews = newReviews;
          // logger.log('[OK] Loaded', heroReviews.length, 'REAL hero reviews from API');
          renderHeroReviews(); // Re-render with real data
      }
    }
  } catch (err) {
    // logger.warn('[Hero Reviews] Background fetch failed, keeping fallbacks:', err);
  }
}

function renderHeroReviews(){
  const container = byId('heroReviews');
  if (!container || heroReviews.length === 0) return;
  
  // Build review slides HTML
  const reviewsHTML = heroReviews.map((review, index) => {
    const hasText = review.text && review.text.trim().length > 0;
    return `
    <div class="hero-review-slide ${index === currentHeroReviewIndex ? 'active' : ''}" data-index="${index}">
      <div class="hero-review-stars">${'&#9733;'.repeat(review.stars)}</div>
      ${hasText ? `<div class="hero-review-text">"${review.text}"</div>` : ''}
      <div class="hero-review-author">&mdash; ${review.author}</div>
    </div>
  `;
  }).join('');
  
  const dotsHTML = heroReviews.map((_, index) => `
    <div class="hero-review-dot ${index === currentHeroReviewIndex ? 'active' : ''}" data-index="${index}" onclick="goToHeroReview(${index})"></div>
  `).join('');
  
  container.innerHTML = reviewsHTML + `<div class="hero-review-dots">${dotsHTML}</div>`;
  
  container.onclick = () => {
    window.location.href = 'https://home2smart.com/reviews';
  };
}

function initHeroReviews() {
  // OPTIMIZATION: If static content is already present (Instant Paint), do not re-render
  const container = document.getElementById('heroReviews');
  const hasStaticContent = container && container.querySelector('.hero-review-slide.active');
  if (!hasStaticContent) renderHeroReviews();

  // Defer auto-rotation: start only after idle or first interaction
  const startRotation = () => {
    if (heroReviewInterval) clearInterval(heroReviewInterval);
    heroReviewInterval = setInterval(nextHeroReview, 5000);
  };
  const interactionHandler = () => { startRotation(); window.removeEventListener('pointerdown', interactionHandler, {passive:true}); };
  window.addEventListener('pointerdown', interactionHandler, {passive:true, once:true});
  if('requestIdleCallback' in window){
    requestIdleCallback(startRotation, {timeout:5000});
  } else {
    setTimeout(startRotation, 5000);
  }

  // Delay API fetch further (6s) to reduce network contention around LCP/TBT
  setTimeout(() => loadHeroReviews(), 6000);
}

function nextHeroReview() {
  currentHeroReviewIndex = (currentHeroReviewIndex + 1) % heroReviews.length;
  showHeroReview(currentHeroReviewIndex);
}

function goToHeroReview(index) {
  // Stop propagation so clicking dots doesn't navigate away
  event?.stopPropagation();
  
  currentHeroReviewIndex = index;
  showHeroReview(index);
  
  // Reset auto-rotate timer
  if (heroReviewInterval) clearInterval(heroReviewInterval);
  heroReviewInterval = setInterval(nextHeroReview, 5000);
}

function showHeroReview(index) {
  const slides = document.querySelectorAll('.hero-review-slide');
  const dots = document.querySelectorAll('.hero-review-dot');
  
  slides.forEach((slide, i) => {
    slide.classList.toggle('active', i === index);
  });
  
  dots.forEach((dot, i) => {
    dot.classList.toggle('active', i === index);
  });
}

function renderReviews() {
  const track = byId('reviewTrack');
  const nav = byId('reviewNav');
  
  if (!track || !nav) {
    // logger.error('[Reviews] Carousel DOM elements not found');
    return;
  }
  
  if (allReviews.length === 0) {
    track.innerHTML = '<p style="text-align: center; color: var(--muted); padding: 40px;">No reviews available</p>';
    return;
  }
  
  track.innerHTML = allReviews.map((review, index) => {
    // ACTUAL API FIELD NAMES: display_name, review_text, services_selected, rating, timestamp_iso
    const displayName = review.display_name || 'Customer';
    const initials = displayName
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
    
    const rating = Number(review.rating || 5);
    const stars = '?'.repeat(rating);
    const greyStars = '?'.repeat(5 - rating);
    
    // Escape HTML to prevent XSS
    const escapedName = displayName.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const escapedText = (review.review_text || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    
    // services_selected is comma-separated string
    const services = review.services_selected ? review.services_selected.split(',')[0].trim() : 'Smart Home Service';
    const escapedService = services.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    
    // Format date EXACTLY like reviews page: "Jan 15, 2025" format
    let formattedDate = '';
    if (review.timestamp_iso) {
      try {
        const date = new Date(review.timestamp_iso);
        formattedDate = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
      } catch(e) {
        formattedDate = '';
      }
    }
    
    return `
      <div class="review-card" data-index="${index}">
        <div class="review-header">
          <div class="review-avatar">${initials}</div>
          <div class="review-meta">
            <div class="review-name">${escapedName}</div>
            <div class="review-stars">${stars}${greyStars}</div>
            ${formattedDate ? `<div class="review-time">${formattedDate}</div>` : ''}
          </div>
        </div>
        <p class="review-text">${escapedText}</p>
        <div class="review-footer">
          <div class="review-service">${escapedService}</div>
          ${review.verified ? '<div class="review-verified">Verified Customer</div>' : ''}
        </div>
      </div>
    `;
  }).join('');
  
  // Create dots for pages, not individual reviews
  const slidesPerView = window.innerWidth >= 1024 ? 3 : window.innerWidth >= 768 ? 2 : 1;
  const totalPages = Math.ceil(allReviews.length / slidesPerView);
  
  nav.innerHTML = Array.from({length: totalPages}, (_, i) => 
    `<div class="review-dot ${i === 0 ? 'active' : ''}" onclick="goToReview(${i})" aria-label="Go to page ${i + 1}"></div>`
  ).join('');
  
  // (reviews rendered log stripped)
}

function startCarousel() {
  if (reviewInterval) clearInterval(reviewInterval);
  
  // Only auto-rotate if we have multiple pages of reviews
  const slidesPerView = window.innerWidth >= 1024 ? 3 : window.innerWidth >= 768 ? 2 : 1;
  const totalPages = Math.ceil(allReviews.length / slidesPerView);
  
  if (totalPages <= 1) return;
  
  reviewInterval = setInterval(() => {
    // Move to next page (group of 3)
    reviewIndex++;
    if (reviewIndex >= totalPages) {
      reviewIndex = 0;
    }
    updateCarousel();
  }, 5000);
  
  // Pause on hover
  const carousel = document.querySelector('.review-carousel');
  if (carousel) {
    carousel.addEventListener('mouseenter', () => {
      if (reviewInterval) clearInterval(reviewInterval);
    });
    carousel.addEventListener('mouseleave', () => {
      startCarousel();
    });
  }
}

function goToReview(pageIndex) {
  reviewIndex = pageIndex;
  updateCarousel();
  startCarousel(); // Reset timer
}

function updateCarousel() {
  const track = byId('reviewTrack');
  if (!track || allReviews.length === 0) return;
  // Batch DOM writes in rAF to avoid layout thrashing
  const vw = window.innerWidth;
  const slidesPerView = vw >= 1024 ? 3 : vw >= 768 ? 2 : 1;
  const totalPages = Math.ceil(allReviews.length / slidesPerView);
  const safeIndex = Math.min(reviewIndex, totalPages - 1);
  const offset = -safeIndex * 100;
  requestAnimationFrame(() => {
    track.style.transform = `translateX(${offset}%)`;
    const dots = document.querySelectorAll('.review-dot');
    dots.forEach((dot, i) => {
      const active = (i === safeIndex);
      if (active !== dot.classList.contains('active')) {
        dot.classList.toggle('active', active);
      }
    });
  });
}

// Debounced resize handler for carousel
let resizeTimeout;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(() => {
    if (allReviews.length > 0) updateCarousel();
  }, 100);
});

// Extended reviews disabled for performance; hero section links to full reviews page.

function encodeCartToUrl(cartItems = cart){
  if(!cartItems || !cartItems.length) return '';
  return cartItems.map(item => {
    if(item.type === 'package') return `pkg:${item.id}*${item.qty}`;
   
    const svc = item.service_id || '';
    const opt = item.option_id ? `:${item.option_id}` : '';
    return `${svc}${opt}*${item.qty}`;
  }).join(',');
}

function decodeCartFromUrl(cartParam){
  if(!cartParam) return [];
  const items = String(cartParam).split(',');
  return items.map(item => {
    const parts = item.split('*');
    const qty = Number(parts[1]) || 1;
    const servicePart = parts[0];
    
    if(servicePart.startsWith('pkg:')){
      const bundle_id = servicePart.replace('pkg:', '');
      
      // Look up actual bundle from catalog to get real price
      const bundle = catalog.bundles?.find(b => b.bundle_id === bundle_id);
      
      if(!bundle){
        logger.warn('[Cart] Bundle not found in catalog:', bundle_id);
        return null;
      }
      
      return { 
        type: 'package', 
        id: bundle_id, 
        name: bundle.name || bundle_id,
        price: Number(bundle.bundle_price || 0),
        qty 
      };
    }
    
    const [service_id, option_id] = servicePart.split(':');
    return { service_id, qty, option_id: option_id || null };
  }).filter(item => item !== null && (item.service_id || item.id));
}

function syncCartToUrl(){
  // DISABLED: Cart persistence via URL causes issues on refresh
  // Cart is saved to localStorage which is more reliable
  // If you need shareable cart links, use a different approach
  return;
  
  /* OLD CODE:
  const url = new URL(location.href);
  if(cart.length){
    url.searchParams.set('cart', encodeCartToUrl());
  }else{
    url.searchParams.delete('cart');
  }
  history.replaceState({}, '', url.toString());
  */
}

function saveUser(){
  try {
    localStorage.setItem('h2s_user', JSON.stringify(user||{}));
  } catch(err) {
    logger.warn('Failed to save user to localStorage:', err);
  }
  renderSigninState();
}

function loadUser(){
  try{ return JSON.parse(localStorage.getItem('h2s_user')||'{}'); }catch(_){ return {}; }
}

function updateCartBadge(){
  const count = cart.reduce((n,l)=> n + Number(l.qty||0), 0);
  byId('cartCount').textContent = count;
}

function cartSubtotal(lines=cart){
  return lines.reduce((sum, ln)=>{
    if(ln.type === 'package'){
      return sum + (Number(ln.price||0) * Number(ln.qty||1));
    }
    // For future service items
    return sum;
  }, 0);
}

// === CART PAINT ===
function paintCart(){
  const items = byId('cartItems');
  const emptyState = byId('cartEmpty');
  const subtotal = byId('cartSubtotal');
  const itemCount = byId('cartItemCount');
  // (log stripped)
  
  if(!items || !emptyState || !subtotal) return;
  
  // SAFETY CHECK
  if(!cart || !Array.isArray(cart)) cart = [];
  
  if(!cart.length){
    logger.log('[Cart] Cart is empty, showing empty state');
    emptyState.hidden = false;
    items.innerHTML = '';

    // Zero out totals + remove any promo "residue" when cart is empty.
    // Use querySelectorAll([id="..."]) in case the DOM has duplicate IDs.
    const setTextAll = (id, text) => {
      try { document.querySelectorAll(`[id="${id}"]`).forEach(el => { el.textContent = text; }); } catch(_) {}
    };
    const setDisplayAll = (id, display) => {
      try { document.querySelectorAll(`[id="${id}"]`).forEach(el => { el.style.display = display; }); } catch(_) {}
    };

    setTextAll('cartSubtotal', '$0.00');
    setTextAll('grandTotal', '$0.00');
    setTextAll('promoAmount', '-$0.00');
    setTextAll('rawSubtotalAmount', '$0.00');
    setTextAll('totalLabel', 'Total');

    // Direct resets as a backup (in case of unexpected DOM changes)
    try { subtotal.textContent = '$0.00'; } catch(_) {}
    try { const gt = byId('grandTotal'); if(gt) gt.textContent = '$0.00'; } catch(_) {}

    // Ensure promo/raw subtotal lines and subtotal line are hidden when cart is empty
    setDisplayAll('promoLine', 'none');
    setDisplayAll('rawSubtotalLine', 'none');
    setDisplayAll('cartSubtotalLine', 'none');

    // Clear promo messaging so we don't show "Discount applied" on an empty cart
    setTextAll('promoMsg', '');

    const checkoutBtn = byId('checkoutBtn');
    if(checkoutBtn) checkoutBtn.disabled = true;
    if(itemCount) itemCount.textContent = '0 items';

    // Refresh offer message to avoid stale TV count messaging
    try { h2sRenderOfferMessage(); } catch(_){ }
    return;
  }
  
  logger.log('[Cart] Rendering', cart.length, 'items');
  emptyState.hidden = true;
  
  let cartSubtotalVal = 0;
  let totalQty = 0;
  
  items.innerHTML = cart.map((item, idx) => {
    const qty = Number(item.qty||1);
    // CRITICAL: Always use the stored item.price from cart
    // This price already includes any mount upcharges, dynamic pricing, etc.
    // Never lookup catalog as it will show wrong totals for configured items
    const itemPrice = Number(item.price||0);
    const itemTotal = itemPrice * qty;
    logger.log('[Cart] Rendering item:', item.name, 'qty:', qty, 'price:', itemPrice, 'total:', itemTotal);
    
    cartSubtotalVal += itemTotal;
    totalQty += qty;
    
    // Build detailed metadata display
    const metadata = item.metadata || {};
    let metadataHTML = '';
    
    // Check if this is a multi-TV configuration with items_json
    if (metadata.items_json && Array.isArray(metadata.items_json) && metadata.items_json.length > 0) {
      // MULTI-TV DETAILED BREAKDOWN
      const tvCount = metadata.tv_count || metadata.items_json.length;
      const mountProvider = metadata.items_json[0]?.metadata?.mount_provider || 'h2s';
      const totalUpcharges = metadata.total_mount_upcharges || 0;
      
      // Use the metadata's original_price (tier-adjusted base) or calculate from final price
      const basePrice = metadata.original_price || (itemPrice - totalUpcharges);
      
      metadataHTML = `
        <div style="margin-top:12px;padding:12px;background:#f8f9fb;border-radius:8px;border-left:3px solid var(--cobalt);">
          <div style="font-weight:700;color:var(--cobalt);margin-bottom:8px;display:flex;align-items:center;gap:8px;">
            <span>${tvCount} TV Installation${tvCount > 1 ? 's' : ''}</span>
            ${mountProvider === 'customer' ? '<span style="background:#10b981;color:white;padding:2px 8px;border-radius:4px;font-size:11px;">Customer Mounts</span>' : ''}
          </div>
          
          ${metadata.items_json.map((tvItem, tvIdx) => {
            const tvMeta = tvItem.metadata || {};
            const tvSize = tvMeta.tv_size || 'Unknown';
            const mountType = tvMeta.mount_type || 'fixed';
            const mountUpcharge = tvMeta.mount_upcharge || 0;
            const tvNumber = tvMeta.tv_number || (tvIdx + 1);
            
            const mountTypeLabels = {
              fixed: 'Fixed/Flat',
              tilt: 'Tilt',
              full_motion: 'Full Motion'
            };
            const mountLabel = mountTypeLabels[mountType] || mountType;
            
            return `
              <div style="padding:8px;background:white;border-radius:6px;margin-bottom:6px;border:1px solid #e5e7eb;">
                <div style="display:flex;justify-content:space-between;align-items:start;">
                  <div>
                    <div style="font-weight:600;font-size:13px;color:#111;">TV #${tvNumber}</div>
                    <div style="font-size:12px;color:#6b7280;margin-top:2px;">Size: ${tvSize}"</div>
                    ${mountProvider === 'h2s' ? `<div style="font-size:12px;color:#6b7280;">Mount: ${mountLabel}</div>` : ''}
                  </div>
                  ${mountProvider === 'h2s' && mountUpcharge > 0 ? `
                    <div style="text-align:right;">
                      <div style="font-size:11px;color:#6b7280;">Mount upgrade</div>
                      <div style="font-weight:600;color:var(--cobalt);font-size:13px;">+$${mountUpcharge}</div>
                    </div>
                  ` : ''}
                </div>
              </div>
            `;
          }).join('')}
          
          <div style="margin-top:12px;padding-top:10px;border-top:1px solid #e5e7eb;display:flex;justify-content:space-between;font-size:12px;">
            <div style="color:#6b7280;">
              ${mountProvider === 'h2s' ? `
                <div>Base Package: $${basePrice.toFixed(2)}</div>
                ${totalUpcharges > 0 ? `<div>Mount Upgrades: +$${totalUpcharges.toFixed(2)}</div>` : ''}
              ` : `<div>Installation Only (customer mounts)</div>`}
            </div>
            <div style="font-weight:700;color:var(--cobalt);">Total: $${itemPrice.toFixed(2)}</div>
          </div>
        </div>
      `;
    } else if (metadata.tv_size || metadata.mount_type || metadata.requires_team) {
      // SINGLE TV OR SIMPLE METADATA
      metadataHTML = '<div style="margin-top:8px;padding:10px;background:#f8f9fb;border-radius:6px;border-left:3px solid var(--azure);font-size:12px;">';
      
      if (metadata.tv_size) {
        metadataHTML += `<div style="color:var(--cobalt);font-weight:600;margin-bottom:4px;">TV Size: ${escapeHtml(metadata.tv_size)}"</div>`;
      }
      
      if (metadata.mount_type) {
        const mountTypeLabels = {
          fixed: 'Fixed/Flat Mount',
          tilt: 'Tilt Mount',
          full_motion: 'Full Motion Mount'
        };
        const mountLabel = mountTypeLabels[metadata.mount_type] || metadata.mount_type;
        const mountUpcharge = metadata.mount_upcharge || 0;
        
        metadataHTML += `<div style="color:#374151;font-weight:500;">${mountLabel}${mountUpcharge > 0 ? ` <span style="color:var(--cobalt);font-weight:700;">(+$${mountUpcharge})</span>` : ''}</div>`;
      }
      
      if (metadata.mount_provider === 'customer') {
        metadataHTML += `<div style="color:#10b981;font-weight:600;margin-top:4px;">Customer-provided mount</div>`;
      }
      
      // Removed two-tech requirement/recommendation messaging from cart UI
      
      metadataHTML += '</div>';
    }
    
    return `
      <div class="cart-item">
        <div class="cart-item-info">
          <div class="cart-item-name">${escapeHtml(item.name||item.id||'Item')}</div>
          <div class="cart-item-price">${money(itemPrice)} each</div>
          ${metadataHTML}
          
          <div class="cart-qty-controls">
            <button 
              class="cart-qty-btn"
              onclick="updateQuantity(${idx}, -1)"
              aria-label="Decrease quantity"
            >&minus;</button>
            
            <span class="cart-qty-value">${qty}</span>
            
            <button 
              class="cart-qty-btn"
              onclick="updateQuantity(${idx}, 1)"
              aria-label="Increase quantity"
            >+</button>
          </div>
        </div>
        
        <div class="cart-item-right">
          <div class="cart-item-total">${money(itemTotal)}</div>
          <button 
            class="cart-remove-btn"
            onclick="removeFromCart(${idx})"
          >Remove</button>
        </div>
      </div>
    `;
  }).join('');
  
  // (log stripped)
  
  subtotal.textContent = money(cartSubtotalVal);
  if(itemCount) itemCount.textContent = `${totalQty} item${totalQty === 1 ? '' : 's'}`;
  
  // Reset promo display (will be re-enabled by updatePromoEstimate if code is valid)
  const rawLine = byId('rawSubtotalLine');
  const promoLine = byId('promoLine');
  const totalLabel = byId('totalLabel');
  const cartSubtotalLine = byId('cartSubtotalLine');
  
  // Always show regular subtotal by default, hide promo lines
  if(cartSubtotalLine) cartSubtotalLine.style.display = 'flex';
  if(rawLine) rawLine.style.display = 'none';
  if(promoLine) promoLine.style.display = 'none';
  if(totalLabel) totalLabel.textContent = 'Total';
  
  // Update Grand Total (starts as subtotal, gets updated by promo if applicable)
  const grandTotal = byId('grandTotal');
  if(grandTotal) grandTotal.textContent = money(cartSubtotalVal);
  
  renderSigninState();

  // Promo code wiring (validate via backend and persist)
  try{
    const promoInput = byId('promoCode');
    const promoBtn = byId('applyPromo');
    const promoMsg = byId('promoMsg');
    if(promoInput && promoMsg){
      const saved = localStorage.getItem('h2s_promo_code') || '';
      if(saved && !promoInput.value){
        promoInput.value = saved;
        promoMsg.textContent = 'Saved code will be applied at checkout.';
        promoMsg.style.color = '#0b6e0b';
      }

      // Support ad links like ?promo=NEWYEAR50 (prefill + auto-apply once per session)
      try{
        const qs = new URLSearchParams(window.location.search || '');
        const urlCode = (qs.get('promo') || qs.get('promotion_code') || qs.get('code') || '').trim();
        if(urlCode){
          const normalized = urlCode.toUpperCase();
          const already = sessionStorage.getItem('h2s_url_promo_applied') || '';
          if(already !== normalized){
            promoInput.value = normalized;
            promoMsg.textContent = 'Applying promo from link...';
            promoMsg.style.color = '#0b6e0b';
            sessionStorage.setItem('h2s_url_promo_applied', normalized);
            // Click Apply to reuse existing validation + estimate logic.
            setTimeout(() => { try{ promoBtn && promoBtn.click(); }catch(_){} }, 0);
          }
        }
      }catch(_){ /* ignore URL promo */ }
    }
    if(promoBtn){
      promoBtn.onclick = async () => {
        const code = (byId('promoCode')?.value || '').trim();
        if(!code){
          if(promoMsg){ promoMsg.textContent = 'Enter a promo code'; promoMsg.style.color = '#c33'; }
          return;
        }
        const prev = promoBtn.textContent;
        promoBtn.disabled = true; promoBtn.textContent = 'Checking...';
        try{
          // First validate code generically
          const baseUrl = API.replace('/api/shop','/api/promo_validate') + '?code=' + encodeURIComponent(code);
          const resp = await fetch(baseUrl);
          if (!resp.ok && resp.status === 0) {
            // CORS error - backend blocks this domain
            if(promoMsg){ promoMsg.textContent = 'Cannot connect to server. Contact support.'; promoMsg.style.color = '#c33'; }
            logger.error('[Promo] CORS error - backend does not allow this origin');
            return;
          }
          const data = await resp.json();
          if(!(data && data.ok && data.valid)){
            localStorage.removeItem('h2s_promo_code');
            if(promoMsg){ promoMsg.textContent = 'Invalid or expired code'; promoMsg.style.color = '#c33'; }
          } else {
            // Save and then check applicability against current cart
            localStorage.setItem('h2s_promo_code', (data.promo?.code||code));
            if(promoMsg){
              const c = data.promo?.coupon||{};
              let desc = '';
              if(c.percent_off){ desc = `${c.percent_off}% off`; }
              else if(c.amount_off){ desc = `${money((c.amount_off||0)/100)} off`; }
              promoMsg.textContent = `Code recognized${desc?`: ${desc}`:''}. Applying...`;
              promoMsg.style.color = '#0b6e0b';
            }
            // CRITICAL: Wait for promo estimate to complete before showing success
            await updatePromoEstimate();
            try { h2sRenderOfferMessage(); } catch(_) {}
            logger.log('[Promo] Estimate update completed');
          }
        }catch(e){
          if(promoMsg){ promoMsg.textContent = 'Could not validate code. Try again.'; promoMsg.style.color = '#c33'; }
        }finally{
          promoBtn.disabled = false; promoBtn.textContent = prev;
        }
      };
    }
  }catch(_){ /* ignore promo wiring errors */ }
  
  // Update recommendation panels
  renderBundlePanel();
  queueRenderRecsPanel();

  // Update promo estimate whenever cart repaints (await to ensure it completes)
  updatePromoEstimate().catch(e => logger.warn('[Promo] Update failed:', e));

  // Offer message refresh
  try { h2sRenderOfferMessage(); } catch(_) {}
}

async function updatePromoEstimate(){
  try{
    const promoLine = byId('promoLine');
    const promoAmount = byId('promoAmount');
    const promoMsg = byId('promoMsg');
    const cartSubtotal = byId('cartSubtotal');
    const totalLabel = byId('totalLabel');
    const rawLine = byId('rawSubtotalLine');
    const rawAmount = byId('rawSubtotalAmount');
    
    if(!promoLine || !promoAmount) {
      logger.warn('[Promo] Missing promo UI elements');
      return;
    }
    
    // Reset to default state first
    if(totalLabel) totalLabel.textContent = 'Total';
    if(rawLine) rawLine.style.display = 'none';
    
    const code = localStorage.getItem('h2s_promo_code') || '';
    if(!code){ 
      promoLine.style.display = 'none'; 
      return; 
    }

    logger.log('[Promo] Found code in localStorage:', code);

    // Build line_items from current cart (ALL items including hardware/addons)
    const line_items = (cart||[]).map(item => {
      // Include ALL cart items (packages, bundles, hardware, addons, etc.)
      
      // Try to find bundle info if it's a package/bundle type
      const bundle = (item.type === 'package' || item.type === 'bundle') 
        ? (catalog?.bundles||[]).find(b => b.bundle_id === (item.bundle_id || item.id))
        : null;
      
      // Get stripe price ID (if available)
      const priceId = bundle?.stripe_price_id || item.stripe_price_id || 'custom';
      
      // Calculate unit amount (cents)
      let unitAmount = 0;
      
      // For packages: check for dynamic pricing override
      const isDynamic = ['tv_multi', 'cam_basic', 'cam_standard', 'cam_premium'].includes(item.id || item.bundle_id);
      
      if(bundle && !isDynamic && bundle.bundle_price !== undefined && bundle.bundle_price !== null) {
        unitAmount = Math.round(Number(bundle.bundle_price) * 100);
      } else {
        // Use item price for hardware, addons, or dynamic bundles
        unitAmount = Math.round(Number(item.price || 0) * 100);
      }
      
      // Skip items with no price
      if(!unitAmount || unitAmount <= 0) return null;
      
      return { price: priceId, unit_amount: unitAmount, quantity: item.qty || 1 };
    }).filter(Boolean);
    
    if(!line_items.length){ 
      logger.warn('[Promo] No valid line items in cart');
      promoLine.style.display = 'none'; 
      return; 
    }

    logger.log('[Promo] Checking cart with', line_items.length, 'items');
    const resp = await fetch(API, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ __action:'promo_check_cart', promotion_code: code, line_items })});
    if (!resp.ok && resp.status === 0) {
      // CORS error - backend blocks this domain
      logger.error('[Promo] CORS error - backend does not allow this origin');
      promoLine.style.display = 'none';
      if(promoMsg){ promoMsg.textContent = 'Cannot connect to server. Contact support.'; promoMsg.style.color = '#c33'; }
      return;
    }
    const data = await resp.json();
    logger.log('[Promo] Backend response:', data);
    
    if(data && data.ok && data.applicable && data.estimate){
      const savingsCents = Number(data.estimate.savings_cents||0);
      const totalCents = Number(data.estimate.total_cents||0);
      const subtotalCents = Number(data.estimate.subtotal_cents||0);
      
      logger.log('[Promo] ✅ Applicable! Savings:', savingsCents/100, 'Total:', totalCents/100);
      
      // Show promo discount line
      promoAmount.textContent = '-' + money(savingsCents/100);
      const label = byId('promoLineLabel');
      if(label) label.textContent = `Promo (${(data.promotion_code||code).toUpperCase()})`;
      promoLine.style.display = 'flex';
      
      // Hide regular subtotal, show raw subtotal line (uses backend's calculated subtotal)
      const cartSubtotalLine = byId('cartSubtotalLine');
      if(cartSubtotalLine) cartSubtotalLine.style.display = 'none';
      
      if(rawLine && rawAmount){
        rawAmount.textContent = money(subtotalCents/100);
        rawLine.style.display = 'flex';
      }
      
      // Update Grand Total to show final amount after discount
      const grandTotal = byId('grandTotal');
      if(grandTotal){
        grandTotal.textContent = money(totalCents/100);
        // Highlight if 100% off
        if(totalCents === 0){
          grandTotal.style.color = '#10b981';
          grandTotal.style.fontSize = '20px';
        } else {
          grandTotal.style.color = '';
          grandTotal.style.fontSize = '';
        }
      }
      
      if(totalLabel) totalLabel.textContent = 'Grand Total';
      if(promoMsg){ 
        const savings = money(savingsCents/100);
        promoMsg.textContent = `✓ Discount applied! You save ${savings}`;
        promoMsg.style.color = '#0b6e0b'; 
      }
    } else {
      logger.warn('[Promo] Not applicable or invalid response');
      // Promo not applicable - restore regular subtotal display
      const cartSubtotalLine = byId('cartSubtotalLine');
      if(cartSubtotalLine) cartSubtotalLine.style.display = 'flex';
      
      promoLine.style.display = 'none';
      if(rawLine) rawLine.style.display = 'none';
      
      // Reset Grand Total to match subtotal (no discount)
      const cartSubtotal = byId('cartSubtotal');
      const grandTotal = byId('grandTotal');
      if(cartSubtotal && grandTotal){
        grandTotal.textContent = cartSubtotal.textContent;
        grandTotal.style.color = '';
        grandTotal.style.fontSize = '';
      }
      
      if(totalLabel) totalLabel.textContent = 'Total';
      if(promoMsg){ promoMsg.textContent = 'This code does not apply to your current items.'; promoMsg.style.color = '#c33'; }
    }
  }catch(_){
    const promoLine = byId('promoLine'); if(promoLine) promoLine.style.display = 'none';
    const rawLine = byId('rawSubtotalLine'); if(rawLine) rawLine.style.display = 'none';
  }
}

// === LIMITED-TIME OFFER MESSAGING ===
const H2S_OFFER = {
  code: 'NEWYEAR50',
  amountOffUsd: 50,
  freebie: 'Roku',
  tvMountsRequired: 2,
};

function h2sGetPromoCodeUpper(){
  try { return String(localStorage.getItem('h2s_promo_code') || '').trim().toUpperCase(); } catch(_) { return ''; }
}

function h2sCountTvMountsInCart(){
  try {
    let count = 0;
    (cart || []).forEach(function(item){
      const qty = Number(item && item.qty ? item.qty : 1) || 1;

      // Prefer explicit TV-package metadata (multi-TV flows set these)
      const meta = item && item.metadata ? item.metadata : {};
      const tvCount = Number(meta && meta.tv_count ? meta.tv_count : 0);
      if (Number.isFinite(tvCount) && tvCount > 0) {
        count += (tvCount * qty);
        return;
      }

      // Fallback: items_json array (one element per TV)
      const itemsJson = meta && meta.items_json ? meta.items_json : null;
      if (Array.isArray(itemsJson) && itemsJson.length) {
        const inner = itemsJson.reduce((sum, it) => sum + (Number(it && it.qty ? it.qty : 1) || 1), 0);
        if (inner > 0) {
          count += (inner * qty);
          return;
        }
      }

      // Fallback: single-TV metadata on line item
      if (meta && (meta.tv_size || meta.mount_type)) {
        count += qty;
        return;
      }

      // Last resort: name heuristic
      const name = String(item?.name || item?.service_name || item?.service_id || item?.id || '').toLowerCase();
      const isTv = name.indexOf('tv') !== -1;
      const isMount = name.indexOf('mount') !== -1;
      if (isTv && isMount) count += qty;
    });
    return count;
  } catch(_) { return 0; }
}

function h2sRenderOfferMessage(){
  const el = byId('offerMsg');
  if (!el) return;

  const tvCount = h2sCountTvMountsInCart();
  const code = h2sGetPromoCodeUpper();
  const hasCode = code === H2S_OFFER.code;

  const rokuQty = (tvCount >= H2S_OFFER.tvMountsRequired) ? tvCount : 1;
  const rokuLabel = `${rokuQty} ${H2S_OFFER.freebie}${rokuQty === 1 ? '' : 's'}`;

  // Default: show a simple, clear instruction.
  let msg = `New Year offer: Use code ${H2S_OFFER.code} for $${H2S_OFFER.amountOffUsd} off. Free Rokus (one per TV) when booking ${H2S_OFFER.tvMountsRequired}+ TV mounts.`;
  let color = 'var(--muted)';

  if (tvCount >= H2S_OFFER.tvMountsRequired && hasCode) {
    msg = `Offer unlocked: $${H2S_OFFER.amountOffUsd} off + ${rokuLabel} included.`;
    color = '#0b6e0b';
  } else if (hasCode && tvCount < H2S_OFFER.tvMountsRequired) {
    const remaining = H2S_OFFER.tvMountsRequired - tvCount;
    msg = `$${H2S_OFFER.amountOffUsd} off is active. Add ${remaining} more TV mount${remaining === 1 ? '' : 's'} to unlock free Rokus (one per TV).`;
    color = 'var(--muted)';
  } else if (!hasCode && tvCount >= H2S_OFFER.tvMountsRequired) {
    msg = `You have ${tvCount} TV mounts. Enter code ${H2S_OFFER.code} for $${H2S_OFFER.amountOffUsd} off and ${rokuLabel}.`;
    color = 'var(--muted)';
  }

  el.textContent = msg;
  el.style.color = color;
}

function removeFromCart(idx){
  logger.log('[Cart] Removing item at index:', idx);
  try {
    cart.splice(idx, 1);
    saveCart();
  } catch(e) {
    logger.error('[Cart] Error removing item:', e);
  }
}

// === AI RECOMMENDATIONS ===
async function loadAIRecommendations(){
  // CRITICAL: Never run on success pages
  const view = getParam('view');
  if(view === 'shopsuccess') {
    console.log('[AI] Blocked on success page - ai_sales call count: 0');
    return;
  }
  if(!user || !user.email) return;
  
  try{
    const res = await fetch(`${API}?action=ai_sales&email=${encodeURIComponent(user.email)}&mode=recommendations`);
    const data = await res.json();
    
    if(!data.success || !data.ai_analysis || !data.ai_analysis.recommendations) return;
    
    const recs = data.ai_analysis.recommendations.slice(0, 3);
    if(recs.length === 0) return;
    
    renderAIRecommendations(recs);
  }catch(err){
    logger.error('Failed to load AI recommendations:', err);
  }
}

function renderAIRecommendations(recs){
  const panel = byId('aiRecommendationsPanel');
  const container = byId('aiRecommendations');
  if(!panel || !container) return;
  
  const html = recs.map(rec => {
    const service = rec.service || rec.title || 'Recommended Service';
    const reason = rec.thought_spark || rec.reason || '';
    const price = rec.price || 0;
    
    return `
      <div class="ai-rec-card">
        <div class="ai-rec-name">${escapeHtml(service)}</div>
        <div class="ai-rec-reason">"${escapeHtml(reason)}"</div>
        ${price > 0 ? `<div class="ai-rec-price" style="margin-top:8px;font-size:14px;color:var(--muted);">Starting at ${money(price)}</div>` : ''}
      </div>
    `;
  }).join('');
  
  container.innerHTML = html;
  panel.style.display = 'block';
}

// === BUNDLE RECOMMENDATIONS (Smart Swap) ===
function bundlesMatchingCart(){
  const rec = [];
  const bundles = (catalog.bundles||[]).filter(b => b.active!==false);
  
  for(const b of bundles){
    const plan = calcBundlePlan(b);
    if(plan && plan.savings > 0) rec.push(plan);
  }
  
  rec.sort((a,b)=> b.savings - a.savings);
  return rec;
}

function calcBundlePlan(bundle){
  const recipe = (catalog.bundleItems||[]).filter(it => String(it.bundle_id)===String(bundle.bundle_id));
  if(!recipe.length) return null;

  const use = {};
  for(const item of recipe){
    const need = Number(item.required_qty||0);
    const have = cart.find(l => !l.type && String(l.service_id)===String(item.service_id));
    if(!have || Number(have.qty||0) < need) return null;
    use[item.service_id] = need;
  }

  let requiredCost = 0;
  for(const item of recipe){
    const tier = pickTier(item.service_id, Number(item.required_qty||0), null) || pickTier(item.service_id, 1, null);
    const unit = tier ? Number(tier.unit||0) : 0;
    requiredCost += unit * Number(item.required_qty||0);
  }

  const bundlePrice = Number(bundle.bundle_price||0);
  const savings = Math.max(0, requiredCost - bundlePrice);

  const serviceMap = indexBy((catalog.services||[]), 'service_id');
  const lineList = recipe.map(r=>{
    const s = serviceMap[r.service_id];
    return `${Number(r.required_qty||0)} ?&mdash; ${(s && s.name) ? s.name : r.service_id}`;
  });

  return {
    bundle_id: bundle.bundle_id,
    name: bundle.name || bundle.bundle_id,
    image_url: bundle.image_url || '',
    bundle_price: bundlePrice,
    required_cost: requiredCost,
    savings,
    use,
    recipeList: lineList
  };
}

function applyBundleSwap(bundle_id){
  const plan = bundlesMatchingCart().find(p=> p.bundle_id===bundle_id);
  if(!plan) return;
  
  Object.entries(plan.use).forEach(([sid, reqQty])=>{
    const ln = cart.find(l=> !l.type && l.service_id===sid);
    if(!ln) return;
    ln.qty = Math.max(0, Number(ln.qty||0) - Number(reqQty||0));
  });
  
  cart = cart.filter(l=> !( !l.type && Number(l.qty||0)===0 ));
  const existing = cart.find(l=> l.type==='bundle' && l.bundle_id===bundle_id);
  if(existing) existing.qty += 1;
  else {
    // CRITICAL: Include full bundle data for checkout
    const bundleData = catalog.bundles?.find(b => b.bundle_id === bundle_id);
    cart.push({ 
      type:'bundle', 
      bundle_id, 
      qty:1,
      name: bundleData?.title || bundleData?.name || bundle_id,
      price: bundleData?.price || 0,
      stripe_price_id: bundleData?.stripe_price_id
    });
  }
  
  saveCart();
}

function renderBundlePanel(){
  const panel = byId('bundlePanel');
  if(!panel) return;
  
  const suggestions = bundlesMatchingCart();
  if(!suggestions.length){ 
    panel.style.display='none'; 
    panel.innerHTML=''; 
    return; 
  }

  panel.style.display='';
  panel.innerHTML = suggestions.map(p=>`
    <div class="bundle-card">
      <div class="b-head">
        <div class="b-name">${escapeHtml(p.name)}</div>
        <div class="b-save">Save ${money(p.savings)}</div>
      </div>
      <div class="b-list">${p.recipeList.map(escapeHtml).join(' &bull; ')}</div>
      <div class="b-actions">
        <button class="btn btn-primary" data-apply="${p.bundle_id}">Swap & Save</button>
      </div>
    </div>
  `).join('');

  panel.querySelectorAll('[data-apply]').forEach(btn=>{
    btn.onclick = ()=> applyBundleSwap(btn.getAttribute('data-apply'));
  });
}

// (Rule-based recommendations moved to bundles-extra-deferred.js)

// === CHECKOUT ===
function showCheckoutError(msg){
  const errorDiv = byId('checkoutError');
  const errorMsg = byId('checkoutErrorMsg');
  const dismissBtn = byId('dismissError');
  
  if(errorDiv && errorMsg){
    errorMsg.textContent = msg;
    errorDiv.hidden = false;
    
    if(dismissBtn){
      dismissBtn.onclick = ()=> errorDiv.hidden = true;
    }
    
    // Auto-hide after 8 seconds
    setTimeout(()=> errorDiv.hidden = true, 8000);
  }
}


// === DEFERRED HEAVY LOGIC ===
// Loaded only when needed (Account, Checkout, Auth)

// === UTILITY FUNCTIONS FOR DEFERRED BUNDLE ===
function escapeAttr(text) {
  if(!text) return '';
  return String(text).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function showMsg(elId, txt, isError = true) {
  const el = document.getElementById(elId);
  if(el) {
    el.textContent = txt;
    el.style.color = isError ? '#d32f2f' : '#2e7d32';
  }
}

// === CHECKOUT (Deferred) ===
// Load checkout modal logic on demand
window.checkout = function() {
  logger.log('[Checkout] Starting checkout flow...');
  
  // 1. Validate Cart
  if (!cart || cart.length === 0) {
    alert('Your cart is empty.');
    return;
  }

  // 2. Track InitiateCheckout event
  const cartValue = cart.reduce((sum, item) => sum + ((item.price || 0) * (item.qty || 1)), 0);
  const cartItems = cart.map(item => ({
    product_id: item.id || item.service_id || item.bundle_id,
    product_name: item.name || item.service_name,
    quantity: item.qty || 1,
    price: item.price || item.unit_price || 0
  }));
  
  h2sTrack('InitiateCheckout', {
    value: cartValue,
    currency: 'USD',
    num_items: cart.length,
    items: cartItems,
    customer_email: user?.email || null,
    customer_phone: user?.phone || null
  });

  // 3. Show Checkout Modal to collect/confirm details
  showCheckoutModal();
};

function showCheckoutModal() {
  const modal = document.getElementById('modal');
  const backdrop = document.getElementById('backdrop');
  if (!modal || !backdrop) {
    logger.error('Modal elements missing!');
    return;
  }

  // Close cart drawer if open
  const cartDrawer = document.getElementById('cartDrawer');
  if (cartDrawer && cartDrawer.classList.contains('open')) {
    cartDrawer.classList.remove('open');
  }
  
  // Pre-fill data
  const preName = user?.name || '';
  const preEmail = user?.email || '';
  const prePhone = user?.phone || '';
  
  let preAddress = '', preCity = '', preState = '', preZip = '';
  try {
    const saved = JSON.parse(localStorage.getItem('h2s_guest_checkout') || '{}');
    if(saved.address) preAddress = saved.address;
    if(saved.city) preCity = saved.city;
    if(saved.state) preState = saved.state;
    if(saved.zip) preZip = saved.zip;
  } catch(e){}

  try {
    const pending = JSON.parse(sessionStorage.getItem('h2s_pending_account') || '{}');
    if(pending.address) preAddress = pending.address;
    if(pending.city) preCity = pending.city;
    if(pending.state) preState = pending.state;
    if(pending.zip) preZip = pending.zip;
    if(pending.service_state && !preState) preState = pending.service_state;
  } catch(e){}

  const html = `
    <div style="padding: 24px; max-width: 500px; margin: 0 auto;">
      <h2 style="margin-top:0; color:var(--cobalt); font-weight:900; font-size:24px;">Complete Your Order</h2>
      <p style="color:var(--muted); margin-bottom:20px; font-size:14px;">Enter your details to finalize checkout and schedule installation.</p>
      
      <form id="checkoutForm" onsubmit="handleCheckoutSubmit(event)">
        <div style="margin-bottom:12px;">
          <label style="display:block; font-weight:600; font-size:14px; margin-bottom:4px; color:var(--ink);">Full Name</label>
          <input type="text" id="coName" class="inp" required value="${escapeAttr(preName)}" placeholder="Jane Doe" style="width:100%">
        </div>
        
        <div style="margin-bottom:12px;">
          <label style="display:block; font-weight:600; font-size:14px; margin-bottom:4px; color:var(--ink);">Email Address</label>
          <input type="email" id="coEmail" class="inp" required value="${escapeAttr(preEmail)}" placeholder="jane@example.com" style="width:100%">
        </div>
        
        <div style="margin-bottom:12px;">
          <label style="display:block; font-weight:600; font-size:14px; margin-bottom:4px; color:var(--ink);">Phone Number</label>
          <input type="tel" id="coPhone" class="inp" required value="${escapeAttr(prePhone)}" placeholder="(864) 528-1475" style="width:100%">
        </div>
        
        <div style="margin-bottom:12px;">
          <label style="display:block; font-weight:600; font-size:14px; margin-bottom:4px; color:var(--ink);">Service Address</label>
          <input type="text" id="coAddress" class="inp" required value="${escapeAttr(preAddress)}" placeholder="123 Main St" style="width:100%">
        </div>
        
        <div style="display:grid; grid-template-columns: 2fr 1fr 1fr; gap:12px; margin-bottom:20px;">
          <div>
            <label style="display:block; font-weight:600; font-size:14px; margin-bottom:4px; color:var(--ink);">City</label>
            <input type="text" id="coCity" class="inp" required value="${escapeAttr(preCity)}" placeholder="Greenville" style="width:100%">
          </div>
          <div>
            <label style="display:block; font-weight:600; font-size:14px; margin-bottom:4px; color:var(--ink);">State</label>
            <input type="text" id="coState" class="inp" required value="${escapeAttr(preState)}" placeholder="SC" maxlength="2" style="width:100%">
          </div>
          <div>
            <label style="display:block; font-weight:600; font-size:14px; margin-bottom:4px; color:var(--ink);">Zip</label>
            <input type="text" id="coZip" class="inp" required value="${escapeAttr(preZip)}" placeholder="29601" style="width:100%">
          </div>
        </div>

        <div id="coError" style="color:#d32f2f; font-size:14px; margin-bottom:12px; display:none; background:#fee; padding:8px; border-radius:4px;"></div>

        <div style="display:flex; gap:10px;">
          <button type="button" class="btn btn-ghost" onclick="closeModal()" style="flex:1;">Cancel</button>
          <button type="submit" class="btn btn-primary" id="coSubmitBtn" style="flex:2;">Proceed to Payment</button>
        </div>
      </form>
    </div>
  `;

  // Replace modal content
  const modalContent = modal.querySelector('.modal-content');
  if(modalContent) {
    modalContent.innerHTML = html;
  } else {
    modal.innerHTML = `<div class="modal-content">${html}</div>`;
  }

  modal.classList.add('show');
  backdrop.classList.add('show');
  document.documentElement.classList.add('modal-open');
  document.body.classList.add('modal-open');
  H2S_lockScroll(); // CRITICAL: Lock scroll when opening modal
  
  // Focus first empty field
  setTimeout(() => {
    try {
      const ua = navigator.userAgent || '';
      const isIOS = /iP(ad|hone|od)/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      if (isIOS) return;
      if(!document.getElementById('coName').value) document.getElementById('coName').focus();
      else if(!document.getElementById('coAddress').value) document.getElementById('coAddress').focus();
    } catch(_) { /* noop */ }
  }, 100);
}

window.handleCheckoutSubmit = async function(e) {
  e.preventDefault();
  
  const btn = document.getElementById('coSubmitBtn');
  const errEl = document.getElementById('coError');
  
  // Gather data
  const name = document.getElementById('coName').value.trim();
  const email = document.getElementById('coEmail').value.trim();
  const phone = document.getElementById('coPhone').value.trim();
  const address = document.getElementById('coAddress').value.trim();
  const city = document.getElementById('coCity').value.trim();
  const state = document.getElementById('coState').value.trim().toUpperCase();
  const zip = document.getElementById('coZip').value.trim();

  // VALIDATION: Ensure all fields present
  if(!name || !email || !phone || !address || !city || !state || !zip) {
    if(errEl) { errEl.textContent = 'Please fill in all fields.'; errEl.style.display = 'block'; }
    return;
  }

  // VALIDATION: State format
  if(!/^[A-Z]{2}$/.test(state)) {
    if(errEl) { errEl.textContent = 'Please enter a 2-letter state code (e.g., SC).'; errEl.style.display = 'block'; }
    return;
  }

  // VALIDATION: Email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if(!emailRegex.test(email)) {
    if(errEl) { errEl.textContent = 'Please enter a valid email address.'; errEl.style.display = 'block'; }
    return;
  }

  // VALIDATION: Cart not empty
  if(!cart || cart.length === 0) {
    if(errEl) { errEl.textContent = 'Your cart is empty. Please add items first.'; errEl.style.display = 'block'; }
    return;
  }

  // UI Loading state
  if(btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Processing...'; }
  if(errEl) errEl.style.display = 'none';

  // RETRY LOGIC: Attempt checkout with exponential backoff
  let attempt = 0;
  const maxAttempts = 3;
  
  while(attempt < maxAttempts) {
    attempt++;
    logger.log(`[Checkout] Attempt ${attempt}/${maxAttempts}`);
    
    try {
      // Promo Code
      const promoCode = localStorage.getItem('h2s_promo_code');

      // Build cart_items for metadata (includes TV configurations)
      const cart_items = cart.map(item => ({
        name: item.name || item.service_name || item.id,
        qty: item.qty || 1,
        price: Math.round((item.price || item.unit_price || 0) * 100), // Convert to cents
        metadata: item.metadata || {} // Preserve TV size, mount type, etc.
      }));

      // Payload - Use cart-based checkout for metadata preservation
      const payload = {
        __action: 'create_checkout_session',
        customer: {
          name: name,
          email: email,
          phone: phone
        },
        cart: cart, // Send full cart with metadata
        source: 'shop_rebuilt',
        success_url: 'https://shop.home2smart.com/bundles?view=shopsuccess&session_id={CHECKOUT_SESSION_ID}',
        cancel_url: window.location.href,
        metadata: {
          customer_name: name,
          customer_phone: phone,
          customer_email: email,
          service_address: address,
          service_city: city,
          service_state: state,
          service_zip: zip,
          source: 'shop_rebuilt'
        }
      };

      if(promoCode) payload.promotion_code = promoCode;

      logger.log('[Checkout] Sending payload:', payload);


      // FETCH with timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout
      
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);

      // Parse response
      let data;
      const contentType = res.headers.get('content-type');
      if(contentType && contentType.includes('application/json')) {
        data = await res.json();
      } else {
        const text = await res.text();
        throw new Error(`Server returned non-JSON response: ${text.substring(0, 100)}`);
      }
      
      // Check response status
      if(!res.ok || !data.ok) {
        throw new Error(data.error || data.message || `Server error: ${res.status}`);
      }

      // CRITICAL: Validate session_url exists
      if(!data.pay || !data.pay.session_url) {
        throw new Error('No Stripe session URL in response');
      }

      // SUCCESS: Save user data for next time
      try {
        localStorage.setItem('h2s_guest_checkout', JSON.stringify({ name, email, phone, address, city, state, zip }));
        if(!user.email) {
          // Update local user object if guest
          user = { name, email, phone };
          saveUser();
        }
      } catch(e){
        logger.warn('[Checkout] Could not save user data:', e);
      }

      // CRITICAL: Track checkout initiation
      try {
        if(window.h2sTrack) {
          h2sTrack('InitiateCheckout', {
            value: cart.reduce((sum, item) => sum + (item.price * item.qty), 0),
            currency: 'USD',
            num_items: cart.length
          });
        }
      } catch(e){
        logger.warn('[Checkout] Tracking failed (non-blocking):', e);
      }

      // SUCCESS: Persist session for recovery
      try {
        const checkoutData = {
          session_id: data.pay.session_id || data.pay.session_url.split('session_id=')[1] || '',
          timestamp: Date.now(),
          cart_count: cart.length,
          customer_email: email
        };
        localStorage.setItem('h2s_last_checkout', JSON.stringify(checkoutData));
        logger.log('[Checkout] Session persisted for recovery');
      } catch(e) {
        logger.warn('[Checkout] Could not persist session (non-blocking):', e);
      }

      // SUCCESS: Extract session_id for instant navigation
      const sessionId = data.pay.session_id || data.pay.session_url.split('session_id=')[1]?.split('&')[0] || '';
      
      // Cleanup UI state before redirect
      H2S_unlockScroll();
      document.documentElement.classList.remove('modal-open');
      document.body.classList.remove('modal-open');
      
      logger.log('[Checkout] ✅ Success! Session:', sessionId);

      // Redirect to Stripe Checkout to collect payment.
      // Stripe will send the customer back to success_url with {CHECKOUT_SESSION_ID}.
      try {
        window.location.href = data.pay.session_url;
      } catch(e) {
        window.location.assign(data.pay.session_url);
      }
      
      // Exit retry loop on success
      return;

    } catch (err) {
      logger.error(`[Checkout] Attempt ${attempt} failed:`, err);
      
      // ========== DEBUG LOGS ==========
      console.error('🔍 [CHECKOUT DEBUG] ❌ Checkout attempt', attempt, 'failed');
      console.error('🔍 [CHECKOUT DEBUG] Error:', err);
      console.error('🔍 [CHECKOUT DEBUG] Error name:', err.name);
      console.error('🔍 [CHECKOUT DEBUG] Error message:', err.message);
      if (err.stack) console.error('🔍 [CHECKOUT DEBUG] Error stack:', err.stack);
      // ================================
      
      // If this was the last attempt, show error
      if(attempt >= maxAttempts) {
        const errorMsg = err.name === 'AbortError' 
          ? 'Request timed out. Please check your connection and try again.'
          : `Checkout failed: ${err.message}`;
          
        if(errEl) {
          errEl.textContent = errorMsg;
          errEl.style.display = 'block';
        }
        
        if(btn) { 
          btn.disabled = false; 
          btn.textContent = 'Proceed to Payment'; 
        }
        
        // Show user-friendly alert as backup
        alert('Unable to process checkout. Please try again or contact support at (864) 528-1475.');
        return;
      }
      
      // Wait before retry (exponential backoff: 1s, 2s, 4s)
      const delay = Math.pow(2, attempt - 1) * 1000;
      logger.log(`[Checkout] Retrying in ${delay}ms...`);
      if(btn) btn.innerHTML = `<span class="spinner"></span> Retrying...`;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  } // End while loop
};

// Diagnostics: run a dry checkout to identify failures
window.__runDiagnoseCheckout = async function(){
  const errEl = document.getElementById('coError') || document.getElementById('cartMsg');
  const showErr = (msg) => {
    if(errEl){ errEl.textContent = msg; errEl.style.display = 'block'; }
    logger.error('[Diagnose] ' + msg);
  };

  if(!Array.isArray(cart) || cart.length===0){
    return showErr('Cart is empty. Add at least one item.');
  }

  try{
    const line_items = cart.map(item => {
      let priceId = item.stripe_price_id;
      if(!priceId && (item.type === 'package' || item.type === 'bundle')){
        const id = item.id || item.bundle_id;
        const b = catalog?.bundles?.find(x => x.bundle_id === id);
        if(b) priceId = b.stripe_price_id;
      }
      if(!priceId && item.service_id && catalog?.priceTiers){
        const qty = Number(item.qty || 1);
        const tiers = catalog.priceTiers.filter(t => t.service_id === item.service_id);
        const tier = tiers.find(t => {
          const min = Number(t.min_qty || 0);
          const max = (t.max_qty === '' || t.max_qty == null) ? Infinity : Number(t.max_qty);
          return qty >= min && qty <= max;
        });
        if(tier) priceId = tier.stripe_price_id;
      }
      if(!priceId){
        logger.warn('[Diagnose] Missing price ID for item:', item);
        return null;
      }
      return { price: priceId, quantity: item.qty || 1 };
    }).filter(Boolean);

    if(line_items.length===0){
      return showErr('No valid Stripe price IDs found for cart items.');
    }

    const payload = {
      __action: 'create_checkout_session',
      line_items,
      customer_email: user?.email || 'guest@example.com',
      success_url: 'https://shop.home2smart.com/bundles?view=shopsuccess&session_id={CHECKOUT_SESSION_ID}',
      cancel_url: window.location.href,
      metadata: { source: 'shop_rebuilt_diagnose' },
      diagnose: true
    };

    logger.log('[Diagnose] Payload preview:', payload);
    const res = await fetch(API, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
    const text = await res.text();
    let data = {};
    try { data = JSON.parse(text); } catch(e){ logger.warn('[Diagnose] Non-JSON response:', text); }

    logger.log('[Diagnose] Response status:', res.status);
    logger.log('[Diagnose] Response body:', data.ok ? data : text);

    if(!res.ok){
      return showErr('Backend HTTP error ' + res.status + '. Body: ' + (text||''));
    }
    if(!data.ok){
      return showErr('Backend returned error: ' + (data.error||'Unknown error'));
    }
    if(!(data.pay && data.pay.session_url)){
      return showErr('No session_url from backend. Check Stripe session creation.');
    }
    logger.log('? Diagnose OK. session_url:', data.pay.session_url);
    if(errEl){ errEl.style.display = 'none'; }
  }catch(err){
    showErr('Diagnose failed: ' + err.message);
  }
}; // Close __runDiagnoseCheckout

function showCheckoutError(msg){
  const el = document.getElementById('cartMsg');
  const btn = document.getElementById('checkoutBtn');
  if(el) {
    el.textContent = msg;
    el.style.color = '#d32f2f';
  }
  if(btn) {
    btn.disabled = false;
    btn.textContent = 'Checkout';
  }
  alert(msg);
}

// === SHOP SUCCESS ===
window.renderShopSuccess = async function(){
  console.warn("⚠️ DEPRECATED: window.renderShopSuccess called. Redirecting to renderShopSuccessView...");
  return renderShopSuccessView();

};

window.renderSignIn = function(){
  const outlet = byId('outlet');
  outlet.innerHTML = `
    <section class="form">
      <div style="text-align:center; margin-bottom:24px;">
        <a href="#" onclick="navSet({view:'shop'}); return false;" class="link-btn" style="font-size:14px; color:var(--azure); font-weight:600;">
          Back to shop
        </a>
      </div>
      <h2>Sign in to your account</h2>
      <p class="help" style="text-align:center; color:var(--text-muted); margin-bottom:20px;">Access your dashboard, track orders, and manage your account.</p>
      <input class="inp" id="siEmail" type="email" placeholder="Email address" value="${escapeAttr(user?.email||'')}" autocomplete="email">
      <input class="inp" id="siPass"  type="password" placeholder="Password" autocomplete="current-password">
      <div style="display:flex; gap:12px; margin-top:24px; flex-direction:column;">
        <button class="btn btn-primary" id="signin" style="width:100%;">Sign in</button>
        <button class="btn btn-ghost" id="toSignup" style="width:100%;">Create account</button>
        <button class="btn btn-subtle" id="toForgot" style="padding:10px; margin-top:8px;">Forgot password?</button>
      </div>
      <div id="siMsg" class="help" style="margin-top:16px; color:#d32f2f;"></div>
    </section>
  `;
  
  outlet.style.opacity = '1';
  outlet.style.transition = '';
  document.body.classList.add('app-ready');
  
  byId('toSignup').onclick = ()=> navSet({view:'signup'});
  byId('toForgot').onclick = ()=> navSet({view:'forgot'});
  byId('signin').onclick = async ()=>{
    const email = byId('siEmail').value.trim();
    const pass  = byId('siPass').value;
    if(!email){ return showMsg('siMsg','Enter your email.'); }
    if(!pass){ return showMsg('siMsg','Enter your password.'); }
    showLoader();
    try{
      const resp = await fetch(API, { method:'POST', body: JSON.stringify({__action:'signin', email, password:pass })});
      const text = await resp.text();
      if(!resp.ok){ showMsg('siMsg', text || ('Error ' + resp.status)); return; }
      const data = JSON.parse(text);
      if(!data.ok){ showMsg('siMsg', data.error||'Sign in failed'); return; }
      user = { 
        name: data.user.name||'', 
        email: data.user.email, 
        phone: data.user.phone||'',
        referral_code: data.user.referral_code||'',
        credits: data.user.credits||0,
        total_spent: data.user.total_spent||0
      };
      saveUser();
      loadAIRecommendations();
      h2sTrack('Login', { user_email: user.email });
      navSet({view:'account'});
    }catch(err){ showMsg('siMsg', String(err)); }
    finally{ hideLoader(); }
  };
};

window.renderSignUp = function(){
  const seed = user||{};
  const outlet = byId('outlet');
  outlet.innerHTML = `
    <section class="form">
      <div style="text-align:center; margin-bottom:24px;">
        <a href="#" onclick="navSet({view:'shop'}); return false;" class="link-btn" style="font-size:14px; color:var(--azure); font-weight:600;">
          Back to shop
        </a>
      </div>
      <h2>Create your account</h2>
      <p class="help" style="text-align:center; color:var(--text-muted); margin-bottom:20px;">Get exclusive discounts, earn credits, and track your installations.</p>
      <input class="inp" id="suName"  type="text"  placeholder="Full name" value="${escapeAttr(seed.name||'')}" autocomplete="name">
      <input class="inp" id="suEmail" type="email" placeholder="Email address" value="${escapeAttr(seed.email||'')}" autocomplete="email">
      <input class="inp" id="suPhone" type="tel"   placeholder="Phone number" value="${escapeAttr(seed.phone||'')}" autocomplete="tel">
      <input class="inp" id="suPass"  type="password" placeholder="Password (min 8 characters)" autocomplete="new-password">
      <input class="inp" id="suPass2" type="password" placeholder="Confirm password" autocomplete="new-password">
      <div class="help" style="text-align:center; color:var(--text-muted); margin-top:8px;">Secure checkout, order tracking, and rewards</div>
      <div style="display:flex; gap:12px; margin-top:24px; flex-direction:column;">
        <button class="btn btn-primary" id="createAcct" style="width:100%;">Create account</button>
        <button class="btn btn-ghost" id="toSignin" style="width:100%;">Already have an account? Sign in</button>
      </div>
      <div id="suMsg" class="help" style="margin-top:16px;"></div>
    </section>
  `;
  
  outlet.style.opacity = '1';
  outlet.style.transition = '';
  document.body.classList.add('app-ready');
  
  byId('toSignin').onclick = ()=> navSet({view:'signin'});
  byId('createAcct').onclick = async ()=>{
    const name  = byId('suName').value.trim();
    const email = byId('suEmail').value.trim();
    const phone = byId('suPhone').value.trim();
    const pw1   = byId('suPass').value;
    const pw2   = byId('suPass2').value;
    const msg   = byId('suMsg');
    const btn   = byId('createAcct');
    
    if(!email){ return showMsg('suMsg','Enter your email.'); }
    if(pw1.length < 8){ return showMsg('suMsg','Password must be at least 8 characters.'); }
    if(pw1 !== pw2){ return showMsg('suMsg','Passwords do not match.'); }
    showLoader();
    try{
      const resp = await fetch(API, { method:'POST', body: JSON.stringify({__action:'create_user', user:{name,email,phone,password:pw1}})});
      const text = await resp.text();
      if(!resp.ok){ showMsg('suMsg', text || ('Error ' + resp.status)); return; }
      const data = JSON.parse(text);
      if(!data.ok){ showMsg('suMsg', data.error||'Create failed'); return; }
      user = { 
        name: data.user.name||'', 
        email: data.user.email, 
        phone: data.user.phone||'',
        referral_code: data.user.referral_code||'',
        credits: data.user.credits||0,
        total_spent: data.user.total_spent||0
      };
      saveUser();
      loadAIRecommendations();
      h2sTrack('CompleteRegistration', { user_email: user.email, user_name: user.name });
      
      if(msg && btn){
        msg.style.color = '#2e7d32';
        msg.textContent = 'Account created! Welcome to Home2Smart.';
        btn.textContent = 'Success!';
        btn.disabled = true;
      }
      
      setTimeout(() => {
        navSet({view:'account'});
      }, 1200);
    }catch(err){ showMsg('suMsg', String(err)); }
    finally{ hideLoader(); }
  };
};

window.renderForgot = function(){
  const outlet = byId('outlet');
  outlet.innerHTML = `
    <section class="form">
      <div style="text-align:center; margin-bottom:24px;">
        <a href="#" onclick="navSet({view:'shop'}); return false;" class="link-btn" style="font-size:14px; color:var(--azure); font-weight:600;">
          Back to shop
        </a>
      </div>
      <h2>Forgot password</h2>
      <p class="help" style="text-align:center; color:var(--text-muted); margin-bottom:20px;">Enter your email and we'll send you a reset link.</p>
      <input class="inp" id="fpEmail" type="email" placeholder="Email address" autocomplete="email">
      <div style="display:flex; gap:12px; margin-top:24px; flex-direction:column;">
        <button class="btn btn-primary" id="fpSend" style="width:100%;">Send reset link</button>
        <button class="btn btn-ghost" id="fpBack" style="width:100%;">Back to sign in</button>
      </div>
      <div id="fpMsg" class="help" style="margin-top:16px; color:#d32f2f;"></div>
    </section>
  `;
  
  outlet.style.opacity = '1';
  outlet.style.transition = '';
  document.body.classList.add('app-ready');
  
  byId('fpBack').onclick = ()=> navSet({view:'signin'});
  byId('fpSend').onclick = async ()=>{
    const email = byId('fpEmail').value.trim();
    if(!email){ return showMsg('fpMsg','Enter your email.'); }
    showLoader();
    try{
      const resp = await fetch(API, { method:'POST', body: JSON.stringify({__action:'request_password_reset', email})});
      const txt  = await resp.text();
      if(!resp.ok){ showMsg('fpMsg', txt || ('Error ' + resp.status)); return; }
      showMsg('fpMsg','If that email has an account, a reset link has been sent. Check your inbox.');
    }catch(err){ showMsg('fpMsg', String(err)); }
    finally{ hideLoader(); }
  };
};

window.renderReset = function(token){
  const outlet = byId('outlet');
  outlet.innerHTML = `
    <section class="form">
      <h2 style="margin:0 0 10px 0;font-weight:900">Reset password</h2>
      <input class="inp" id="rpToken" type="text" placeholder="Reset token" value="${escapeAttr(token||'')}">
      <input class="inp" id="rpNew1" type="password" placeholder="New password (min 8)">
      <input class="inp" id="rpNew2" type="password" placeholder="Confirm new password">
      <div style="display:flex; gap:10px; margin-top:6px; flex-wrap:wrap">
        <button class="btn azure" id="rpDo">Set new password</button>
        <button class="btn ghost" id="rpBack">Back to sign in</button>
      </div>
      <div id="rpMsg" class="help"></div>
    </section>
  `;
  
  outlet.style.opacity = '1';
  outlet.style.transition = '';
  document.body.classList.add('app-ready');
  
  byId('rpBack').onclick = ()=> navSet({view:'signin'});
  byId('rpDo').onclick = async ()=>{
    const tok = byId('rpToken').value.trim();
    const p1   = byId('rpNew1').value;
    const p2   = byId('rpNew2').value;
    if(!tok){ return showMsg('rpMsg','Missing reset token.'); }
    if(p1.length<8){ return showMsg('rpMsg','Password must be at least 8 characters.'); }
    if(p1!==p2){ return showMsg('rpMsg','Passwords do not match.'); }
    showLoader();
    try{
      const resp = await fetch(API, { method:'POST', body: JSON.stringify({__action:'reset_password', token:tok, new_password:p1})});
      const txt  = await resp.text();
      if(!resp.ok){ showMsg('rpMsg', txt || ('Error ' + resp.status)); return; }
      const data = JSON.parse(txt);
      if(!data.ok){ showMsg('rpMsg', data.error||'Could not reset password'); return; }
      showMsg('rpMsg','Password updated. You can now sign in.');
      setTimeout(()=> navSet({view:'signin'}), 800);
    }catch(err){ showMsg('rpMsg', String(err)); }
    finally{ hideLoader(); }
  };
};

window.renderAccount = function(){
  if(!user || !user.email){ navSet({view:'signin'}); return; }

  if(!user.referral_code && !window._userRefreshing){
    window._userRefreshing = true;
    fetch(API + '?action=user&email=' + encodeURIComponent(user.email))
      .then(r=>r.json())
      .then(d=>{
        window._userRefreshing = false;
        if(d.ok && d.user){
          user = { ...user, ...d.user };
          saveUser();
          renderAccount();
        }
      }).catch(()=> window._userRefreshing = false);
  }

  const outlet = byId('outlet');
  outlet.innerHTML = `
    <section class="form">
      <div style="text-align:center; margin:12px 0 24px;">
        <a href="#" onclick="navSet({view:null}); return false;" class="link-btn" style="font-size:14px; color:var(--azure); font-weight:600;">
          Back to shop
        </a>
      </div>
      <h2 style="margin:0 0 10px 0;font-weight:900">Your account</h2>
      <p class="help" style="text-align:center; color:var(--text-muted); margin-bottom:20px;">Manage your profile, view orders, and track your rewards.</p>
      <input class="inp" id="acName"  type="text"  placeholder="Full name" value="${escapeAttr(user.name||'')}">
      <input class="inp" id="acEmail" type="email" placeholder="Email" value="${escapeAttr(user.email||'')}" disabled>
      <input class="inp" id="acPhone" type="tel"   placeholder="Phone" value="${escapeAttr(user.phone||'')}">
      <div style="display:flex; gap:12px; margin-top:24px; flex-direction:column;">
        <button class="btn btn-primary" id="saveAcct" style="width:100%;">Save changes</button>
        <div style="display:flex; gap:8px;">
          <button class="btn btn-ghost" id="signOut" style="flex:1;">Sign out</button>
        </div>
      </div>
      <div id="acMsg" class="help" style="margin-top:16px;"></div>
    </section>

    <section class="form" style="margin-top:24px">
      <h3 style="margin:0 0 10px 0;font-weight:900">Rewards & Credits</h3>
      <div class="pd-box" style="background:#f0f9ff; border-color:#bae6fd;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px">
          <div style="font-weight:800; color:#0284c7;">Available Credits</div>
          <div style="font-weight:900; font-size:18px; color:#0284c7;">${money(user.credits||0)}</div>
        </div>
        <div style="margin-top:12px; padding-top:12px; border-top:1px solid #bae6fd;">
          <div style="font-weight:800; color:#0284c7; margin-bottom:4px;">Your Referral Code</div>
          <div style="display:flex; gap:8px; align-items:center;">
            <div style="font-family:monospace; font-weight:900; font-size:18px; letter-spacing:1px; background:#fff; padding:8px 12px; border-radius:6px; border:1px dashed #0284c7; color:#0284c7;">
              ${escapeHtml(user.referral_code || 'Loading...')}
            </div>
            <button class="btn btn-primary" style="padding:8px 16px; font-size:13px;" onclick="navigator.clipboard.writeText('${escapeHtml(user.referral_code||'')}').then(()=>this.textContent='Copied!')">Copy Code</button>
          </div>
          <div style="font-size:13px; color:#0369a1; margin-top:8px;">Share this code. Friends get discount, you get credit.</div>
        </div>
      </div>
    </section>

    <section class="form" style="margin-top:24px">
      <button class="btn ghost" id="cpToggle" aria-expanded="false">Change password</button>
      <div id="cpPanel" class="pd-box" style="display:none; margin-top:10px">
        <h3 style="margin:0 0 10px 0;font-weight:900">Change password</h3>
        <input class="inp" id="cpOld" type="password" placeholder="Current password">
        <input class="inp" id="cpNew1" type="password" placeholder="New password (min 8)">
        <input class="inp" id="cpNew2" type="password" placeholder="Confirm new password">
        <div style="display:flex; gap:10px; margin-top:6px; flex-wrap:wrap">
          <button class="btn azure" id="cpDo">Update password</button>
        </div>
        <div id="cpMsg" class="help"></div>
      </div>
    </section>

    <section class="form" style="margin-top:24px">
      <h3 style="margin:0 0 10px 0;font-weight:900">Previous orders</h3>
      <div id="ordersBox" class="pd-box"><div class="help">Loading...</div></div>
    </section>
  `;

  byId('saveAcct').onclick = async ()=>{
    const name  = byId('acName').value.trim();
    const phone = byId('acPhone').value.trim();
    showLoader();
    try{
      const resp = await fetch(API, { method:'POST', body: JSON.stringify({__action:'upsert_user', user:{name,phone,email:user.email}})});
      const text = await resp.text();
      if(!resp.ok){ showMsg('acMsg', text || ('Error ' + resp.status)); return; }
      const data = JSON.parse(text);
      if(!data.ok){ showMsg('acMsg', data.error||'Save failed'); return; }
      user = { ...user, ...data.user };
      saveUser();
      showMsg('acMsg','Saved successfully.');
    }catch(err){ showMsg('acMsg', String(err)); }
    finally{ hideLoader(); }
  };
  byId('signOut').onclick = ()=>{ user = {}; saveUser(); navSet({view:null}); };

  outlet.style.opacity = '1';
  outlet.style.transition = '';
  document.body.classList.add('app-ready');

  const cpToggle = byId('cpToggle');
  const cpPanel  = byId('cpPanel');
  if(cpToggle && cpPanel){
    cpToggle.onclick = ()=>{
      const open = cpPanel.style.display !== 'none';
      cpPanel.style.display = open ? 'none' : '';
      cpToggle.setAttribute('aria-expanded', String(!open));
    };
  }

  const cpDo = byId('cpDo');
  if(cpDo){
    cpDo.onclick = async ()=>{
      const oldp = byId('cpOld').value;
      const p1   = byId('cpNew1').value;
      const p2   = byId('cpNew2').value;
      if(!oldp){ return showMsg('cpMsg','Enter your current password.'); }
      if(p1.length<8){ return showMsg('cpMsg','New password must be at least 8 characters.'); }
      if(p1!==p2){ return showMsg('cpMsg','Passwords do not match.'); }
      showLoader();
      try{
        const resp = await fetch(API, { method:'POST', body: JSON.stringify({__action:'change_password', email:user.email, old_password:oldp, new_password:p1})});
        const txt  = await resp.text();
        if(!resp.ok){ showMsg('cpMsg', txt || ('Error ' + resp.status)); return; }
        const data = JSON.parse(txt);
        if(!data.ok){ showMsg('cpMsg', data.error||'Could not change password'); return; }
        showMsg('cpMsg','Password updated.');
        byId('cpOld').value = byId('cpNew1').value = byId('cpNew2').value = '';
      }catch(err){ showMsg('cpMsg', String(err)); }
      finally{ hideLoader(); }
    };
  }

  loadOrders();
};

async function loadOrders(){
  const box = byId('ordersBox');
  if(!box) return;
  try{
    const res = await fetch(API + '?action=orders&email=' + encodeURIComponent(user.email));
    const data = await res.json();
    const orders = Array.isArray(data.orders) ? data.orders : [];
    if(!orders.length){
      box.innerHTML = `<div class="help">No orders yet.</div>`;
      return;
    }
    orders.sort((a,b)=> new Date(b.created_at||0) - new Date(a.created_at||0));
    box.innerHTML = orders.map(o=>{
      const oid = o.order_id || o.stripe_session_id || '—';
      
      // Parse items JSON if available
      let itemsHTML = '';
      try {
        let itemsData = null;
        
        // 1. Try to get items from o.items
        if(o.items) {
          if(Array.isArray(o.items)) {
            itemsData = o.items;
          } else if(typeof o.items === 'string') {
            try { itemsData = JSON.parse(o.items); } catch(e){}
          }
        }
        
        // 2. If no items yet, try o.order_summary if it looks like JSON
        if(!itemsData && o.order_summary && typeof o.order_summary === 'string' && o.order_summary.trim().startsWith('[')) {
          try { itemsData = JSON.parse(o.order_summary); } catch(e){}
        }

        // 3. Render items if found
        if(Array.isArray(itemsData) && itemsData.length > 0) {
          itemsHTML = itemsData.map(item => {
            const name = item.service_name || item.name || item.description || item.bundle_id || item.service_id || 'Service';
            const qty = item.qty || item.quantity || 1;
            const price = item.unit_price || item.price || 0;
            return `${qty}× ${escapeHtml(name)} – ${money(price)}`;
          }).join('<br>');
        } 
        
        // 4. Fallback to text summary if not JSON
        else if(o.order_summary && (typeof o.order_summary !== 'string' || !o.order_summary.trim().startsWith('['))) {
          itemsHTML = escapeHtml(o.order_summary);
        }
      } catch(e) {
        console.error('Error rendering items:', e);
      }
      
      if(!itemsHTML) itemsHTML = 'Items unavailable';
      
      // Format service date properly
      let dateHTML = '';
      if(o.install_at || o.delivery_date || o.service_date) {
        const dateValue = o.install_at || o.delivery_date || o.service_date;
        try {
          const dt = new Date(dateValue);
          if(!isNaN(dt.getTime())) {
            const options = { month: 'short', day: 'numeric', year: 'numeric' };
            dateHTML = dt.toLocaleDateString('en-US', options);
            if(o.delivery_time) {
              dateHTML += ` – ${escapeHtml(o.delivery_time)}`;
            }
          } else {
            dateHTML = escapeHtml(String(dateValue));
          }
        } catch(e) {
          dateHTML = escapeHtml(String(dateValue));
        }
      }
      
      // Action buttons based on appointment status
      let actionHTML = '';
      if(!dateHTML) {
        // No appointment scheduled yet
        actionHTML = `<button class="btn btn-sm azure" onclick="scheduleOrder('${escapeHtml(oid)}')">Schedule Now</button>`;
        dateHTML = '<span style="color:#94a3b8">Not scheduled</span>';
      } else {
        // Already scheduled - show reschedule option
        actionHTML = `<button class="btn btn-sm ghost" onclick="rescheduleOrder('${escapeHtml(oid)}', '${escapeHtml(o.delivery_date||'')}', '${escapeHtml(o.delivery_time||'')}')">Reschedule</button>`;
      }
      
      const total = (Number(o.order_total)||0);
      
      // Check if order is upcoming (not yet completed/canceled)
      const isUpcoming = !o.status || ['pending', 'scheduled', 'confirmed'].includes(o.status?.toLowerCase());
      const jobId = o.job_id || o.order_id || o.stripe_session_id;
      
      return `
        <div class="pd-box" style="margin-bottom:10px">
          <div class="details-grid">
            <div class="row"><div class="k">Order ID</div><div class="v">${escapeHtml(String(oid))}</div></div>
            <div class="row"><div class="k">Total</div><div class="v">${money(total)}</div></div>
            <div class="row"><div class="k">Items</div><div class="v">${itemsHTML}</div></div>
            <div class="row"><div class="k">Service date</div><div class="v">${dateHTML}</div></div>
            <div class="row"><div class="k">Actions</div><div class="v">${actionHTML}</div></div>
          </div>
          
          ${isUpcoming && jobId ? `
            <div class="customer-photos-section" id="photos-${escapeHtml(jobId)}" style="margin-top:16px; padding-top:16px; border-top:1px solid #e5e7eb;">
              <h4 style="margin:0 0 8px 0; font-size:14px; font-weight:700; color:#0a2a5a;">
                Add Photos (Optional)
                <span style="font-size:12px; font-weight:normal; color:#6b778c; margin-left:8px;">Help your technician plan</span>
              </h4>
              <p style="margin:0 0 12px 0; font-size:13px; color:#6b778c; line-height:1.5;">
                Upload photos of your space (router location, TV wall, etc.) to help us prepare for your installation.
              </p>
              
              <input type="file" id="photoInput-${escapeHtml(jobId)}" accept="image/*,.pdf" multiple style="display:none">
              <button class="btn btn-sm azure" onclick="selectPhotosForJob('${escapeHtml(jobId)}')" style="margin-bottom:12px;">
                Choose Photos
              </button>
              
              <div class="photo-thumbnails-grid" id="thumbnails-${escapeHtml(jobId)}" style="display:grid; grid-template-columns:repeat(auto-fill, minmax(100px, 1fr)); gap:8px; margin-bottom:8px;">
                <!-- Populated by loadCustomerPhotos -->
              </div>
              
              <div class="photo-counter" style="font-size:12px; color:#6b778c;">
                <span id="photoCount-${escapeHtml(jobId)}">No photos yet</span>
              </div>
            </div>
          ` : ''}
        </div>
      `;
    }).join('');
  }catch(e){
    box.innerHTML = `<div class="help">Could not load orders.</div>`;
  }
}

window.updateQuoteEstimate = function() {
  const type = document.getElementById('quoteType')?.value || 'tv';
  const qty = parseInt(document.getElementById('quoteQty')?.value) || 1;
  const surface = document.getElementById('quoteSurface')?.value || 'standard';
  const estimateBox = document.getElementById('quoteEstimateValue');
  
  if (!estimateBox) return;

  // Commercial always custom
  if (surface === 'commercial') {
    estimateBox.innerText = "Custom Quote";
    return;
  }

  let basePrice = 0;
  let perItem = 0;

  // Pricing Logic (Congruent with Packages)
  if (type === 'tv') {
    // 3 TVs (Multi-Room) = $699. 
    // Formula: $149 + (3 * $183) = $698.
    // 5 TVs = $1,064.
    // 10 TVs = $1,979 (Under double $2,128).
    basePrice = 149;
    perItem = 183;
  } else if (type === 'camera') {
    // Basic (2 cams + doorbell) = $599.
    // Standard (4 cams + doorbell) = $1,199.
    // Premium (8 cams + doorbell) = $2,199.
    // Custom Quote (Cameras only, no doorbell implied):
    // 4 Cams = $1,000 ($250/ea).
    // 8 Cams = $2,000 ($250/ea).
    // 16 Cams = $4,000 (Under double Premium $4,398).
    basePrice = 0;
    perItem = 250;
  } else {
    // Mixed/Other
    basePrice = 199;
    perItem = 200; 
  }

  let totalLow = basePrice + (perItem * qty);
  
  // Add complexity
  if (surface === 'brick') {
    totalLow += (50 * qty);
  }

  // Range is +15% for buffer
  let totalHigh = Math.round(totalLow * 1.15);
  
  estimateBox.innerText = `$${totalLow} - $${totalHigh}`;
};

window.requestQuote = function(packageId){
  const modal = document.getElementById('quoteModal');
  const backdrop = document.getElementById('backdrop');
  const titleEl = document.getElementById('quoteModalTitle');
  
  if (!modal || !backdrop) return;
  
  // Smart Context Setting
  const typeSelect = document.getElementById('quoteType');
  if (typeSelect) {
    // Reset options
    Array.from(typeSelect.options).forEach(opt => opt.disabled = false);

    if (packageId === 'tv_custom') {
      typeSelect.value = 'tv';
      // Disable Camera to enforce context
      const camOpt = Array.from(typeSelect.options).find(o => o.value === 'camera');
      if(camOpt) camOpt.disabled = true;
    } else if (packageId === 'cam_custom') {
      typeSelect.value = 'camera';
      // Disable TV to enforce context
      const tvOpt = Array.from(typeSelect.options).find(o => o.value === 'tv');
      if(tvOpt) tvOpt.disabled = true;
    } else {
      typeSelect.value = 'both';
    }
    // Trigger update to refresh price
    if (typeof window.updateQuoteEstimate === 'function') window.updateQuoteEstimate();
  }

  if (packageId === 'tv_custom') {
    titleEl.textContent = 'Custom TV Mounting Quote';
  } else if (packageId === 'cam_custom') {
    titleEl.textContent = 'Custom Security Camera Quote';
  } else {
    titleEl.textContent = 'Request Custom Quote';
  }
  
  const detailsField = document.getElementById('quoteDetails');
  if (detailsField) {
    const projectType = packageId === 'tv_custom' ? 'TV mounting' : 'security camera installation';
    detailsField.placeholder = `Describe any specific needs for your ${projectType}...`;
  }
  
  modal.dataset.packageId = packageId;

  try{
    modal.dataset.prevFocus = document.activeElement?.id || '';
  }catch(e){ modal.dataset.prevFocus = ''; }
  
  modal.classList.add('show');
  backdrop.classList.add('show');
  H2S_lockScroll();
  
  setTimeout(() => {
    const nameInput = document.getElementById('quoteName');
    if (nameInput) nameInput.focus();
  }, 100);
};

window.closeQuoteModal = function(){
  const modal = document.getElementById('quoteModal');
  const backdrop = document.getElementById('backdrop');
  
  if (modal) modal.classList.remove('show');
  
  const menuOpen = document.getElementById('menuDrawer')?.classList.contains('open');
  const cartOpen = document.getElementById('cartDrawer')?.classList.contains('open');
  const mainModalOpen = document.getElementById('modal')?.classList.contains('show');
  
  if (!menuOpen && !cartOpen && !mainModalOpen && backdrop) {
    backdrop.classList.remove('show');
  }
  
  H2S_unlockScroll();
  
  ['quoteName', 'quoteEmail', 'quotePhone', 'quoteDetails'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  
  const msg = document.getElementById('quoteMessage');
  if (msg) msg.textContent = '';

  try{
    const prevId = modal?.dataset?.prevFocus;
    if(prevId){
      const prevEl = document.getElementById(prevId);
      if(prevEl && typeof prevEl.focus === 'function') prevEl.focus();
    } else {
      const outlet = document.getElementById('outlet');
      if(outlet && typeof outlet.focus === 'function') outlet.focus();
    }
    if(modal && modal.dataset) modal.dataset.prevFocus = '';
  }catch(e){ }
};

window.submitQuoteRequest = async function(){
  const name = document.getElementById('quoteName')?.value.trim() || '';
  const email = document.getElementById('quoteEmail')?.value.trim() || '';
  const phone = document.getElementById('quotePhone')?.value.trim() || '';
  const details = document.getElementById('quoteDetails')?.value.trim() || '';
  
  // Smart Fields
  const type = document.getElementById('quoteType')?.value || 'N/A';
  const qty = document.getElementById('quoteQty')?.value || 'N/A';
  const surface = document.getElementById('quoteSurface')?.value || 'N/A';
  const estimate = document.getElementById('quoteEstimateValue')?.innerText || 'N/A';

  const msg = document.getElementById('quoteMessage');
  const btn = document.getElementById('submitQuoteBtn');
  const modal = document.getElementById('quoteModal');
  const packageId = modal?.dataset.packageId || 'unknown';
  
  if (!msg || !btn) return;
  
  if (!name) {
    msg.style.color = '#d32f2f';
    msg.textContent = 'Please enter your name';
    return;
  }
  
  if (!email || !email.includes('@')) {
    msg.style.color = '#d32f2f';
    msg.textContent = 'Please enter a valid email address';
    return;
  }
  
  if (!phone) {
    msg.style.color = '#d32f2f';
    msg.textContent = 'Please enter your phone number';
    return;
  }
  
  btn.disabled = true;
  btn.textContent = 'Sending...';
  msg.textContent = '';
  
  try {
    const quoteEndpoint = API.replace('/api/shop', '/api/quote');
    
    // Combine smart fields into details
    const smartDetails = `
[Smart Quote Data]
Type: ${type}
Quantity: ${qty}
Surface: ${surface}
Est. Range: ${estimate}
------------------
${details}
    `.trim();

    // Prevent double submission
    if (btn.disabled) return;
    btn.disabled = true;
    btn.textContent = 'Sending...';

    const response = await fetch(quoteEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        email,
        phone,
        details: smartDetails,
        package_type: packageId,
        source: '/shop',
        timestamp: new Date().toISOString()
      })
    });
    
    const data = await response.json();
    
    if (response.ok && data.ok) {
      msg.style.color = '#2e7d32';
      msg.textContent = 'Request sent! We\'ll contact you within 1 hour.';
      
      h2sTrack('QuoteRequested', {
        package_type: packageId,
        email: email,       // Standardized key for backend
        name: name,         // Added for profile creation
        phone: phone,       // Added for profile creation
        customer_email: email, // Kept for backward compatibility
        quote_id: data.quote_id
      });
      
      setTimeout(() => {
        closeQuoteModal();
      }, 2000);
    } else {
      throw new Error(data.error || 'Server error');
    }
  } catch (error) {
    logger.error('Quote request failed:', error);
    msg.style.color = '#d32f2f';
    msg.textContent = 'Failed to send. Please call us at (864) 528-1475';
    btn.disabled = false;
    btn.textContent = 'Send Request';
  }
};

// === SCHEDULING / RESCHEDULING FUNCTIONS ===

window.scheduleOrder = function(orderId) {
  // Navigate to shop success page with order_id to trigger scheduling flow
  navSet({ view: 'shopsuccess', order_id: orderId });
};

window.rescheduleOrder = async function(orderId, currentDate, currentTime) {
  const newDate = prompt(`Reschedule appointment\n\nCurrent: ${currentDate} at ${currentTime}\n\nEnter new date (YYYY-MM-DD):`, currentDate);
  if (!newDate) return;
  
  const newTime = prompt(`Enter new time (e.g., "9:00 AM - 11:00 AM"):`, currentTime || '9:00 AM - 11:00 AM');
  if (!newTime) return;
  
  // Validate date format
  if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate)) {
    alert('Invalid date format. Please use YYYY-MM-DD (e.g., 2025-12-15)');
    return;
  }
  
  const reason = prompt('Reason for reschedule (optional):', '') || 'Customer request';
  
  showLoader();
  try {
    const response = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        __action: 'reschedule_appointment',
        order_id: orderId,
        delivery_date: newDate,
        delivery_time: newTime,
        reason: reason
      })
    });
    
    const data = await response.json();
    
    if (response.ok && data.ok) {
      alert('✓ Appointment rescheduled successfully!\n\nNew date: ' + newDate + '\nNew time: ' + newTime);
      loadOrders(); // Refresh the orders list
    } else {
      throw new Error(data.error || 'Reschedule failed');
    }
  } catch (error) {
    console.error('Reschedule error:', error);
    alert('Failed to reschedule: ' + error.message + '\n\nPlease call us at (864) 528-1475');
  } finally {
    hideLoader();
  }
};

logger.log('? Deferred logic loaded');

// === PERFORMANCE REPORTING (UNIFIED) ===
if(location.search.includes('view=shopsuccess')){
    window.addEventListener('load', () => {
       // We rely on the internal report from renderShopSuccessView
       // But we log Navigation Timing as a bonus backup
       setTimeout(() => {
          const nav = performance.getEntriesByType('navigation')[0];
          if(nav) {
              console.log('[NAV TIMING]', {
                dns: (nav.domainLookupEnd - nav.domainLookupStart).toFixed(1),
                connect: (nav.connectEnd - nav.connectStart).toFixed(1),
                ttfb: (nav.responseStart - nav.requestStart).toFixed(1),
                download: (nav.responseEnd - nav.responseStart).toFixed(1),
                domInteractive: (nav.domInteractive - nav.startTime).toFixed(1)
              });
          }
       }, 2000);
    });
}

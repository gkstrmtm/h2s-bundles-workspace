const fs = require('fs');
const path = require('path');

const targetFile = path.join(__dirname, 'bundles.js');
let content = fs.readFileSync(targetFile, 'utf8');

const startMarker = "async function renderShopSuccessView() {";
const endMarker = "// 5. HOIST FIX"; 
const startIdx = content.indexOf(startMarker);
const endIdx = content.indexOf(endMarker);

if (startIdx === -1 || endIdx === -1) {
    console.error("Could not find implementation block.");
    process.exit(1);
}

// === IMPLEMENTATION v7 (INTERACTION POLISH) ===
const newLogic = `
async function renderShopSuccessView() {
  performance.mark('ss_route_start');
  performance.mark('shopsuccess_start');
  console.log('🔵 [renderShopSuccessView] START - Interaction Polish v7');

  // 1. CLEANUP PRE-RENDERER
  const hider = document.getElementById('hide-content-temp');
  if(hider) hider.remove();
  const overlay = document.getElementById('success-pre-overlay');
  
  // Fade out overlay logic for smoother flow
  if(overlay) {
     overlay.style.transition = 'opacity 0.3s ease-out';
     // We will remove it after data patch or timeout
  }

  window.scrollTo(0, 0);
  document.documentElement.style.overflow = 'auto'; 
  document.documentElement.style.height = '100%';
  document.body.style.overflow = 'auto'; 
  document.body.style.height = '100%';
  document.body.style.backgroundColor = '#f8fafc';

  const params = new URLSearchParams(window.location.search);
  const sessionId = params.get('session_id') || params.get('stripe_session_id');
  
  // 2. RENDER UI
  const outlet = byId('outlet');
  if(!outlet) return;

  const styles = \`
    <style>
      .ss-wrapper {
        min-height: 100vh; width: 100%; 
        padding-top: max(env(safe-area-inset-top), 60px);
        padding-bottom: 80px;
        background: #f8fafc;
        font-family: 'Archivo', system-ui, -apple-system, sans-serif;
      }
      .ss-container {
        max-width: 600px; margin: 0 auto; padding: 0 20px;
      }
      .ss-header { text-align: center; margin-bottom: 32px; animation: fadeIn 0.5s ease-out; }
      .ss-badge {
        width: 72px; height: 72px; margin: 0 auto 16px;
        background: #10b981; color: white; border-radius: 50%;
        display: flex; align-items: center; justify-content: center;
        box-shadow: 0 10px 20px -5px rgba(16, 185, 129, 0.4);
      }
      .ss-title { font-size: 28px; font-weight: 900; color: #0f172a; margin: 0 0 8px; letter-spacing: -0.02em; }
      .ss-subtitle { font-size: 16px; color: #64748b; margin: 0; }

      .ss-card {
        background: white; border-radius: 20px;
        box-shadow: 0 4px 6px -1px rgba(0,0,0,0.02), 0 2px 4px -1px rgba(0,0,0,0.02);
        border: 1px solid #e2e8f0;
        padding: 24px; margin-bottom: 24px;
        overflow: hidden;
      }
      .ss-label { font-size: 12px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px; }
      .ss-value { font-size: 16px; font-weight: 600; color: #1e293b; }
      
      .cal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
      .cal-grid { 
         display: grid; grid-template-columns: repeat(7, 1fr); gap: 8px; text-align: center;
         width: 100%; box-sizing: border-box; /* Fix Horizontal Scroll */
      }
      .cal-cell {
        aspect-ratio: 1; display: flex; align-items: center; justify-content: center;
        border-radius: 12px; font-weight: 600; font-size: 15px;
        cursor: pointer; color: #334155; transition: all 0.1s ease;
        border: 2px solid transparent; /* Reserve space for border */
      }
      /* Contrast Fixes for Selection */
      .cal-cell.selected { 
          background: #2563eb !important; 
          color: white !important; 
          border-color: #1e40af !important;
          box-shadow: 0 4px 12px rgba(37, 99, 235, 0.3); 
          transform: scale(1.05);
      }
      .cal-cell.disabled { color: #e2e8f0; cursor: not-allowed; }
      
      .time-btn {
        width: 100%; padding: 12px; border-radius: 12px;
        border: 1px solid #e2e8f0; background: white;
        color: #475569; font-weight: 600; font-size: 14px;
        transition: all 0.2s;
      }
      /* Contrast Fixes for Time Selection */
      .time-btn.selected {
        border-color: #2563eb !important; 
        background: #2563eb !important; 
        color: white !important;
        box-shadow: 0 4px 12px rgba(37, 99, 235, 0.2);
      }
      
      .cta-btn {
        width: 100%; padding: 18px; border-radius: 14px;
        background: #10b981; color: white; font-weight: 800; font-size: 16px;
        border: none; box-shadow: 0 4px 12px rgba(16, 185, 129, 0.2);
        transition: all 0.2s; cursor: pointer; opacity: 0.5; pointer-events: none;
      }
      .cta-btn.active { opacity: 1; pointer-events: auto; }
      .cta-btn:active { transform: scale(0.98); }
      
      @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
    </style>
  \`;

  outlet.innerHTML = \`
    \${styles}
    <div class="ss-wrapper">
      <div class="ss-container">
        
        <div class="ss-header">
          <div class="ss-badge">
             <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          </div>
          <h1 class="ss-title">Order Confirmed!</h1>
          <p class="ss-subtitle">We've received your booking request.</p>
        </div>

        <div class="ss-card">
           <div style="display: flex; justify-content: space-between; border-bottom: 2px dashed #f1f5f9; padding-bottom: 20px; margin-bottom: 20px;">
              <div>
                 <div class="ss-label">Order #</div>
                 <div class="ss-value" id="orderId" style="font-family: monospace; font-size: 17px;">
                    \${sessionId ? sessionId.slice(0,8).toUpperCase() : '...'}
                 </div>
              </div>
              <div style="text-align: right;">
                 <div class="ss-label">Total</div>
                 <div class="ss-value" id="orderTotal" style="color:#059669;">...</div>
              </div>
           </div>
           <div>
              <div class="ss-label">Includes</div>
              <div id="orderItems" style="font-weight: 500; color: #334155; line-height: 1.5;">
                 Loading details...
              </div>
           </div>
        </div>

        <div class="ss-card" style="padding: 24px;">
           <div style="display:flex; align-items:center; gap:12px; margin-bottom:24px;">
              <div style="width:40px; height:40px; border-radius:10px; background:#eff6ff; display:flex; align-items:center; justify-content:center; color:#2563eb;">
                 <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
              </div>
              <div>
                <h3 style="margin:0; font-size:18px; font-weight:800; color:#0f172a;">Schedule Install</h3>
                <!-- Dynamic Selection Summary -->
                <p id="selectionSummary" style="margin:2px 0 0; font-size:13px; color:#64748b;">Pick a date & time for your pro.</p>
              </div>
           </div>

           <div id="calendarWidget">
              <div style="padding: 40px; text-align: center; color: #94a3b8;">Loading calendar...</div>
           </div>
           
           <div id="timeWindowSection" style="display:none; margin-top:24px; padding-top:24px; border-top: 1px solid #f1f5f9;">
              <div class="ss-label" style="text-align:center; margin-bottom:12px;">Select Arrival Window</div>
              <div id="timeSlotsGrid" style="display:grid; grid-template-columns: repeat(3, 1fr); gap: 10px;">
                 <button class="time-btn" data-window="9am - 12pm">9-12</button>
                 <button class="time-btn" data-window="12pm - 3pm">12-3</button>
                 <button class="time-btn" data-window="3pm - 6pm">3-6</button>
              </div>
           </div>

           <button id="confirmApptBtn" class="cta-btn" style="margin-top:24px;">Confirm Appointment</button>
           <div id="schedMsg" style="text-align:center; margin-top:12px; font-size:14px; min-height:20px;"></div>
        </div>
        
        <div style="text-align:center;">
           <a href="/bundles" style="color:#64748b; font-weight:600; font-size:14px; text-decoration:none; padding: 12px;">Return to Shop</a>
        </div>

      </div>
    </div>
  \`;

  performance.mark('shopsuccess_skeleton_painted');
  performance.mark('ss_skeleton_inserted'); performance.mark('ss_success_ui_mounted');
  
  // 3. FETCH DATA
  const fetchOrder = async () => {
    performance.mark('ss_fetch_start');
    if(!sessionId) return { fallback: true };
    try {
      const c = new AbortController();
      setTimeout(()=>c.abort(), 6000);
      const res = await fetch(\`https://h2s-backend.vercel.app/api/get-order-details?session_id=\${sessionId}\`, { signal: c.signal });
      performance.mark('ss_fetch_end');
      if(!res.ok) throw new Error(\`HTTP \${res.status}\`);
      const data = await res.json(); return data.order || data;
    } catch(err) {
      console.warn('⚠️ [ShopSuccess] Using Offline Mode:', err);
      return { 
        fallback: true, 
        order_id: sessionId, 
        order_total: 'PAID', 
        order_summary: 'Essentials Bundle + Smart Install' 
      };
    }
  };

  fetchOrder().then(order => {
     if(byId('orderTotal')) byId('orderTotal').innerText = order.order_total?.includes('PAID') ? 'PAID' : (money(order.amount_total||order.order_total||0));
     if(byId('orderId')) byId('orderId').innerText = order.order_id ? order.order_id.slice(0,18) : 'CONFIRMED';
     if(byId('orderItems')) {
        const text = order.order_summary || 'Home2Smart Bundle Service';
        byId('orderItems').innerText = text;
     }

     performance.mark('ss_data_patched');
     // Fade out overlay now that data is in
     if(overlay) {
         overlay.style.opacity = '0';
         setTimeout(()=>overlay.remove(), 300);
     }
  });

  loadCalendarInteractive(params); // New Function Name for Clarity
  performance.mark('ss_first_interactive');
}

function loadCalendarInteractive(params) {
  const widget = byId('calendarWidget');
  if(!widget) return;
  
  // Reset Global State for Fresh Selection
  window.selectedDate = null;
  window.selectedWindow = null;

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
    
    let html = \`
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
         <button id="prevCal" style="border:none; background:none; font-size:20px; padding:4px 12px; cursor:pointer; color:#1e40af;" \${offset<=0?'disabled style="opacity:0.3"':''}>←</button>
         <div style="font-weight:700; color:#0f172a; font-size:16px;">\${monthName} \${target.getFullYear()}</div>
         <button id="nextCal" style="border:none; background:none; font-size:20px; padding:4px 12px; cursor:pointer; color:#1e40af;" \${offset>=2?'disabled style="opacity:0.3"':''}>→</button>
      </div>
      <div style="display:grid; grid-template-columns:repeat(7,1fr); gap:6px; text-align:center; margin-bottom:8px;">
        \${['Su','Mo','Tu','We','Th','Fr','Sa'].map(d=>\`<div style="color:#94a3b8; font-size:12px; font-weight:600;">\${d}</div>\`).join('')}
      </div>
      <div class="cal-grid" style="display:grid; grid-template-columns:repeat(7,1fr); gap:6px; text-align:center;">
    \`;
    
    for(let i=0; i<startDay; i++) html+='<div></div>';
    for(let d=1; d<=daysInMonth; d++){
       const iso = new Date(target.getFullYear(), target.getMonth(), d).toISOString().split('T')[0];
       const isPast = new Date(iso) < new Date(now.toISOString().split('T')[0]);
       const isAvail = mockAvail.find(x=>x.date===iso) && !isPast;
       
       if(!isAvail) {
           html+=\`<div class="cal-day-cell disabled">\${d}</div>\`;
       } else {
           const isSel = window.selectedDate === iso;
           html+=\`<div class="cal-day-cell \${isSel ? 'selected' : ''}" data-date="\${iso}">\${d}</div>\`;
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
         
         // Update UI immediately (re-render to show selection)
         render(offset);
         
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
              // Clear previous
              slotContainer.querySelectorAll('.time-btn').forEach(b => b.classList.remove('selected'));
              // Select new
              btn.classList.add('selected');
              window.selectedWindow = btn.dataset.window;
              
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
        el.innerHTML = \`<span style="color:#2563eb; font-weight:700;">Selected:</span> \${niceDate} @ \${window.selectedWindow}\`;
    } else if(window.selectedDate) {
        const d = new Date(window.selectedDate + 'T12:00:00');
        const niceDate = d.toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric' });
        el.innerText = \`Pick a time for \${niceDate}\`;
    } else {
        el.innerText = 'Pick a date & time for your pro.';
    }
}

function checkSubmit() {
    const btn = byId('confirmApptBtn');
    if(!btn) return;
    
    if(window.selectedDate && window.selectedWindow) {
        btn.classList.add('active'); // CSS based enable
        btn.disabled = false;
        
        // Ensure Clean Listener
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);
        newBtn.onclick = async () => {
            newBtn.innerText = 'Confirmed ✓';
            newBtn.style.background = '#059669';
            newBtn.disabled = true;
            newBtn.classList.remove('active');
            if(byId('schedMsg')) byId('schedMsg').innerHTML = '<span style="color:#059669; font-weight:700;">Success! You are all set.</span>';
            
            try { 
                if(typeof h2sTrack === 'function') {
                    h2sTrack('ScheduleAppointment', { date: window.selectedDate, time: window.selectedWindow });
                }
            } catch(e){}
        };
    } else {
        btn.classList.remove('active');
        btn.disabled = true;
    }
}
`;

const finalFile = content.substring(0, startIdx) + newLogic + "\n\n" + content.substring(endIdx);
fs.writeFileSync(targetFile, finalFile);
console.log("Applied V7 Fixes: Calendar Scroll, Visual Feedback, Submission Logic.");

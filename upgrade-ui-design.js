const fs = require('fs');
const path = require('path');

const targetFile = path.join(__dirname, 'bundles.js');
let content = fs.readFileSync(targetFile, 'utf8');

// === 1. LOCATE `renderShopSuccessView()` ===
const startMarker = "async function renderShopSuccessView() {";
const endMarker = "// 5. HOIST FIX"; // We used this before, it should be safe.

const startIdx = content.indexOf(startMarker);
const endIdx = content.indexOf(endMarker);

if (startIdx === -1 || endIdx === -1) {
    console.error("Could not locate renderShopSuccessView implementation.");
    process.exit(1);
}

// === 2. DEFINE THE UPGRADED IMPLEMENTATION ===
// Key improvements:
// - Removes pre-renderer overlay (#success-pre-overlay)
// - Removes hide style (#hide-content-temp)
// - Polished Typography (system-ui -> Archivo)
// - Better visual hierarchy in cards
// - Calendar Polish (Modern Grid, Rounded Selected State)

const newImplementation = `
async function renderShopSuccessView() {
  performance.mark('ss_route_start');
  performance.mark('shopsuccess_start');
  console.log('🔵 [renderShopSuccessView] START - UI Upgrade v6');

  // 1. CLEANUP PRE-RENDERER & PREPARE UI
  // Important: Remove the "hide content" style we added in the head
  const hider = document.getElementById('hide-content-temp');
  if(hider) hider.remove();

  // Remove the static overlay so our dynamic app takes over
  // (We'll do a quick fade-out if possible, but immediate removal is safer for interaction)
  const overlay = document.getElementById('success-pre-overlay');
  if(overlay) overlay.style.display = 'none'; // Keep DOM, hide visual to avoid shifts

  window.scrollTo(0, 0);
  document.documentElement.style.overflow = 'auto'; 
  document.documentElement.style.height = '100%';
  document.body.style.overflow = 'auto'; 
  document.body.style.height = '100%';
  document.body.style.backgroundColor = '#f8fafc'; // Matches card bg context better

  const params = new URLSearchParams(window.location.search);
  const sessionId = params.get('session_id') || params.get('stripe_session_id');
  
  // 2. RENDER UPGRADED UI
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
      
      /* Headers */
      .ss-header { text-align: center; margin-bottom: 32px; animation: fadeIn 0.5s ease-out; }
      .ss-badge {
        width: 72px; height: 72px; margin: 0 auto 16px;
        background: #10b981; color: white; border-radius: 50%;
        display: flex; align-items: center; justify-content: center;
        box-shadow: 0 10px 20px -5px rgba(16, 185, 129, 0.4);
      }
      .ss-title { font-size: 28px; font-weight: 900; color: #0f172a; margin: 0 0 8px; letter-spacing: -0.02em; }
      .ss-subtitle { font-size: 16px; color: #64748b; margin: 0; }

      /* Cards */
      .ss-card {
        background: white; border-radius: 20px;
        box-shadow: 0 4px 6px -1px rgba(0,0,0,0.02), 0 2px 4px -1px rgba(0,0,0,0.02);
        border: 1px solid #e2e8f0;
        padding: 24px; margin-bottom: 24px;
        overflow: hidden;
      }
      
      .ss-label { font-size: 12px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px; }
      .ss-value { font-size: 16px; font-weight: 600; color: #1e293b; }
      
      /* Calendar Specifics */
      .cal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
      .cal-btn { background: none; border: none; padding: 8px; cursor: pointer; color: #3b82f6; transition: opacity 0.2s; }
      .cal-btn:disabled { opacity: 0.3; cursor: default; }
      .cal-title { font-weight: 800; font-size: 17px; color: #0f172a; }
      
      .cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 8px; text-align: center; }
      .cal-day-lbl { font-size: 12px; font-weight: 700; color: #cbd5e1; margin-bottom: 8px; }
      .cal-cell {
        aspect-ratio: 1; display: flex; align-items: center; justify-content: center;
        border-radius: 12px; font-weight: 600; font-size: 15px;
        cursor: pointer; color: #334155; transition: all 0.15s ease;
        border: 1px solid transparent;
      }
      .cal-cell:hover:not(.disabled) { background: #eff6ff; color: #2563eb; }
      .cal-cell.selected { background: #2563eb; color: white; box-shadow: 0 4px 12px rgba(37, 99, 235, 0.3); transform: scale(1.05); }
      .cal-cell.disabled { color: #e2e8f0; cursor: not-allowed; }
      
      /* Time Slots */
      .time-btn {
        width: 100%; padding: 12px; border-radius: 12px;
        border: 1px solid #e2e8f0; background: white;
        color: #475569; font-weight: 600; font-size: 14px;
        transition: all 0.2s;
      }
      .time-btn.selected {
        border-color: #2563eb; background: #eff6ff; color: #1e40af;
        box-shadow: 0 0 0 2px #bfdbfe;
      }
      
      .cta-btn {
        width: 100%; padding: 18px; border-radius: 14px;
        background: #10b981; color: white; font-weight: 800; font-size: 16px;
        border: none; box-shadow: 0 4px 12px rgba(16, 185, 129, 0.2);
        transition: all 0.2s; cursor: pointer;
      }
      .cta-btn:active { transform: scale(0.98); }
      .cta-btn:disabled { background: #94a3b8; cursor: not-allowed; box-shadow: none; }
      
      @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
    </style>
  \`;

  outlet.innerHTML = \`
    \${styles}
    <div class="ss-wrapper">
      <div class="ss-container">
        
        <!-- Header -->
        <div class="ss-header">
          <div class="ss-badge">
             <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          </div>
          <h1 class="ss-title">Order Confirmed!</h1>
          <p class="ss-subtitle">We've received your booking request.</p>
        </div>

        <!-- Receipt Card -->
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

        <!-- Calendar Card -->
        <div class="ss-card" style="padding: 24px;">
           <div style="display:flex; align-items:center; gap:12px; margin-bottom:24px;">
              <div style="width:40px; height:40px; border-radius:10px; background:#eff6ff; display:flex; align-items:center; justify-content:center; color:#2563eb;">
                 <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
              </div>
              <div>
                <h3 style="margin:0; font-size:18px; font-weight:800; color:#0f172a;">Schedule Install</h3>
                <p style="margin:2px 0 0; font-size:13px; color:#64748b;">Pick a date & time for your pro.</p>
              </div>
           </div>

           <div id="calendarWidget">
              <div style="padding: 40px; text-align: center; color: #94a3b8;">Loading calendar...</div>
           </div>
           
           <div id="timeWindowSection" style="display:none; margin-top:24px; padding-top:24px; border-top: 1px solid #f1f5f9;">
              <div class="ss-label" style="text-align:center; margin-bottom:12px;">Select Arrival Window</div>
              <div style="display:grid; grid-template-columns: repeat(3, 1fr); gap: 10px;">
                 <button class="time-btn" data-window="9am - 12pm">9-12</button>
                 <button class="time-btn" data-window="12pm - 3pm">12-3</button>
                 <button class="time-btn" data-window="3pm - 6pm">3-6</button>
              </div>
           </div>

           <button id="confirmApptBtn" class="cta-btn" style="margin-top:24px;" disabled>Select Date & Time</button>
           <div id="schedMsg" style="text-align:center; margin-top:12px; font-size:14px; min-height:20px;"></div>
        </div>
        
        <div style="text-align:center;">
           <a href="/bundles" style="color:#64748b; font-weight:600; font-size:14px; text-decoration:none; padding: 12px;">Return to Shop</a>
        </div>

      </div>
    </div>
  \`;

  performance.mark('shopsuccess_skeleton_painted');
  performance.mark('ss_skeleton_inserted'); 
  performance.mark('ss_success_ui_mounted');
  
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
     // Hide Overlay completely once data is patched to look smooth
     if(overlay) overlay.remove();
  });

  loadCalendarRobust3();
  performance.mark('ss_first_interactive');
}
`;

// === 3. REPLACE IMPLEMENTATION ===
const finalFile = content.substring(0, startIdx) + newImplementation + "\n\n" + content.substring(endIdx);
fs.writeFileSync(targetFile, finalFile);
console.log("Successfully upgraded bundles.js to v6 (UI Polish + Bug Fix)");

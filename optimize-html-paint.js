const fs = require('fs');
const path = require('path');

const htmlPath = path.join(__dirname, 'bundles.html');
let html = fs.readFileSync(htmlPath, 'utf8');

// === 1. LOCATE AND REMOVE OLD PRE-RENDERER ===
const preRenderMarker = "// ⚡ INSTANT SHOP SUCCESS PRE-RENDERER ⚡";
if (html.includes(preRenderMarker)) {
    const startIndex = html.lastIndexOf('<script>\n' + preRenderMarker); // Find the last one? Or first?
    // In previous steps I put it at line 3235.
    // It's wrapped in <script> ... </script>
    const simpleStart = html.indexOf(preRenderMarker);
    const wrapStart = html.lastIndexOf('<script>', simpleStart);
    const wrapEnd = html.indexOf('</script>', simpleStart) + 9;
    
    if (wrapStart !== -1 && wrapEnd !== -1) {
        // Cut it out
        html = html.substring(0, wrapStart) + html.substring(wrapEnd);
        console.log("Removed old Pre-Renderer.");
    }
}

// === 2. CREATE NEW "BODY PREPEND" PRE-RENDERER ===
// This version injects a fixed overlay immediately, without needing #outlet to exist yet.
const newPreRenderer = `
<script>
// ⚡ INSTANT SHOP SUCCESS PRE-RENDERER v2 (BODY PREPEND) ⚡
(function(){
  try {
    const p = new URLSearchParams(location.search);
    if(p.get('view') === 'shopsuccess') {
      console.log('⚡ [PreRender] Prepended Overlay');
      
      // Inject CSS immediately
      const style = document.createElement('style');
      style.innerHTML = \`
        #success-pre-overlay {
          position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
          background: #ffffff; z-index: 2147483647; 
          padding-top: max(env(safe-area-inset-top), 60px);
          text-align: center; overflow-y: auto; -webkit-overflow-scrolling: touch;
          font-family: system-ui, -apple-system, sans-serif;
        }
        .sp-badge {
           width: 80px; height: 80px; margin: 0 auto 20px;
           background: linear-gradient(135deg, #10b981, #059669);
           border-radius: 50%; display: flex; align-items: center; justify-content: center;
        }
        .sp-card {
           background: #f8fafc; border: 1px solid #e2e8f0; 
           margin: 0 20px 20px; padding: 24px; border-radius: 16px;
           max-width: 600px; margin-left: auto; margin-right: auto;
        }
      \`;
      document.head.appendChild(style);

      // Create Overlay
      const div = document.createElement('div');
      div.id = 'success-pre-overlay';
      div.innerHTML = \`
        <div class="sp-badge">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
        </div>
        <h2 style="margin:0 0 8px; font-weight:900; font-size:28px; color:#0f172a;">Order Confirmed!</h2>
        <p style="color:#64748b; font-size:16px; margin-bottom:32px;">Thank you for choosing Home2Smart</p>
        <div class="sp-card">
          <div style="height:20px; background:#e2e8f0; border-radius:4px; margin-bottom:12px; width:60%; margin:0 auto 12px;"></div>
          <div style="height:30px; background:#cbd5e1; border-radius:4px; width:40%; margin:0 auto;"></div>
        </div>
      \`;
      
      // Prepend to body
      if(document.body) {
          document.body.prepend(div);
          // Hides the rest of the page content until JS handles it or we decide to remove overlay
          // Actually, we WANT to hide #pageShell or whatever if it exists
          const styleHide = document.createElement('style');
          styleHide.id = 'hide-content-temp';
          styleHide.innerHTML = '#pageShell, #mainView { display: none !important; }';
          document.head.appendChild(styleHide);
      } else {
          // If script is in HEAD? No, we will put this after body start.
          document.addEventListener('DOMContentLoaded', () => {
             document.body.prepend(div);
          });
      }
      
      performance.mark('shopsuccess_skeleton_painted'); // Early mark
    }
  } catch(e) { console.error(e); }
})();
</script>
`;

// === 3. INSERT INTO HTML AT TOP OF BODY ===
const bodyStart = '<body';
const bodyTagEnd = '>';
const bodyIdx = html.indexOf(bodyStart);

if (bodyIdx !== -1) {
    const tagEnd = html.indexOf(bodyTagEnd, bodyIdx);
    if (tagEnd !== -1) {
        // insert after <body>
        const insertionPoint = tagEnd + 1;
        html = html.substring(0, insertionPoint) + "\n" + newPreRenderer + "\n" + html.substring(insertionPoint);
        console.log("Inserted Pre-Renderer v2 at top of BODY.");
    }
} else {
    console.error("Could not find <body> tag!");
}

// === 4. CLEAN UP JS INSTRUMENTATION ===
//bundles_exec_to_data_patched was -1 because of typo or timing.
//The JS instrumentation for data_patched is "performance.mark('ss_data_patched')"
//Let's check if the code path actually works.
//Wait, in bundles.js v5 patch I wrote:
/*
  fetchOrder().then(order => {
     // ...
     performance.mark('shopsuccess_data_patched');
     // ...
  });
*/
// And in instrument-and-fix.js I replaced that with:
// "performance.mark('shopsuccess_data_patched'); performance.mark('ss_data_patched');"
// The issue is: if fetch takes 100ms, and report takes 1500ms, it should be there.
// Maybe the user closed the page too fast?
// Or maybe fetchOrder() isn't resolving?

fs.writeFileSync(htmlPath, html);

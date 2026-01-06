const fs = require('fs');
const path = require('path');

const htmlPath = path.join(__dirname, 'bundles.html');
let html = fs.readFileSync(htmlPath, 'utf8');

const preRenderScript = `
<script>
// ⚡ INSTANT SHOP SUCCESS PRE-RENDERER ⚡
// This runs BEFORE the main bundle downloads, guaranteeing < 50ms paint
(function(){
  try {
    const params = new URLSearchParams(window.location.search);
    if(params.get('view') === 'shopsuccess') {
      console.log('⚡ [PreRender] Shop Success detected');
      
      // 1. Force styling immediately
      document.documentElement.style.overflow = 'auto';
      document.body.style.overflow = 'auto';
      document.body.style.height = '100%';
      document.body.style.backgroundColor = '#ffffff';
      
      // 2. Inject Skeleton HTML
      const outlet = document.getElementById('outlet');
      if(outlet) {
        outlet.innerHTML = \`
          <style>
            .success-pre-wrapper {
               min-height: 100vh; width: 100%; background: white;
               padding-top: max(env(safe-area-inset-top), 60px);
               text-align: center;
               font-family: system-ui, -apple-system, sans-serif;
            }
            .success-pre-badge {
               width: 80px; height: 80px; margin: 0 auto 20px;
               background: linear-gradient(135deg, #10b981, #059669);
               border-radius: 50%;
               display: flex; align-items: center; justify-content: center;
               box-shadow: 0 10px 20px rgba(16, 185, 129, 0.3);
            }
            .pre-card {
               background: #f8fafc; border: 1px solid #e2e8f0; 
               margin: 0 20px 20px; padding: 24px; border-radius: 16px;
            }
          </style>
          <div class="success-pre-wrapper">
            <div class="success-pre-badge">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
            </div>
            <h2 style="margin:0 0 8px; font-weight:900; font-size:28px; color:#0f172a;">Order Confirmed!</h2>
            <p style="color:#64748b; font-size:16px; margin-bottom:32px;">Thank you for choosing Home2Smart</p>
            
            <div class="pre-card">
              <div style="height:20px; background:#e2e8f0; border-radius:4px; margin-bottom:12px; width:60%; margin-left:auto; margin-right:auto;"></div>
              <div style="height:30px; background:#cbd5e1; border-radius:4px; width:40%; margin-left:auto; margin-right:auto;"></div>
            </div>
          </div>
        \`;
        console.log('⚡ [PreRender] Skeleton painted');
      }
    }
  } catch(e) { console.error('⚡ [PreRender] Failed', e); }
})();
</script>
`;

// Check if already present (to avoid dupe)
if(html.includes("INSTANT SHOP SUCCESS PRE-RENDERER")) {
    console.log("Pre-Renderer already present. Skipping insertion.");
} else {
    // Insert after <div id="outlet">
    const marker = '<div id="outlet">';
    const idx = html.indexOf(marker);
    if(idx !== -1) {
        // Insert after the marker (and potential newline)
        html = html.slice(0, idx + marker.length) + "\n" + preRenderScript + html.slice(idx + marker.length);
        fs.writeFileSync(htmlPath, html);
        console.log("Successfully inserted Pre-Renderer after #outlet.");
    } else {
        console.error("STILL could not find #outlet!");
    }
}

const fs = require('fs');
const path = require('path');

const jsPath = path.join(__dirname, 'bundles.js');
let js = fs.readFileSync(jsPath, 'utf8');

// 1. Add ss_bundles_first_line at the VERY TOP
if (!js.includes("ss_bundles_first_line")) {
    js = "performance.mark('ss_bundles_first_line');\n" + js;
    console.log("Added ss_bundles_first_line.");
}

// 2. Clear marks/measures logic
const reportLogic = `
// === PERFORMANCE REPORTING 2.0 ===
if(location.search.includes('view=shopsuccess')){
    // Log Nav Timing immediately
    const nav = performance.getEntriesByType('navigation')[0];
    if(nav) {
        console.log('[NAV TIMING]', {
          redirect: nav.redirectEnd - nav.redirectStart,
          dns: nav.domainLookupEnd - nav.domainLookupStart,
          connect: nav.connectEnd - nav.connectStart,
          ttfb: nav.responseStart - nav.requestStart,
          download: nav.responseEnd - nav.responseStart,
          domContentLoaded: nav.domContentLoadedEventEnd - nav.startTime,
          loadEvent: nav.loadEventEnd - nav.startTime
        });
    }

    // Report Logic
    window.addEventListener('load', () => {
        setTimeout(() => {
             // Clear old marks to avoid noise? No, let's just measure carefully.
             // performance.clearMeasures(); // Optional clean up

             const ms = (a, b) => {
                 try {
                     performance.measure(a+'_to_'+b, a, b);
                     return performance.getEntriesByName(a+'_to_'+b)[0].duration;
                 } catch(e) { return -1; }
             };

             console.log('[SS TIMING]', {
               head_to_bundles_first_line: ms('ss_nav_head_start','ss_bundles_first_line'),
               bundles_exec_to_skeleton: ms('ss_entry','ss_skeleton_inserted'),
               bundles_exec_to_ui_mounted: ms('ss_entry','ss_success_ui_mounted'),
               fetch_duration: ms('ss_fetch_start','ss_fetch_end'),
               bundles_exec_to_data_patched: ms('ss_entry','ss_data_patched'),
               bundles_exec_to_interactive: ms('ss_entry','ss_first_interactive')
             });
        }, 1500);
    });
}
`;

// Replace old reporting logic if exists, or append
if (js.includes("PERF REPORT")) {
    // Attempt to remove old block roughly - finding start/end is tricky without robust parser
    // Let's just append the new one at the bottom, it will run also.
    // Or better, replace the old string marker
    js = js.replace(/console\.log\('📊 \[PERF REPORT\]'.+?\);/s, "// Old Report Replaced"); 
    js += "\n" + reportLogic;
    console.log("Replaced/Added Report 2.0");
} else {
    js += "\n" + reportLogic;
    console.log("Added Report 2.0");
}

fs.writeFileSync(jsPath, js);
console.log("Updated bundles.js instrumentation.");

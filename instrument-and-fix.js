const fs = require('fs');
const path = require('path');

const htmlPath = path.join(__dirname, 'bundles.html');
const jsPath = path.join(__dirname, 'bundles.js');

// === 1. FIX BUNDLES.HTML (MOVE PRE-RENDERER) ===
let html = fs.readFileSync(htmlPath, 'utf8');

const preRenderStart = "// ⚡ INSTANT SHOP SUCCESS PRE-RENDERER ⚡";
const scriptOpen = "<script>\n" + preRenderStart;
const scriptClose = "</script>";

// Find the script block containing the pre-renderer
const startIdx = html.indexOf(scriptOpen);
if (startIdx !== -1) {
    const endIdx = html.indexOf(scriptClose, startIdx);
    if (endIdx !== -1) {
        const fullScriptBlock = html.substring(startIdx, endIdx + scriptClose.length);
        
        // Remove from old location
        html = html.replace(fullScriptBlock, "");
        console.log("Removed Pre-Renderer from bottom.");

        // Insert at new top location
        const targetMarker = '<main id="mainView">\n<div id="outlet">';
        const insertIdx = html.indexOf(targetMarker);
        
        if (insertIdx !== -1) {
            const insertPoint = insertIdx + targetMarker.length;
            html = html.substring(0, insertPoint) + "\n" + fullScriptBlock + "\n" + html.substring(insertPoint);
            console.log("Inserted Pre-Renderer at top (after #outlet).");
        } else {
            console.error("Could not find #outlet to insert Pre-Renderer!");
        }
    }
} else {
    console.warn("Pre-Renderer script not found in bundles.html (maybe already moved?)");
}

fs.writeFileSync(htmlPath, html);

// === 2. INSTRUMENT BUNDLES.JS ===
let js = fs.readFileSync(jsPath, 'utf8');

// A. Entry Mark
if (!js.includes("performance.mark('ss_entry')")) {
    js = "performance.mark('ss_entry');\n" + js;
    console.log("Added ss_entry mark.");
}

// B. Route Start
const routeStart = "async function renderShopSuccessView() {";
if (js.includes(routeStart) && !js.includes("performance.mark('ss_route_start')")) {
    js = js.replace(routeStart, routeStart + "\n  performance.mark('ss_route_start');");
    console.log("Added ss_route_start mark.");
}

// C. Skeleton & UI Mounted (Reuse existing location or add)
const skeletonMark = "performance.mark('shopsuccess_skeleton_painted');";
const newSkeletonMarks = "performance.mark('shopsuccess_skeleton_painted'); performance.mark('ss_skeleton_inserted'); performance.mark('ss_success_ui_mounted');";

if (js.includes(skeletonMark) && !js.includes("ss_skeleton_inserted")) {
    js = js.replace(skeletonMark, newSkeletonMarks);
    console.log("Added ss_skeleton_inserted/ss_success_ui_mounted marks.");
}

// D. Fetch Start/End
const fetchStart = "const fit = async () => {"; // Wait, finding the fetch function might be hard if it's arrow
// Looking for: const fetchOrder = async () => {
const fetchDef = "const fetchOrder = async () => {";
if (js.includes(fetchDef) && !js.includes("ss_fetch_start")) {
    js = js.replace(fetchDef, fetchDef + "\n    performance.mark('ss_fetch_start');");
    console.log("Added ss_fetch_start mark.");
}

// Fetch End (inside the try/catch or before return)
// The function has "return await res.json();" (or my patched version)
// Let's just wrap the fetch call itself or put it before the return.
const fetchCall = "const res = await fetch(`https://h2s-backend.vercel.app/api/get-order-details";
// This is fragile. Let's look for "if(!res.ok)" which is standard.
const resCheck = "if(!res.ok) throw new Error";
if (js.includes(resCheck) && !js.includes("ss_fetch_end")) {
    js = js.replace(resCheck, "performance.mark('ss_fetch_end');\n      " + resCheck);
    console.log("Added ss_fetch_end mark.");
}

// E. Data Patched
const dataPatchMark = "performance.mark('shopsuccess_data_patched');";
if (js.includes(dataPatchMark) && !js.includes("ss_data_patched")) {
    js = js.replace(dataPatchMark, dataPatchMark + " performance.mark('ss_data_patched');");
    console.log("Added ss_data_patched mark.");
}

// F. Interactive
const interactive = "loadCalendarRobust3();";
if (js.includes(interactive) && !js.includes("ss_first_interactive")) {
    js = js.replace(interactive, interactive + "\n  performance.mark('ss_first_interactive');");
    console.log("Added ss_first_interactive mark.");
}

// G. Init Start (Global scope or DOMContentLoaded)
// We'll put it after the initial logger.
const loggerLog = "logger.log('[BundlesJS] Script loaded and executing');";
if (js.includes(loggerLog) && !js.includes("ss_init_start")) {
    js = js.replace(loggerLog, loggerLog + "\nperformance.mark('ss_init_start');");
    console.log("Added ss_init_start mark.");
}

// H. REPORTING FUNCTION
const reportCode = `
// === PERFORMANCE REPORTING ===
if(location.search.includes('view=shopsuccess')){
    window.addEventListener('load', () => {
        setTimeout(() => {
            const m = (name) => performance.getEntriesByName(name)[0]?.startTime || 0;
            const entry = m('ss_entry');
            if(!entry) return;

            const report = {
                'entry_to_skeleton': m('ss_skeleton_inserted') - entry,
                'entry_to_ui_mounted': m('ss_success_ui_mounted') - entry,
                'fetch_duration': m('ss_fetch_end') - m('ss_fetch_start'),
                'entry_to_data_patched': m('ss_data_patched') - entry,
                'entry_to_interactive': m('ss_first_interactive') - entry
            };
            console.log('📊 [PERF REPORT]', JSON.stringify(report, null, 2));
        }, 1000); // Wait for async ops
    });
}
`;

if (!js.includes("[PERF REPORT]")) {
    js += "\n" + reportCode;
    console.log("Added Performance Reporting code.");
}

fs.writeFileSync(jsPath, js);
console.log("Instrumented bundles.js and fixed bundles.html");

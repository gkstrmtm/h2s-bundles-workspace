const fs = require('fs');
const path = require('path');

const files = [
    path.resolve(__dirname, '../portal.html'),
    path.resolve(__dirname, '../frontend/portal.html')
];

files.forEach(file => {
    if (!fs.existsSync(file)) {
        console.log('Skipping missing file:', file);
        return;
    }

    console.log('Processing:', file);
    let content = fs.readFileSync(file, 'utf8');

    // 1. UPDATE VERSION
    const newVersion = `VERSION: ${new Date().toISOString().split('T')[0]}_SAFE_v3`;
    content = content.replace(/VERSION: \d{4}-\d{2}-\d{2}[^-\n<]*/, newVersion);
    content = content.replace(/PORTAL VERSION: \d{4}-\d{2}-\d{2}[^'\n]*/, `PORTAL VERSION: ${newVersion}`);

    // 2. FIX BULLETS (Replace literal '?' placeholders with '&bull;')
    // Fix: bullets.push(`? ...
    content = content.replace(/bullets\.push\(`\? /g, "bullets.push(`&bull; ");
    content = content.replace(/bullets\.push\('\? /g, "bullets.push('&bull; ");
    
    // Fix: bullets.push(`? Coverage
    content = content.replace(/bullets\.push\(`\? Coverage:/g, "bullets.push(`&bull; Coverage:");
    
    // Fix: bullets.push(`? <span...
    // The previous fix might have caught this if it was a bullet, but if it was a ?, catch it now.
    
    // Fix: equipment icon placeholders 
    // const equipIcon = ... ? '?' : ... '?' : '?';
    // We want to replace the question marks used as icons with bullets or empty?
    // User complaint was about "broken characters". '?' often implies missing icon.
    // Let's replace them with bullets for safety, or just leave them if they are logic?
    // "Smart Home Bundle" screenshot didn't show this.
    // "Full Perimeter" showed "? 8 Cameras".
    // That means `?` was printed.
    
    // 3. FIX HOISTING (proAnnouncementsCache)
    // Identify the utility definition to inject globals before it
    const utilDef = "const $ = id => document.getElementById(id);";
    if (content.includes(utilDef)) {
        const globalInjection = `
/* FIXED GLOBALS for Announcements */
window.proAnnouncementsCache = [];
window.viewedAnnouncementIds = new Set();
${utilDef}`;
        content = content.replace(utilDef, globalInjection);
        console.log('  - Injected globals');
    } else {
        console.error('  - Could not find utility definition for injection');
    }

    // Remove the 'let' declarations that cause the ReferenceError
    // Pattern: let proAnnouncementsCache = [];
    content = content.replace(/let proAnnouncementsCache = \[\];/g, "// let proAnnouncementsCache = []; // Handled globals");
    content = content.replace(/let viewedAnnouncementIds = new Set\(\);/g, "// let viewedAnnouncementIds = new Set(); // Handled globals");

    fs.writeFileSync(file, content, 'utf8');
    console.log('Fixed:', file);
});

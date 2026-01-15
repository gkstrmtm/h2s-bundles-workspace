const fs = require('fs');
const path = require('path');

const files = [
    path.resolve(__dirname, '../../portal.html'),
    path.resolve(__dirname, '../../frontend/portal.html')
];

files.forEach(file => {
    if (!fs.existsSync(file)) return;
    
    console.log(`Processing ${file}...`);
    let content = fs.readFileSync(file, 'utf8');

    // 1. VERSION UPDATE
    const newVersion = `VERSION: ${new Date().toISOString().split('T')[0]}_SAFE_v4`;
    content = content.replace(/VERSION: \d{4}-\d{2}-\d{2}[^-\n<]*/, newVersion);
    content = content.replace(/PORTAL VERSION: \d{4}-\d{2}-\d{2}[^'\n]*/, `PORTAL VERSION: ${newVersion}`);

    // 2. FIX LITERAL "??" and "?" ARTIFACTS
    // These are places where previous fixes replaced unicode with '?' or where '?' was typed
    
    // Fix: "?? Just updated" -> "⚡ Just updated" (Use emoji or safe icon?)
    // Let's use simple ASCII chars or entities to be safe. "⚡" is unicode.
    // User hates broken chars. Let's use HTML entities for icons if possible, or SVG.
    // Or just text. "Updated:"
    
    // "?? Just updated" -> "Updated now"
    content = content.replace(/'\?\? Just updated'/g, "'Updated now'");
    content = content.replace(/`\?\? \${seconds}s ago`/g, "`Updated ${seconds}s ago`"); 
    content = content.replace(/`\?\? \${minutes}m ago`/g, "`Updated ${minutes}m ago`");

    // Fix: "?? Loading announcements" (Console logs) -> ">> Loading announcements"
    content = content.replace(/`\[Announcements\] \?\? /g, "`[Announcements] >> ");
    content = content.replace(/console\.log\('\[Announcements\] \?\? /g, "console.log('[Announcements] >> ");
    content = content.replace(/console\.log\('\?\? /g, "console.log('>> ");
    content = content.replace(/console\.log\('\? /g, "console.log('> ");
    content = content.replace(/console\.log\(' \? /g, "console.log(' > ");

    // Fix: "?? Initializing portal"
    content = content.replace(/console\.log\("\?\? FAST LOAD/g, 'console.log(">> FAST LOAD');

    // Fix: "bullet ?? <span..." (The "Pre-call required" line)
    // The previous fix produced `&bull; ?? <span...`
    // We want `&bull; ⚠️ <span...` but wait, ⚠️ is unicode! 
    // If unicode is breaking, use <span class="emoji">⚠️</span> or just "ALERT:"
    // The user screenshot shows ?? next to pre-call.
    // Let's use HTML entity for warning triangle: &#9888; (⚠) 
    content = content.replace(/&bull; \?\? <span/g, "&bull; &#9888; <span");
    
    // Fix: "equipIcon ... '?' : ... '?' : '?'"
    // Previously detected as `const equipIcon = ... ? '?' : '?'`
    // Let's replace those placeholders with meaningful text or entities
    // '?' (first) -> 'Equipment Provided' icon -> &#128230; (📦)
    // '?' (second) -> 'Customer-Supplied' -> &#128100; (👤)
    // '?' (third) -> Unknown -> &#10067; (❓)
    // BUT encoding is the issue. Let's use FontAwesome? No, we don't have it.
    // Let's use simple ASCII like [PRO] [CUST] [?]
    // Or just empty string if icons are hard.
    // Let's try HTML entities: &#x1F4E6; (Package), etc.
    // Actually, looking at the code:
    // const equipIcon = cameraDetails.equipment_mode === 'Equipment Provided' ? '?' : ...
    // Text replacement for literal question marks in that specific context:
    content = content.replace(/context === 'Equipment Provided' \? '\?' :/g, "context === 'Equipment Provided' ? '&#128230;' :");
    // That regex is too specific, let's find the `const equipIcon` block
    
    // We'll replace the whole block via regex if possible, or just the specific logic
    // Detected line: const equipIcon = cameraDetails.equipment_mode === 'Equipment Provided' ? '?' : 
    // It is literal '?' in the file.
    content = content.replace(
        /const equipIcon = cameraDetails\.equipment_mode === 'Equipment Provided' \? '\?' : \s*cameraDetails\.equipment_mode === 'Customer-Supplied' \? '\?' : '\?';/,
        "const equipIcon = cameraDetails.equipment_mode === 'Equipment Provided' ? '&#128230;' : cameraDetails.equipment_mode === 'Customer-Supplied' ? '&#128100;' : '';"
    );

    // 3. MENU ICONS (The "Menu" screenshot shows ?)
    // These are likely CSS `content: "?"` or literal text in the menu link list
    // Let's look for "Account" link
    // <a href="#view=account" ...>Account <span ...>?</span></a>
    // We need to find where that list is generated.
    
    // In `portal.html`, the menu is simple.
    // <div id="menuBox"> ... <a ...>Dashboard <span>?</span></a>
    // Let's replace those spans.
    // Pattern: `<span>?</span></a>` or similar.
    // Actually, in the Grep search earlier for "Dashboard", I didn't see the menu HTML.
    // It might be generated dynamically.
    
    // Replaces all remaining literal `?` that are being used as icons (heuristically)
    // If it's `<span>?</span>`, replace with `<span>&#10095;</span>` (Chevron >)
    content = content.replace(/<span>\?<\/span>/g, "<span>&#10095;</span>");
    
    // 4. CLEANUP ANY REMAINING UNICODE REPLACEMENT CHARS ()
    // The scan found 2 of them.
    content = content.replace(/\uFFFD/g, "&bull;");

    fs.writeFileSync(file, content, 'utf8');
    console.log(`Fixed ${file}`);
});

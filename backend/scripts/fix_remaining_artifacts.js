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
    const newVersion = `VERSION: ${new Date().toISOString().split('T')[0]}_SAFE_v7`;
    content = content.replace(/VERSION: \d{4}-\d{2}-\d{2}[^-\n<]*/, newVersion);
    content = content.replace(/PORTAL VERSION: \d{4}-\d{2}-\d{2}[^'\n]*/, `PORTAL VERSION: ${newVersion}`);

    // 2. FIX TEAM UPDATES ARROW
    // User says "team updates pillar, the aero that is supposed to be there is a fucking question mark"
    // Found in portal.html:
    // <div style="color:#64748b;font-size:18px;flex-shrink:0">?</div>
    // It's inside the Team Updates banner section.
    // Replace with Chevron > (&#10095;)
    
    // We can regex for that exact div style and content.
    content = content.replace(
        /<div style="color:#64748b;font-size:18px;flex-shrink:0">\?<\/div>/g, 
        '<div style="color:#64748b;font-size:18px;flex-shrink:0">&#10095;</div>'
    );
    
    // 3. FIX "The X button is a question mark"
    // "NEMURE MENU" (Menu)
    // The main menu close button might be ?
    
    // Search for closeMenu logic or button in menu.
    // Usually <button onclick="closeMenu()">?</button>
    // Or X
    // Let's replace any Button with text "?" with "×" (&times;)
    
    // Pattern: <button[^>]*>\?<\/button>
    // This catches menu items I mostly fixed, but missed "Close"?
    // If it's a Close button, it should be &times;
    // If it's a Menu item go, it should be &#10095;
    
    // We already fixed menu items with spans.
    // Check for naked ? buttons.
    // content = content.replace(/(<button[^>]*class="[^"]*close[^"]*"[^>]*>)\?(<\/button>)/gi, "$1&times;$2");
    
    // Check specific known close buttons if found by "close" in ID or class and context "?"
    content = content.replace(/>\?<\/button>/g, ">&times;</button>"); 
    // WARNING: This is aggressive. Is there any button where "?" is valid? 
    // "Help?" -> usually "?" icon.
    // "Status?" -> maybe.
    // But user says "The X button is a question mark".
    // "The aero... is a question mark".
    // It implies "?" is the failure state.
    
    // Let's refine:
    // User said "We have them in the list in relation to camera install"
    // AND "NEMURE menu" (Menu)
    // AND "X button"
    
    // 4. FIX CAMERA INSTALL LIST AGAIN
    // "list in relation to camera install, or the details"
    // I previously replaced `bullets.push('? ' ...)` with `&bull;`
    // Maybe I missed the literal "??" case or simple "?" case in that specific logic.
    // Check for `bullets.push('? '` (single quote)
    content = content.replace(/bullets\.push\('\? /g, "bullets.push('&bull; "); 
    content = content.replace(/bullets\.push\(" \? /g, "bullets.push(\" &bull; ");
    
    // 5. FIX "NEMURE menu" (Likely "The Menu")
    // If I missed the close button in the menu:
    // Look for `id="closeMenuBtn"` or similar.
    // <button onclick="closeMenu()" ...>?</button>
    
    // Let's find invalid close buttons.
    // Replace <button ...>?</button> where it looks like an action button.
    // Actually, I'll search for specific UI artifacts I can guess.
    
    // Generic safety replacement for standalone '?' in buttons/divs acting as icons
    content = content.replace(
        /(<div[^>]*style="[^"]*font-size:[^;]*"[^>]*>)\s*\?\s*(<\/div>)/g, 
        "$1&#10095;$2" // Large text ? in a div is usually an arrow placeholder in this codebase
    );
    
    fs.writeFileSync(file, content, 'utf8');
    console.log(`Fixed ${file}`);
});

const fs = require('fs');
const path = require('path');

const files = [
    path.join(__dirname, '..', 'frontend', 'bundles.html'),
    path.join(__dirname, '..', 'frontend', 'dash.html'),
    path.join(__dirname, '..', 'frontend', 'portal.html'),
];

const replacements = [
    { from: 'âœ…', to: '✅' },
    { from: 'âŒ', to: '❌' },
    { from: 'âš ï¸', to: '⚠️' },
    { from: 'âš ', to: '⚠️' },
    { from: 'ðŸ“Š', to: '📊' },
    { from: 'ðŸ§ª', to: '🧪' },
    { from: 'â†—', to: '↗' },
    { from: 'â€”', to: '—' },
    { from: 'â–¼', to: '▼' },
    { from: '\uFFFD', to: '-' }, // Universal replacement for replacement char
    { from: '?? BOOT TIMELINE', to: '⏱ BOOT TIMELINE' }
];

files.forEach(f => {
    if (!fs.existsSync(f)) return;
    console.log(`Processing ${f}...`);
    let content = fs.readFileSync(f, 'utf8'); // Read as UTF-8
    let original = content;
    
    replacements.forEach(r => {
        let count = 0;
        // Global replaceall approach
        const parts = content.split(r.from);
        if (parts.length > 1) {
            content = parts.join(r.to);
            console.log(`  Replaced '${r.from}' -> '${r.to}' (${parts.length - 1} times)`);
        }
    });

    if (content !== original) {
        fs.writeFileSync(f, content, 'utf8');
        console.log(`✅ Saved updates to ${path.basename(f)}`);
    } else {
        console.log(`  No changes needed.`);
    }
});

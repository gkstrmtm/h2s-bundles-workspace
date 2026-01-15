
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '../../frontend/portal.html');
const portalFile = path.join(__dirname, '../../portal.html'); // sync both

[file, portalFile].forEach(f => {
    if (fs.existsSync(f)) {
        let content = fs.readFileSync(f, 'utf8');
        const search = "const d = rawDate ? new Date(rawDate) : null;";
        const replace = "const d = rawDate ? ((typeof rawDate === 'string' && /^\\d{4}-\\d{2}-\\d{2}$/.test(rawDate)) ? new Date(rawDate + 'T12:00:00') : new Date(rawDate)) : null;";
        
        if (content.includes(search)) {
            content = content.replace(search, replace);
            fs.writeFileSync(f, content, 'utf8');
            console.log(`Updated ${f}`);
        } else {
            console.log(`Pattern not found in ${f}`);
            // Fallback: try to find it with slightly different spacing if needed
            // But from the read_file output it looks exact.
        }
    }
});

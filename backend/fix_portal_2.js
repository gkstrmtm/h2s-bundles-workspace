const fs = require('fs');
const filePath = 'c:\\Users\\tabar\\h2s-bundles-workspace\\frontend\\portal.html';

try {
    let content = fs.readFileSync(filePath, 'utf8');
    
    // Find the line
    const index = content.indexOf("out.summary = parts.join(");
    if (index === -1) {
        console.log("Could not find out.summary = parts.join");
        process.exit(1);
    }
    
    console.log("Found at index:", index);
    const endLine = content.indexOf('\n', index);
    const line = content.substring(index, endLine);
    console.log("Current line:", line);
    
    // Check characters inside join('...')
    const openQuote = line.indexOf("'");
    const closeQuote = line.lastIndexOf("'");
    if (openQuote !== -1 && closeQuote !== -1) {
        const inside = line.substring(openQuote + 1, closeQuote);
        console.log("Inside quotes lengthbits:", inside.length);
        for(let i=0; i<inside.length; i++) {
            console.log(`Char ${i}:`, inside.charCodeAt(i));
        }
    }

    // Attempt Regex Replace
    // . matches anything except line terminators.
    const newContent = content.replace(/out\.summary = parts\.join\('.*?'\);/, "out.summary = parts.join(' • ');");
    
    if (newContent !== content) {
        fs.writeFileSync(filePath, newContent, 'utf8');
        console.log("Replaced successfully (regex)!");
    } else {
        console.log("Regex replace failed. Attempting manual splice.");
        // Try substring replacement
        const start = index;
        const end = content.indexOf(';', index) + 1;
        if (end > start) {
            const manualNew = content.substring(0, start) + "out.summary = parts.join(' • ');" + content.substring(end);
            fs.writeFileSync(filePath, manualNew, 'utf8');
            console.log("Manual substring replace success!");
        }
    }

} catch (e) {
    console.error(e);
}

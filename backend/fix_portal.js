const fs = require('fs');
const path = '../frontend/portal.html';

try {
    let content = fs.readFileSync(path, 'utf8');
    
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
        console.log("Inside quotes lengthBits:", inside.length);
        for(let i=0; i<inside.length; i++) {
            console.log(`Char ${i}:`, inside.charCodeAt(i));
        }
    }

    // Replace
    const newContent = content.replace(/out\.summary = parts\.join\('[^']+'\);/g, "out.summary = parts.join(' • ');");
    
    if (newContent !== content) {
        fs.writeFileSync(path, newContent, 'utf8');
        console.log("Replaced successfully!");
    } else {
        console.log("Replace failed (string match issue?)");
        // Try constructing replacement manually if regex failed
        const start = index;
        const end = content.indexOf(';', index) + 1;
        if (end > start) {
            const manualNew = content.substring(0, start) + "out.summary = parts.join(' • ');" + content.substring(end);
            fs.writeFileSync(path, manualNew, 'utf8');
            console.log("Manual substring replace success!");
        }
    }

} catch (e) {
    console.error(e);
}

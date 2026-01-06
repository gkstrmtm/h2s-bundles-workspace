const fs = require('fs');
const path = require('path');

const targetFile = path.join(__dirname, 'bundles.js');
let content = fs.readFileSync(targetFile, 'utf8');

// The offending line:
// if(d.getDay()!==0 && d.getDay()!==6) mockAvail.push({date:d.toISOString().split('T')[0]});

// We want to remove the check for getDay() !== 0 (Sunday) and getDay() !== 6 (Saturday).
// We should replace it with just:
// mockAvail.push({date:d.toISOString().split('T')[0]});
// Or at least allow all days.

const oldLine = "if(d.getDay()!==0 && d.getDay()!==6) mockAvail.push({date:d.toISOString().split('T')[0]});";
const newLine = "mockAvail.push({date:d.toISOString().split('T')[0]}); // Weekends allowed per user request";

if (content.indexOf(oldLine) !== -1) {
    content = content.replace(oldLine, newLine);
    console.log("Successfully removed weekend restriction from calendar.");
    fs.writeFileSync(targetFile, content);
} else {
    // It might be minified or differently spaced. Let's try more flexible matching.
    console.warn("Exact match failed, trying broader replacement...");
    const regex = /if\(d\.getDay\(\)!==0 && d\.getDay\(\)!==6\) mockAvail\.push\(\{date:d\.toISOString\(\)\.split\('T'\)\[0\]\}\);/;
    
    if (regex.test(content)) {
        content = content.replace(regex, newLine);
        console.log("Successfully removed weekend restriction (regex match).");
        fs.writeFileSync(targetFile, content);
    } else {
        console.error("Could not find the weekend restriction code.");
        process.exit(1);
    }
}

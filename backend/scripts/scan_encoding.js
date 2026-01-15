const fs = require('fs');
const path = require('path');

const file = path.resolve(__dirname, '../../frontend/portal.html');
const content = fs.readFileSync(file, 'utf8');

// FIND ALL NON-ASCII CHARACTERS (Code > 127)
const nonAscii = [];
for (let i = 0; i < content.length; i++) {
    const code = content.charCodeAt(i);
    if (code > 127) {
        // Get context
        const start = Math.max(0, i - 20);
        const end = Math.min(content.length, i + 20);
        const ctx = content.substring(start, end).replace(/\n/g, ' ');
        nonAscii.push({ char: content[i], code, index: i, context: ctx });
    }
}

// Group by character
const grouped = {};
nonAscii.forEach(item => {
    if (!grouped[item.char]) {
        grouped[item.char] = { code: item.code, count: 0, examples: [] };
    }
    grouped[item.char].count++;
    if (grouped[item.char].examples.length < 5) {
        grouped[item.char].examples.push(item.context);
    }
});

console.log('--- NON-ASCII CHARACTER REPORT ---');
Object.keys(grouped).forEach(char => {
    const info = grouped[char];
    console.log(`Character: '${char}' (Code: ${info.code}) - Count: ${info.count}`);
    console.log('Examples:');
    info.examples.forEach(ex => console.log('  ' + ex));
    console.log('');
});

// Also scan for literal '??' which indicates previous failed conversion
const doubleQuestion = content.match(/\?\?/g);
if (doubleQuestion) {
    console.log(`Found ${doubleQuestion.length} instances of '??' (Literal string, not unicode)`);
}

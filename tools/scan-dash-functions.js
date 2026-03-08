const fs = require('fs');
const path = require('path');
const filePath = 'C:/Users/tabar/h2s-bundles-workspace/frontend/dash.js';
const content = fs.readFileSync(filePath, 'utf8');
const lines = content.split('\n');

const functions = [];
let currentFunction = null;
let braceCount = 0;

for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Look for top-level function declarations
    // This regex matches "async function name(" or "function name("
    if (!currentFunction) {
        const match = line.match(/^(\s*)(async\s+)?function\s+([a-zA-Z0-9_]+)\s*\(/);
        if (match) {
            currentFunction = {
                name: match[3],
                start: i + 1,
            };
            const open = (line.match(/\{/g) || []).length;
            const close = (line.match(/\}/g) || []).length;
            braceCount = open - close;
            // Handle single-line function: function foo() {}
            if (braceCount === 0 && open > 0) {
                 currentFunction.end = i + 1;
                 functions.push(currentFunction);
                 currentFunction = null;
            }
            continue; 
        }
    }

    if (currentFunction) {
        const open = (line.match(/\{/g) || []).length;
        const close = (line.match(/\}/g) || []).length;
        braceCount += (open - close);

        if (braceCount === 0) {
            currentFunction.end = i + 1;
            functions.push(currentFunction);
            currentFunction = null;
        }
    }
}

console.log(JSON.stringify(functions.filter(f => f.end - f.start > 100), null, 2));

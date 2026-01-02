const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'Home2Smart-Dashboard', 'bundles.html');

// Read the file
const content = fs.readFileSync(filePath, 'utf8');

// The problematic block (with the actual ellipsis character that appears in the file)
// We'll match the pattern more flexibly
const lines = content.split('\n');

// Find the line with "return;" inside an "if (needsCatalog)" block around line 2583
let found = false;
for (let i = 2570; i < 2600; i++) {
  if (lines[i] && lines[i].trim() === 'return;') {
    // Check if previous lines contain "if (needsCatalog)"
    let hasNeedsCatalog = false;
    for (let j = Math.max(0, i - 10); j < i; j++) {
      if (lines[j] && lines[j].includes('if (needsCatalog)')) {
        hasNeedsCatalog = true;
        break;
      }
    }
    
    if (hasNeedsCatalog) {
      console.log('Found return statement at line', i + 1);
      console.log('Current content:', lines[i]);
      
      // Comment it out
      lines[i] = '          // return; // REMOVED: blocks promo validation';
      
      found = true;
      break;
    }
  }
}

if (found) {
  // Write back
  fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
  console.log('✅ Fixed! The blocking return statement has been commented out.');
} else {
  console.log('❌ Could not find the return statement inside needsCatalog block');
  // Show lines around 2583
  for (let i = 2575; i < 2590; i++) {
    console.log(`Line ${i + 1}: ${lines[i]}`);
  }
}

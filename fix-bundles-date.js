const fs = require('fs');

let content = fs.readFileSync('Home2Smart-Dashboard/bundles.html', 'utf-8');

// Find the date rendering pattern and replace it
const OLD_PATTERN = 'const dt=new Date(dateValue);if(isNaN(dt.getTime()))dateHTML=escapeHtml(String(dateValue));else{const options={month:"short",day:"numeric",year:"numeric"};dateHTML=dt.toLocaleDateString("en-US",options)';

const NEW_PATTERN = 'const dt=/^\\d{4}-\\d{2}-\\d{2}$/.test(String(dateValue))?new Date(dateValue+"T12:00:00"):new Date(dateValue);if(isNaN(dt.getTime()))dateHTML=escapeHtml(String(dateValue));else{const options={month:"short",day:"numeric",year:"numeric"};dateHTML=dt.toLocaleDateString("en-US",options)';

if (content.includes(OLD_PATTERN)) {
  content = content.replace(OLD_PATTERN, NEW_PATTERN);
  fs.writeFileSync('Home2Smart-Dashboard/bundles.html', content, 'utf-8');
  console.log('✅ Fixed date parsing in bundles.html');
  console.log('');
  console.log('BEFORE: new Date(dateValue)');
  console.log('  - Treated date-only strings as UTC midnight');
  console.log('  - Jan 5 UTC = Jan 4 7pm EST');
  console.log('');
  console.log('AFTER: Date-only strings parsed at noon local time');
  console.log('  - Jan 5 displays as Jan 5');
  console.log('');
  console.log('✅ DEPLOY: Upload bundles.html to fix display bug');
} else {
  console.log('❌ Pattern not found - file may have changed');
  console.log('Looking for pattern containing: const dt=new Date(dateValue)');
}

const fs = require('fs');
const path = require('path');

const files = [
    path.resolve(__dirname, '../portal.html'),
    path.resolve(__dirname, '../frontend/portal.html')
];

files.forEach(file => {
   if (!fs.existsSync(file)) return;
   
   console.log('Safe-Fixing (Encoding):', file);
   let content = fs.readFileSync(file, 'utf8');
   
   // 1. Versioning - Update the visible version
   const newVersion = `VERSION: ${new Date().toISOString().split('T')[0]}_SAFE_v2`;
   content = content.replace(/VERSION: \d{4}-\d{2}-\d{2}[^-\n<]*/, newVersion);
   content = content.replace(/PORTAL VERSION: \d{4}-\d{2}-\d{2}[^'\n]*/, `PORTAL VERSION: ${newVersion}`);
   
   // 2. SAFETY: Replace "•" with "&bull;" to be encoding-independent
   // Previous fix inserted " • "
   content = content.replace(/parts\.join\(['"] • ['"]\)/g, "parts.join(' &bull; ')");
   
   // Replace "• " at start of bullets with "&bull; "
   content = content.replace(/bullets\.push\(`• /g, "bullets.push(`&bull; ");
   content = content.replace(/bullets\.push\('• /g, "bullets.push('&bull; ");
   
   // Replace meta separator span content
   // <span style="color:var(--h2s-border-subtle)">•</span>
   content = content.replace(
       /<span style="color:var\(--h2s-border-subtle\)">•<\/span>/g,
       '<span style="color:var(--h2s-border-subtle)">&bull;</span>'
   );
    
   // 3. REMOVE LOGS ("The Law")
   // Remove the huge console.log block at start
   content = content.replace(/console\.log\('={40}'\);[\s\S]*?console\.log\('={40}'\);/, "// Logs removed for clarity");

   // Remove boot logging if present (detected in bundles.html, checking portal.html)
   // Remove strict scroll lock if user hates it? 
   // "It's very aggressively locked right now" -> maybe H2S_lockScroll
   // We will make H2S_lockScroll a no-op or less aggressive?
   // Better not break modals, but let's reduce "laws" - maybe just console noise first.
   
   // 4. Fix Payout Label "Your share •" -> "&bull;"
   content = content.replace(/payoutLabel = `Your share •/g, "payoutLabel = `Your share &bull;");

   fs.writeFileSync(file, content, 'utf8');
   console.log('Fixed file:', file);
});

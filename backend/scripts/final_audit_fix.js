
const fs = require('fs');
const path = require('path');

const files = [
    path.join(__dirname, '../../frontend/portal.html'),
    path.join(__dirname, '../../portal.html')
];

files.forEach(file => {
    if (fs.existsSync(file)) {
        let content = fs.readFileSync(file, 'utf8');
        let original = content;

        // 1. Error messages (validation)
        content = content.replace(/"\?\? Please provide a reason/g, '"&#9888; Please provide a reason');
        content = content.replace(/"\?\? Please provide more/g, '"&#9888; Please provide more');
        content = content.replace(/"\?\? Job ID missing/g, '"&#10060; Job ID missing');

        // 2. Toasts (likely error toasts)
        // toast(`?? ${userMessage}`)
        content = content.replace(/toast\(`\?\? \$\{userMessage\}\`/g, 'toast(`&#9888; ${userMessage}`');
        
        // 3. Upload Button
        // ?? Upload <span...
        content = content.replace(/\?\? Upload <span/g, '&#11014; Upload <span');

        // 4. Console logs (optional, but good for completeness)
        content = content.replace(/\?\? Calling loadAnnouncements/g, '📢 Calling loadAnnouncements');
        content = content.replace(/\?\? loadAnnouncements is/g, '❌ loadAnnouncements is');

        if (content !== original) {
            fs.writeFileSync(file, content, 'utf8');
            console.log(`Updated ${file}`);
        } else {
            console.log(`No changes needed for ${file}`);
        }
    } else {
        console.log(`File not found: ${file}`);
    }
});

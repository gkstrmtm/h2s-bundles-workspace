
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

        // 1. Fix the icons object
        const oldIcons = "const icons = {info:'??', update:'??', warning:'??', urgent:'??'};";
        const newIcons = "const icons = {info:'&#128227;', update:'&#128227;', warning:'&#9888;', urgent:'&#10071;'};";
        content = content.replace(oldIcons, newIcons);

        // 2. Fix the fallback icon
        const oldFallback = "const icon = icons[a.type] || '??';";
        const newFallback = "const icon = icons[a.type] || '&#128227;';";
        content = content.replace(oldFallback, newFallback);

        // 3. Fix the "By" separator
        // ${a.created_by?' ? By '+a.created_by:''}
        const oldBy = "? By ";
        const newBy = "&bull; By "; // Use HTML entity for bullet
        // Be careful with replacement context
        content = content.replace(/' \? By '/g, "' &bull; By '");

        // 4. Fix the "? Read" status
        const oldRead = ">? Read</div>";
        const newRead = ">&#10003; Read</div>";
        content = content.replace(oldRead, newRead);

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


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

        // Fix Equipment Mode Icons
        // We look for the specific pattern found in the file
        const oldCode = `const equipIcon = cameraDetails.equipment_mode === 'Equipment Provided' ? '??' : 
                        cameraDetails.equipment_mode === 'Customer-Supplied' ? '??' : '?';`;
        
        const newCode = `const equipIcon = cameraDetails.equipment_mode === 'Equipment Provided' ? '&#128230;' : 
                        cameraDetails.equipment_mode === 'Customer-Supplied' ? '&#128295;' : '&#10067;';`;

        // We clean up whitespace to ensure match
        // But since we have the file content, let's try to match loosely or use replace
        
        // Exact match attempt first
        if (content.includes(oldCode)) {
            content = content.replace(oldCode, newCode);
        } else {
             // Try a slightly looser match regex if exact string fails due to whitespace
             // escaping ? as \?
             const regex = /const equipIcon = cameraDetails\.equipment_mode === 'Equipment Provided' \? '\?\?' : \s+cameraDetails\.equipment_mode === 'Customer-Supplied' \? '\?\?' : '\?';/;
             if (regex.test(content)) {
                 content = content.replace(regex, newCode);
             } else {
                 console.log(`Could not find equipment icon code in ${file}`);
             }
        }

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

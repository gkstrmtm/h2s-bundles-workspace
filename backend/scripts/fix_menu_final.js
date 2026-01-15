const fs = require('fs');
const path = require('path');

const files = [
    path.resolve(__dirname, '../../portal.html'),
    path.resolve(__dirname, '../../frontend/portal.html')
];

files.forEach(file => {
    if (!fs.existsSync(file)) return;
    
    console.log(`Processing ${file}...`);
    let content = fs.readFileSync(file, 'utf8');

    // 1. VERSION UPDATE
    const newVersion = `VERSION: ${new Date().toISOString().split('T')[0]}_SAFE_v5`;
    content = content.replace(/VERSION: \d{4}-\d{2}-\d{2}[^-\n<]*/, newVersion);
    content = content.replace(/PORTAL VERSION: \d{4}-\d{2}-\d{2}[^'\n]*/, `PORTAL VERSION: ${newVersion}`);

    // 2. FIX MENU ICONS (The ones with specific style attributes that regex missed)
    // <span style="color:#64748b;font-size:18px">?</span>
    // <span style="color:#64748b;font-size:18px">??</span>
    
    // We replace the inner text '?' or '??' with a chevron '>' entity (&#10095;)
    // Regex explanation:
    // <span[^>]*> matches start tag with any attributes
    // \?+ matches one or more literal question marks
    // <\/span> matches end tag
    content = content.replace(/(<span[^>]*>)\?+(<\/span>)/g, "$1&#10095;$2");
    
    // 3. FIX "?? Submit Feedback" header (Line 21738)
    // <h2 ...>?? Submit Feedback</h2>
    content = content.replace(/>\?\? Submit Feedback/g, '>&#9993; Submit Feedback'); // Envelope icon for feedback header? Or just remove it.
    // User hates ?, so &#9993; (Envelope) is safer.
    
    // 4. CHECK ANY OTHER "??" OR "?" AS ICONS
    // "Camera Install ? Coverage" -> The logic had `? coverage`
    // My previous fix handled `bullets.push('&bull; Coverage...')`.
    // Let's make sure no loose '?' bullets remain in logic.
    
    // There is a case: `if (cameraDetails.camera_count > 0) { bullets.push('? ' + ...)`
    // If that wasn't fixed:
    content = content.replace(/bullets\.push\(['"`]\? /g, "bullets.push('&bull; "); 
    // Double check previously applied fixes didn't miss variations like 'vs`
    
    // 5. REMOVE "Layout ?" text if exists (common in these templates)
    
    fs.writeFileSync(file, content, 'utf8');
    console.log(`Fixed ${file}`);
});


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

        // --- CSS Fixes ---
        // Fix admin badge icons
        content = content.replace(/\.admin-badge--offered::before\s*\{\s*content:'\?\?';\s*\}/g, ".admin-badge--offered::before{content:'\\\\1F4E9';}");
        content = content.replace(/\.admin-badge--accepted::before\s*\{\s*content:'\?';\s*\}/g, ".admin-badge--accepted::before{content:'\\\\2713';}");

        // --- HTML Text Fixes ---
        
        // Headers
        content = content.replace(/>\?\? Resources & Downloads<\/h3>/g, ">&#128194; Resources & Downloads</h3>");
        
        // Empty States (Large Icons)
        // We match by context if possible, or just replace all 48px div ?? placeholders
        // Context: Resources Empty
        content = content.replace(/<div style="font-size:48px;margin-bottom:12px;opacity:\.5">\?\?<\/div>/g, '<div style="font-size:48px;margin-bottom:12px;opacity:.5">&#128218;</div>');
        
        // Context: Time Off Intro
        content = content.replace(/<div style="font-size:48px;margin-bottom:12px">\?\?<\/div>/g, '<div style="font-size:48px;margin-bottom:12px">&#128197;</div>');
        
        // Context: Admin List Empty (has opacity 0.6)
        content = content.replace(/<div style="font-size:48px;margin-bottom:12px;opacity:0\.6">\?\?<\/div>/g, '<div style="font-size:48px;margin-bottom:12px;opacity:0.6">&#128237;</div>');

        // Context: Generic large placeholder (just in case)
        content = content.replace(/<div style="font-size:48px;margin-bottom:12px">\?\?<\/div>/g, '<div style="font-size:48px;margin-bottom:12px">&#128230;</div>');

        // Buttons
        content = content.replace(/>\?\? Refresh<\/button>/g, ">&#128260; Refresh</button>");
        content = content.replace(/>\?\? Auto-Find Links<\/button>/g, ">&#129668; Auto-Find Links</button>");
        content = content.replace(/>\?\? Find Available Techs<\/button>/g, ">&#128269; Find Available Techs</button>");
        content = content.replace(/>\?\? Items Needing Links<\/h3>/g, ">&#128279; Items Needing Links</h3>");
        
        // Video Module text span
        content = content.replace(/>\?\? <span id="videoModule">/g, ">&#127909; <span id=\"videoModule\">");

        // Request Time Off Arrow (single ? in div)
        // <div style="color:#1493FF;font-size:20px;flex-shrink:0">?</div>
        content = content.replace(/<div style="color:#1493FF;font-size:20px;flex-shrink:0">\?<\/div>/g, '<div style="color:#1493FF;font-size:20px;flex-shrink:0">&#10095;</div>');

        // --- JS String Fixes ---
        // Toast messages and titles
        content = content.replace(/Welcome to Home2Smart(.*?) \?\?/g, "Welcome to Home2Smart$1 &#128075;");
        content = content.replace(/Accepting Jobs \?\?/g, "Accepting Jobs &#128188;");
        content = content.replace(/Payout Structure \?\?/g, "Payout Structure &#128176;");
        content = content.replace(/Complete Your Profile \?\?/g, "Complete Your Profile &#128100;");
        content = content.replace(/Ready to Go! \?\?/g, "Ready to Go! &#128640;");
        content = content.replace(/'\[Menu\] \?\? Showing Announcements panel'/g, "'[Menu] 📱 Showing Announcements panel'");

         // --- Double Check Equipment Logic ---
         // Just in case the previous script missed due to whitespace match issues, enforce it here for the fallback '?'
         // Using a specific unique replacement for the fallback '?' if it exists in the compiled JS logic
         // We look for: (cameraDetails.equipment_mode === 'Customer-Supplied' ? '??' : '?') 
         // But let's assume the previous script worked for the main block.
         // Wait, the previous script changed `?` to `&#10067;` for the fallback.

         // One last check for any loose `??`
         // content = content.replace(/\?\?/g, "[FIXME]"); // Too dangerous to do globally without reviewing context

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

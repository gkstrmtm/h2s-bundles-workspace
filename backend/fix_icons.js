const fs = require('fs');
const filePath = 'c:\\Users\\tabar\\h2s-bundles-workspace\\frontend\\portal.html';

try {
    let content = fs.readFileSync(filePath, 'utf8');
    let original = content;

    const replacements = [
        // Indicators (Time)
        { from: "indicator.textContent = '? Just updated'", to: "indicator.textContent = '🕒 Just updated'" },
        { from: "indicator.textContent = `? ${seconds}s ago`", to: "indicator.textContent = `🕒 ${seconds}s ago`" },
        { from: "indicator.textContent = `? ${minutes}m ago`", to: "indicator.textContent = `🕒 ${minutes}m ago`" },
        
        // Toasts - Success
        { from: 'toast("? Job cancelled successfully")', to: 'toast("✅ Job cancelled successfully")' },
        { from: 'toast(`? Uploaded ${success}', to: 'toast(`✅ Uploaded ${success}' },
        // { from: 'toast(out.team_confirmed ? "? Team confirmed', to: 'toast(out.team_confirmed ? "✅ Team confirmed' }, // Already fixed manually
        
        // Toasts - Error/Warning
        { from: 'toast("? Failed to delete', to: 'toast("❌ Failed to delete' },
        { from: 'toast("? Could not load jobs")', to: 'toast("❌ Could not load jobs")' },
        { from: 'toast("? Please sign in', to: 'toast("⚠️ Please sign in' },
        { from: 'toast("? Missing job ID")', to: 'toast("⚠️ Missing job ID")' },
        { from: 'toast("? No photos selected")', to: 'toast("⚠️ No photos selected")' },
        { from: 'toast("? No valid images', to: 'toast("⚠️ No valid images' },
        { from: 'toast(`? Upload failed', to: 'toast(`❌ Upload failed' },
        { from: 'toast(`? Upload error', to: 'toast(`❌ Upload error' },
        { from: 'errorDiv.textContent = "? Job ID missing', to: 'errorDiv.textContent = "⚠️ Job ID missing' },
        { from: 'errorDiv.textContent = `? ${err.message', to: 'errorDiv.textContent = `❌ ${err.message' },
        { from: 'toast(`? ${userMessage}`)', to: 'toast(`⚠️ ${userMessage}`)' }, 
    ];

    let count = 0;
    replacements.forEach(r => {
        // Replace ALL occurrences
        while (content.indexOf(r.from) !== -1) {
             content = content.replace(r.from, r.to);
             count++;
        }
    });

    // Console logs
    const logReplacements = [
        { from: "console.log('? Deployed", to: "console.log('🚀 Deployed" },
        { from: "console.log('? Connected", to: "console.log('✅ Connected" },
        { from: "console.log('? Portal signup", to: "console.log('✅ Portal signup" },
        { from: "console.log('? Git auto-deploy", to: "console.log('🔄 Git auto-deploy" },
        { from: "console.log(\"? FAST LOAD", to: "console.log(\"⚡ FAST LOAD" }
    ];
    
    logReplacements.forEach(r => {
        if (content.indexOf(r.from) !== -1) {
            content = content.replace(r.from, r.to);
            count++;
        }
    });
    
    // Fix literal "?? Contacted" if found?
    // Not found in grep cleanly, but "?? Refresh"
    const doubleQReplacements = [
        { from: "?? Resources", to: "📁 Resources" },
        { from: "?? Refresh", to: "🔄 Refresh" },
        { from: "?? Auto-Find", to: "🔍 Auto-Find" },
        { from: "?? Items", to: "⚠️ Items" },
        { from: "?? Find Available Techs", to: "🔍 Find Available Techs" },
    ];
    
    doubleQReplacements.forEach(r => {
        while (content.indexOf(r.from) !== -1) {
             content = content.replace(r.from, r.to);
             count++;
        }
    });

    if (content !== original) {
        fs.writeFileSync(filePath, content, 'utf8');
        console.log(`Fixed ${count} UI icon issues.`);
    } else {
        console.log("No changes made (patterns not found?)");
    }

} catch (e) {
    console.error(e);
}

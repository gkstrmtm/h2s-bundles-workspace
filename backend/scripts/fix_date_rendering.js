
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

        // Fix 1: Date Parsing Logic in renderJobCard (or similar loop)
        // Look for the specific line we identified
        const oldLogic = `let targetDate = rawDate ? new Date(rawDate) : null;`;
        
        const newLogic = `let targetDate = null;
    if (rawDate) {
      // Fix for date-only strings (YYYY-MM-DD) shifting to previous day due to UTC conversion
      if (typeof rawDate === 'string' && /^\\d{4}-\\d{2}-\\d{2}$/.test(rawDate)) {
        targetDate = new Date(rawDate + 'T12:00:00'); 
      } else {
        targetDate = new Date(rawDate);
      }
    }`;

        // There might be multiple occurrences. We should replace them carefully.
        // It seems the one in `renderJobCard` (around line 12664) is the key one.
        // There might be others.
        
        // Let's use global replace for this pattern as it's safe and robust for display logic.
        content = content.replace(/let targetDate = rawDate \? new Date\(rawDate\) : null;/g, newLogic);

        // Fix 2: "Upcoming Jobs" section often has similar logic.
        // Let's search for other instances of simple Date constructor from raw strings that might affect display.
        // Search: const d = new Date(job.delivery_date);
        // or similar.
        
        // Let's look for: new Date(job.delivery_date)
        content = content.replace(/new Date\(([^)]*?)\.delivery_date\)/g, "new Date($1.delivery_date + 'T12:00:00')");

        // Fix 3: In `renderUpcomingJobs`:
        // const jobDate = new Date(job.delivery_date || job.created_at);
        // We need to be careful not to break `created_at` which is full ISO.
        
        /* 
           Found pattern via hypothesis: 
           const dateObj = new Date(job.delivery_date || ...);
           This is likely where the issue is for "Pending" or "Upcoming"
        */

        // Let's replace a specific known pattern if found
        const oldPendingDate = `const d = new Date(job.delivery_date || job.created_at);`;
        const newPendingDate = `const rawD = job.delivery_date || job.created_at;
        const d = (rawD && rawD.match(/^\\d{4}-\\d{2}-\\d{2}$/)) ? new Date(rawD + 'T12:00:00') : new Date(rawD);`;
        
        if (content.includes(oldPendingDate)) {
             content = content.replace(oldPendingDate, newPendingDate);
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

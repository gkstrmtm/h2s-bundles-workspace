
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const sb = createClient(sbUrl, sbKey);

async function checkTypes() {
    const { data: cols, error } = await sb
        .from('information_schema.columns') // Supabase exposes this via API? Sometimes restricted.
        // If REST fails, we infer from data
        .select('*'); 
    
    // Easier way: fetch one row and inspect types
    const { data: jobs } = await sb.from('h2s_dispatch_jobs').select('*').limit(1);
    
    if (jobs && jobs.length > 0) {
        const j = jobs[0];
        console.log('Sequence ID value:', j.sequence_id, 'Type:', typeof j.sequence_id);
        console.log('Step ID value:', j.step_id, 'Type:', typeof j.step_id);
    } else {
        console.log('No jobs found to inspect types');
    }
}
checkTypes();

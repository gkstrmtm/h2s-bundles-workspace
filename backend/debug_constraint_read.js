
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const sb = createClient(sbUrl, sbKey);

async function checkConstraint() {
    console.log('Fetching constraint def...');
    // We can't query pg_catalog directly via PostgREST usually (permissions).
    // But we can try information_schema.
    
    // Attempt 1: information_schema.check_constraints
    const { data, error } = await sb
        .from('information_schema.check_constraints')
        .select('*')
        .eq('constraint_name', 'h2s_dispatch_jobs_status_check');
        
    if (error) {
        console.log('Error querying info schema:', error.message); // Likely 404 or permission denied
    } else {
        console.log('Constraint Data:', data);
    }
}

checkConstraint();


require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

if (!sbUrl || !sbKey) {
    console.error('Missing credentials');
    process.exit(1);
}

const sb = createClient(sbUrl, sbKey);

async function findJob() {
    console.log('Searching for a pending job...');
    const { data: jobs, error } = await sb
        .from('h2s_dispatch_jobs')
        .select('job_id, status, assigned_pro_id, order_id')
        .neq('status', 'completed')
        .limit(5); // Get a few
    
    if (error) {
        console.error('Error finding jobs:', error);
        // Try h2s_orders as backup
        const { data: orders, error: ordErr } = await sb.from('h2s_orders').select('*').limit(1);
        console.log('Orders table check:', orders ? orders.length : ordErr);
        return;
    }

    if (jobs && jobs.length > 0) {
        console.log('Found Jobs:', JSON.stringify(jobs, null, 2));
    } else {
        console.log('No pending jobs found in h2s_dispatch_jobs.');
    }
}

findJob();

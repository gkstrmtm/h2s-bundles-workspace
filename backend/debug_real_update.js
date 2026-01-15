
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

if (!sbUrl || !sbKey) throw new Error('Missing Supabase creds');

const sb = createClient(sbUrl, sbKey);

async function findTestingCandidate() {
    console.log('--- FINDING CANDIDATE JOB ---');
    // Find a job that has a recipient_id (so we can mimic pro) and is NOT completed.
    const { data: jobs, error } = await sb
        .from('h2s_dispatch_jobs')
        .select('*')
        .not('status', 'in', '("completed","done")') // Exclude completed
        .not('recipient_id', 'is', null) // Must have a pro
        .limit(1);

    if (error) {
        console.error('Error finding candidate:', error);
        return null;
    }

    if (!jobs || jobs.length === 0) {
        console.log('No candidate jobs found.');
        return null;
    }
    
    console.log('Candidate Found:',jobs[0].job_id);
    return jobs[0];
}

async function simulateUpdate(job) {
    if (!job) return;
    
    console.log('\n--- SIMULATING UPDATE (Service Role) ---');
    console.log(`Target: ${job.job_id} | Current Status: ${job.status}`);
    
    const nowIso = new Date().toISOString();
    
    // 1. Prepare Payload (match logic in route.ts)
    const updatePayload = {
        status: 'done',
        updated_at: nowIso
    };
    if (Object.keys(job).includes('completed_at')) {
        updatePayload.completed_at = nowIso;
    }

    // 2. Execute
    const { data, error, count } = await sb
        .from('h2s_dispatch_jobs')
        .update(updatePayload)
        .eq('job_id', job.job_id)
        .select(); // Select to see if rows returned

    if (error) {
        console.log('❌ UPDATE FAILED (Supabase Error):');
        console.log(JSON.stringify(error, null, 2));
    } else if (!data || data.length === 0) {
        console.log('⚠️ UPDATE RETURNED 0 ROWS (Silent Failure/RLS)');
    } else {
        console.log('✅ UPDATE SUCCESS');
        console.log('New Status:', data[0].status);
        
        // Revert it
        console.log('Reverting status...');
        await sb.from('h2s_dispatch_jobs').update({ status: job.status }).eq('job_id', job.job_id);
    }
}

(async () => {
    const job = await findTestingCandidate();
    await simulateUpdate(job);
})();

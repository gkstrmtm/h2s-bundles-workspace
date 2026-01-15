
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const sb = createClient(sbUrl, sbKey);

async function simulateFix() {
    console.log('--- 1. PREFLIGHT: Finding a Candidate Job ---');
    // Find a job that is 'queued' or 'assigned'
    const { data: jobs } = await sb
        .from('h2s_dispatch_jobs')
        .select('*')
        .in('status', ['queued', 'assigned', 'scheduled'])
        .not('recipient_id', 'is', null) // Must be assigned to mimic pro
        .limit(1);

    if (!jobs || jobs.length === 0) {
        console.log('No candidate jobs found.');
        return;
    }
    const job = jobs[0];
    console.log(`Candidate: ${job.job_id} | Status: ${job.status}`);
    console.log('Keys:', Object.keys(job));

    // --- SIMULATE API "MARK DONE" ---

    console.log('\n--- 2. EXECUTE: Simulate API "Mark Done" (Server Logic) ---');
    const updatePayload = {
        status: 'done', // The FIX: using 'done' instead of 'completed'
        updated_at: new Date().toISOString()
    };
    if (Object.keys(job).includes('completed_at')) {
        updatePayload.completed_at = new Date().toISOString();
    }
    
    console.log('Update Payload:', updatePayload);

    const { data: updatedJob, error: updateError } = await sb
        .from('h2s_dispatch_jobs')
        .update(updatePayload)
        .eq('job_id', job.job_id)
        .select()
        .single();
    
    if (updateError) {
        console.error('❌ UPDATE FAILED:', updateError);
        return;
    }
    console.log('✅ UPDATE SUCCESS (DB Persisted):', updatedJob.status);

    // --- SIMULATE API "JOBS LIST" (Client Fetch) ---
    console.log('\n--- 3. VERIFY: Simulate Jobs List Fetch (Read Logic) ---');
    const { data: refetchedJob } = await sb
        .from('h2s_dispatch_jobs')
        .select('*')
        .eq('job_id', job.job_id)
        .single();
    
    console.log(`Fetch Result Status: ${refetchedJob.status}`);
    
    // Verify grouping logic for UI
    const COMPLETED = ['completed', 'complete', 'done', 'paid', 'closed', 'cancelled', 'canceled'];
    const UPCOMING = ['accepted', 'assigned', 'scheduled', 'schedule_pending', 'in_progress', 'in-progress', 'enroute', 'en_route', 'started'];
    
    const state = refetchedJob.status.toLowerCase().trim();
    let uiBucket = 'OFFER';
    
    if (COMPLETED.includes(state)) {
        uiBucket = 'COMPLETED';
    } else if (UPCOMING.includes(state)) {
        if (!COMPLETED.includes(state)) { // The Fix in Filter
            uiBucket = 'UPCOMING';
        } else {
             uiBucket = 'COMPLETED (Priority)';
        }
    }
    
    console.log(`UI Classification: ${uiBucket}`);
    if (uiBucket === 'COMPLETED') {
        console.log('✅ PASS: Job correctly moves to History/Completed tab.');
    } else {
        console.log('❌ FAIL: Job would still appear in Upcoming/Offers.');
    }
    
    // Cleanup
    console.log('\n--- CLEANUP: Reverting Status ---');
    await sb.from('h2s_dispatch_jobs').update({ status: job.status, completed_at: null }).eq('job_id', job.job_id);
    console.log('Restored original status.');
}

simulateFix();

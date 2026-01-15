
const { createClient } = require('@supabase/supabase-js');
const { randomUUID } = require('crypto');

const sbUrl = process.env.SUPABASE_URL;
const sbKey = process.env.SUPABASE_SERVICE_KEY;

if (!sbUrl || !sbKey) {
    console.error('Missing env vars');
    process.exit(1);
}

const sb = createClient(sbUrl, sbKey);

async function sync() {
    console.log('--- SYNCHRONIZING ORDERS TO JOBS ---');

    // 1. Fetch Existing Jobs Map
    const { data: jobs, error: jobErr } = await sb.from('h2s_dispatch_jobs').select('job_id, order_id');
    if (jobErr) {
        console.error('Available tables:', (await sb.from('pg_tables').select('*'))); // Try to debug if table missing
        throw jobErr;
    }

    const jobOrderIds = new Set(jobs.map(j => j.order_id).filter(Boolean));
    console.log(`Found ${jobs.length} existing jobs.`);

    // 2. Fetch All Orders
    const { data: orders, error: orderErr } = await sb.from('h2s_orders').select('*').order('created_at', { ascending: true });
    if (orderErr) throw orderErr;

    console.log(`Found ${orders.length} orders.`);

    let created = 0;
    let errors = 0;

    // 3. Sync
    for (const order of orders) {
        if (!order.order_id) continue;
        
        if (jobOrderIds.has(order.order_id)) {
            // Already exists
            continue;
        }

        // Parse ID from metadata or generate
        let jobId = null;
        let meta = {};
        try {
            meta = typeof order.metadata_json === 'string' ? JSON.parse(order.metadata_json) : (order.metadata_json || {});
            jobId = meta.dispatch_job_id || meta.job_id;
        } catch {}

        if (!jobId) jobId = randomUUID();

        // 4. Determine Recipient (Required by DB Constraint)
        let recipientId = meta.dispatch_recipient_id || meta.recipient_id;
        
        // Fallback to "H2S Technician" found in previous check or any known pro
        // ID: a55f1bad-9547-4e61-986b-1a5fb6b83544 (H2S Technician in h2s_dispatch_pros)
        if (!recipientId) {
            recipientId = 'a55f1bad-9547-4e61-986b-1a5fb6b83544';
        }

        // Determine Status
        // Use 'pending' to ensure it counts in dashboard "Pending Jobs" metric
        const status = 'pending'; 

        // Insert
        const payload = {
            job_id: jobId,
            order_id: order.order_id,
            status: status,
            recipient_id: recipientId,
            created_at: order.created_at,
            updated_at: new Date().toISOString()
        };

        const { error } = await sb.from('h2s_dispatch_jobs').insert(payload);
        
        if (error) {
            console.error(`Failed to insert job for order ${order.order_id}:`, error.message);
            errors++;
        } else {
            console.log(`+ Created Job ${jobId} for Order ${order.order_id}`);
            created++;
        }
    }

    console.log(`--- SYNC COMPLETE ---`);
    console.log(`Created: ${created}`);
    console.log(`Errors: ${errors}`);
}

sync().catch(console.error);

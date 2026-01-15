
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const sb = createClient(sbUrl, sbKey);

async function checkStatus() {
    const { data: rows } = await sb.from('h2s_dispatch_jobs').select('status').limit(10);
    if (rows) {
        const statuses = [...new Set(rows.map(r => r.status))];
        console.log('Existing Statuses:', statuses);
    }
}
checkStatus();

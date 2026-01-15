
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const sb = createClient(sbUrl, sbKey);

async function inspectSchema() {
    // Just select * limit 1 to see keys
    const { data, error } = await sb
        .from('h2s_dispatch_jobs')
        .select('*')
        .limit(1);
    
    if (error) {
        console.error('Error:', error);
    } else if (data && data.length > 0) {
        console.log('Columns:', Object.keys(data[0]));
    } else {
        console.log('Table exists but is empty?');
    }
}

inspectSchema();


require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

if (!sbUrl || !sbKey) {
    console.error('Missing Supabase credentials in .env.local');
    process.exit(1);
}

const supabase = createClient(sbUrl, sbKey);

async function run() {
    console.log('Reading migration file...');
    const migrationPath = path.join(__dirname, 'migrations', '002_fix_job_status_constraint.sql');
    let sqlContent = fs.readFileSync(migrationPath, 'utf8');

    // Remove comments to prevent parsing issues
    sqlContent = sqlContent.split('\n').filter(line => !line.trim().startsWith('--')).join('\n');

    console.log('Appying Migration via RPC exec_sql...');
    console.log(sqlContent);

    const { data, error } = await supabase.rpc('exec_sql', { sql: sqlContent });

    if (error) {
        console.error('❌ RPC Failed:', error);
        
        // Fallback: splitting statements
        console.log('Attempting split statements...');
        const statements = sqlContent.split(';')
            .map(s => s.trim())
            .filter(s => s.length > 0);
            
        for (const stmt of statements) {
            console.log('Running:', stmt);
            const { error: stmtError } = await supabase.rpc('exec_sql', { sql: stmt });
            if (stmtError) console.error('  Statement Error:', stmtError);
            else console.log('  Success');
        }
    } else {
        console.log('✅ Migration Applied Successfully (Single Batch)');
        console.log('Output:', data);
    }
}

run();

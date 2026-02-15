
const dotenv = require('dotenv');
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env.production.local' });
dotenv.config({ path: '.env.vercel.production' });
dotenv.config({ path: '.env' });
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

function pickArg(name) {
    const idx = process.argv.indexOf(name);
    if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
    return null;
}

const migrationFile = process.argv[2] && !process.argv[2].startsWith('-') ? process.argv[2] : null;
const useMgmt = process.argv.includes('--mgmt') || process.argv.includes('--db=mgmt') || pickArg('--db') === 'mgmt';

const sbUrl = useMgmt
    ? (process.env.NEXT_PUBLIC_SUPABASE_URL_MGMT || process.env.SUPABASE_URL_MGMT)
    : (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL);

const sbKey = useMgmt
    ? (process.env.SUPABASE_SERVICE_ROLE_KEY_MGMT || process.env.SUPABASE_SERVICE_KEY_MGMT)
    : (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY);

if (!sbUrl || !sbKey) {
    console.error(`Missing Supabase credentials for ${useMgmt ? 'MGMT' : 'MAIN'} in .env.local`);
    console.error('Expected env vars:');
    console.error(useMgmt ? '  SUPABASE_URL_MGMT + SUPABASE_SERVICE_KEY_MGMT' : '  SUPABASE_URL + SUPABASE_SERVICE_KEY');
    process.exit(1);
}

if (!migrationFile) {
    console.error('Usage: node apply_migration_rpc.js <migration.sql> [--mgmt|--db mgmt]');
    console.error('Example: node apply_migration_rpc.js 005_alter_deliverables_add_task_ref.sql --mgmt');
    process.exit(2);
}

const supabase = createClient(sbUrl, sbKey);

async function execSql(sqlText) {
    // Different Supabase projects use different parameter names for exec_sql.
    // Try the common ones in order.
    const attempts = [
        { sql: sqlText },
        { sql_query: sqlText },
        { query: sqlText }
    ];
    let lastError = null;
    for (const args of attempts) {
        const { data, error } = await supabase.rpc('exec_sql', args);
        if (!error) return { data, error: null };
        lastError = error;
    }
    return { data: null, error: lastError };
}

async function run() {
    console.log('Reading migration file...');
    const migrationPath = path.join(__dirname, 'migrations', migrationFile);
    let sqlContent = fs.readFileSync(migrationPath, 'utf8');

    // Remove comments to prevent parsing issues
    sqlContent = sqlContent.split('\n').filter(line => !line.trim().startsWith('--')).join('\n');

    console.log(`Applying Migration via RPC exec_sql (${useMgmt ? 'MGMT' : 'MAIN'})...`);
    console.log(sqlContent);

    const { data, error } = await execSql(sqlContent);

    if (error) {
        console.error('❌ RPC Failed:', error);
        
        // Fallback: splitting statements
        console.log('Attempting split statements...');
        const statements = sqlContent.split(';')
            .map(s => s.trim())
            .filter(s => s.length > 0);

        let failed = 0;
            
        for (const stmt of statements) {
            console.log('Running:', stmt);
            const { error: stmtError } = await execSql(stmt);
            if (stmtError) {
                failed++;
                console.error('  Statement Error:', stmtError);
            } else {
                console.log('  Success');
            }
        }

        if (failed > 0) {
            console.error(`❌ Migration failed (${failed} statements).`);
            process.exit(1);
        }
    } else {
        console.log('✅ Migration Applied Successfully (Single Batch)');
        console.log('Output:', data);
    }
}

run();
